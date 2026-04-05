import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * PayScale MarketPay / Peer API integration.
 *
 * Crowd-sourced + employer-reported data. 100+ countries.
 * Good for SMBs and real-time market rates.
 *
 * Config:
 *   apiUrl   - PayScale API base URL (default: https://api.payscale.com)
 *   apiKey   - API key (from PayScale developer portal)
 *   country  - ISO country code (default: "US")
 */

interface PayScaleJob {
  jobTitle: string;
  jobCategory: string;
  experienceLevel: string;
  location: {
    country: string;
    state?: string;
    city?: string;
  };
  currency: string;
  salary: {
    percentile10: number;
    percentile25: number;
    median: number;
    percentile75: number;
    percentile90: number;
  };
  reportDate: string;
  profileCount: number;
}

interface PayScaleResponse {
  status: string;
  jobs: PayScaleJob[];
  pagination: { total: number; page: number; perPage: number };
}

// PayScale experience levels → internal levels
const EXPERIENCE_LEVEL_MAP: Record<string, string> = {
  'Entry Level': 'IC1',
  'Early Career': 'IC2',
  'Mid-Career': 'IC3',
  Experienced: 'IC4',
  'Late Career': 'IC5',
  Manager: 'Manager',
  'Senior Manager': 'Senior Manager',
  Director: 'Director',
  Executive: 'VP+',
};

export class PayScaleProvider implements MarketDataProviderAdapter {
  readonly name = 'PAYSCALE';
  private readonly logger = new Logger(PayScaleProvider.name);
  private readonly DEFAULT_API_URL = 'https://api.payscale.com';

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiKey) errors.push('apiKey is required');
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = (config.apiUrl as string) ?? this.DEFAULT_API_URL;
    const apiKey = config.apiKey as string;
    const country = (config.country as string) ?? 'US';

    const bands: NormalizedBand[] = [];
    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        country,
        page: String(page),
        perPage: String(perPage),
      });
      if (filters?.jobFamily) params.set('category', filters.jobFamily);
      if (filters?.location) params.set('location', filters.location);

      try {
        const response = await fetch(`${apiUrl}/v1/compensation/jobs?${params}`, {
          method: 'GET',
          headers: {
            'X-API-Key': apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`PayScale API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as PayScaleResponse;
        if (data.status !== 'success' || !data.jobs?.length) break;

        for (const job of data.jobs) {
          // Skip low-confidence data
          if (job.profileCount < 10) continue;

          const locationParts = [job.location.country];
          if (job.location.state) locationParts.push(job.location.state);
          if (job.location.city) locationParts.push(job.location.city);

          bands.push({
            jobFamily: job.jobCategory,
            level: EXPERIENCE_LEVEL_MAP[job.experienceLevel] ?? job.experienceLevel,
            location: locationParts.join(' - '),
            currency: job.currency,
            p10: job.salary.percentile10,
            p25: job.salary.percentile25,
            p50: job.salary.median,
            p75: job.salary.percentile75,
            p90: job.salary.percentile90,
            source: `PayScale ${new Date(job.reportDate).getFullYear()} (${job.profileCount} profiles)`,
            effectiveDate: new Date(job.reportDate),
          });
        }

        hasMore = page * perPage < data.pagination.total;
        page++;
      } catch (error) {
        this.logger.warn(`PayScale API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const apiUrl = (config.apiUrl as string) ?? this.DEFAULT_API_URL;
      const response = await fetch(`${apiUrl}/v1/health`, {
        method: 'GET',
        headers: { 'X-API-Key': config.apiKey as string },
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
