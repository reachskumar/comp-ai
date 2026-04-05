import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * US Bureau of Labor Statistics — Occupational Employment & Wage Statistics (OES).
 *
 * Free public API. No API key required.
 * Data: 800+ occupations, national + metro area, annual release.
 * URL: https://api.bls.gov/publicAPI/v2/timeseries/data/
 *
 * Config:
 *   apiKey       - Optional registration key (higher rate limits)
 *   areaCode     - BLS area code (e.g., "0000000" for national)
 *   seriesPrefix - OES series prefix (default: "OEUM")
 */

// BLS OES percentile series suffixes
const PERCENTILE_SUFFIXES = {
  p10: '10',
  p25: '25',
  p50: '50', // median
  p75: '75',
  p90: '90',
} as const;

// Common SOC code → job family mapping
const SOC_TO_JOB_FAMILY: Record<string, string> = {
  '15-1252': 'Software Engineering',
  '15-1253': 'Software Engineering',
  '15-1254': 'Web Development',
  '15-1211': 'Computer Science',
  '15-1212': 'Information Security',
  '15-1241': 'Database Administration',
  '15-1244': 'Network Engineering',
  '15-1299': 'Technology',
  '11-3021': 'IT Management',
  '11-1021': 'General Management',
  '13-2011': 'Finance',
  '13-1111': 'Management Consulting',
  '13-1161': 'Market Research',
  '15-2031': 'Operations Research',
  '17-2061': 'Engineering',
  '17-2112': 'Engineering',
  '17-2141': 'Engineering',
  '27-1024': 'Design',
  '15-2051': 'Data Science',
};

interface BlsSeriesResponse {
  status: string;
  Results?: {
    series: Array<{
      seriesID: string;
      data: Array<{
        year: string;
        period: string;
        value: string;
      }>;
    }>;
  };
}

export class BlsProvider implements MarketDataProviderAdapter {
  readonly name = 'BLS_OES';
  private readonly logger = new Logger(BlsProvider.name);
  private readonly BASE_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    // apiKey is optional for BLS (but recommended for higher rate limits)
    if (config.socCodes && !Array.isArray(config.socCodes)) {
      errors.push('socCodes must be an array of SOC code strings');
    }
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const socCodes = (config.socCodes as string[]) ?? Object.keys(SOC_TO_JOB_FAMILY);
    const areaCode = (config.areaCode as string) ?? '0000000'; // National
    const apiKey = config.apiKey as string | undefined;

    // Filter SOC codes by job family if specified
    const filteredCodes = filters?.jobFamily
      ? socCodes.filter(
          (soc) => SOC_TO_JOB_FAMILY[soc]?.toLowerCase() === filters.jobFamily!.toLowerCase(),
        )
      : socCodes;

    if (filteredCodes.length === 0) return [];

    const bands: NormalizedBand[] = [];

    // BLS API limits to 50 series per request
    const batchSize = 10; // 10 SOC codes * 5 percentiles = 50 series
    for (let i = 0; i < filteredCodes.length; i += batchSize) {
      const batch = filteredCodes.slice(i, i + batchSize);

      // Build series IDs for all percentiles of each SOC code
      const seriesIds: string[] = [];
      for (const soc of batch) {
        const socClean = soc.replace('-', '');
        for (const suffix of Object.values(PERCENTILE_SUFFIXES)) {
          // OEUM = OES, U = US, area, SOC, percentile
          seriesIds.push(`OEUM${areaCode}${socClean}000000${suffix}`);
        }
      }

      try {
        const body: Record<string, unknown> = {
          seriesid: seriesIds,
          startyear: String(new Date().getFullYear() - 1),
          endyear: String(new Date().getFullYear()),
        };
        if (apiKey) body.registrationkey = apiKey;

        const response = await fetch(this.BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`BLS API returned ${response.status}`);
          continue;
        }

        const data = (await response.json()) as BlsSeriesResponse;
        if (data.status !== 'REQUEST_SUCCEEDED' || !data.Results) continue;

        // Group series data by SOC code
        for (const soc of batch) {
          const socClean = soc.replace('-', '');
          const percentiles: Record<string, number> = {};

          for (const [pKey, pSuffix] of Object.entries(PERCENTILE_SUFFIXES)) {
            const seriesId = `OEUM${areaCode}${socClean}000000${pSuffix}`;
            const series = data.Results.series.find((s) => s.seriesID === seriesId);
            const latestValue = series?.data?.[0]?.value;
            if (latestValue && latestValue !== '-') {
              percentiles[pKey] = parseFloat(latestValue);
            }
          }

          // Only add if we have at least median
          if (percentiles.p50) {
            bands.push({
              jobFamily: SOC_TO_JOB_FAMILY[soc] ?? soc,
              level: 'All', // BLS doesn't have level granularity
              location: areaCode === '0000000' ? 'US - National' : `US - Area ${areaCode}`,
              currency: 'USD',
              p10: percentiles.p10 ?? percentiles.p50 * 0.6,
              p25: percentiles.p25 ?? percentiles.p50 * 0.8,
              p50: percentiles.p50,
              p75: percentiles.p75 ?? percentiles.p50 * 1.2,
              p90: percentiles.p90 ?? percentiles.p50 * 1.4,
              source: `BLS OES ${new Date().getFullYear()}`,
              effectiveDate: new Date(`${new Date().getFullYear()}-01-01`),
              expiresAt: new Date(`${new Date().getFullYear()}-12-31`),
            });
          }
        }
      } catch (error) {
        this.logger.warn(`BLS API batch fetch failed: ${(error as Error).message}`);
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const body: Record<string, unknown> = {
        seriesid: ['OEUM000000001510000050'], // National, Software Devs, Median
        startyear: String(new Date().getFullYear() - 1),
        endyear: String(new Date().getFullYear()),
      };
      if (config.apiKey) body.registrationkey = config.apiKey;

      const response = await fetch(this.BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      const data = (await response.json()) as BlsSeriesResponse;
      return data.status === 'REQUEST_SUCCEEDED';
    } catch {
      return false;
    }
  }
}
