import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Mercer Total Remuneration Survey (TRS) API integration.
 *
 * Enterprise API — requires Mercer partnership agreement.
 * Data: 130+ countries, 25M+ data points, industry-specific cuts.
 *
 * Supports: Global, India (TRS India), APAC, Europe, Americas.
 *
 * Config:
 *   apiUrl     - Mercer API gateway URL
 *   apiKey     - OAuth2 client credential or API key
 *   surveyId   - Specific survey ID (e.g., "TRS-IN-2026" for India)
 *   country    - ISO country code
 *   industry   - Industry filter (e.g., "technology", "pharmaceuticals")
 */

interface MercerPosition {
  positionCode: string;
  positionTitle: string;
  jobFamily: string;
  careerLevel: string;
  country: string;
  city?: string;
  currency: string;
  baseSalary: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  totalCash?: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  surveyYear: number;
  participantCount: number;
}

interface MercerResponse {
  data: MercerPosition[];
  meta: { total: number; offset: number; limit: number };
}

// Mercer career levels → internal level mapping
const MERCER_LEVEL_MAP: Record<string, string> = {
  P1: 'IC1',
  P2: 'IC2',
  P3: 'IC3',
  P4: 'IC4',
  P5: 'IC5',
  P6: 'IC6',
  M1: 'Manager',
  M2: 'Senior Manager',
  M3: 'Director',
  M4: 'VP',
  M5: 'SVP',
  E1: 'C-Suite',
};

// Country code → location format mapping
const COUNTRY_LOCATIONS: Record<string, string> = {
  US: 'US',
  IN: 'India',
  GB: 'UK',
  DE: 'Germany',
  SG: 'Singapore',
  AE: 'UAE',
  JP: 'Japan',
  AU: 'Australia',
  CA: 'Canada',
  FR: 'France',
};

export class MercerProvider implements MarketDataProviderAdapter {
  readonly name = 'MERCER_TRS';
  private readonly logger = new Logger(MercerProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (!config.surveyId) errors.push('surveyId is required (e.g., "TRS-IN-2026")');
    if (!config.country) errors.push('country is required (ISO 3166 code)');
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const surveyId = config.surveyId as string;
    const country = config.country as string;
    const industry = config.industry as string | undefined;

    const bands: NormalizedBand[] = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        surveyId,
        country,
        offset: String(offset),
        limit: String(limit),
      });
      if (filters?.jobFamily) params.set('jobFamily', filters.jobFamily);
      if (industry) params.set('industry', industry);

      try {
        const response = await fetch(`${apiUrl}/v2/positions?${params}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Mercer API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as MercerResponse;
        if (!data.data?.length) break;

        for (const pos of data.data) {
          // Skip positions with too few participants for statistical significance
          if (pos.participantCount < 5) continue;

          const locationLabel = pos.city
            ? `${COUNTRY_LOCATIONS[pos.country] ?? pos.country} - ${pos.city}`
            : COUNTRY_LOCATIONS[pos.country] ?? pos.country;

          bands.push({
            jobFamily: pos.jobFamily,
            level: MERCER_LEVEL_MAP[pos.careerLevel] ?? pos.careerLevel,
            location: locationLabel,
            currency: pos.currency,
            p10: pos.baseSalary.p10,
            p25: pos.baseSalary.p25,
            p50: pos.baseSalary.p50,
            p75: pos.baseSalary.p75,
            p90: pos.baseSalary.p90,
            source: `Mercer TRS ${pos.surveyYear} (${pos.participantCount} participants)`,
            effectiveDate: new Date(`${pos.surveyYear}-01-01`),
            expiresAt: new Date(`${pos.surveyYear}-12-31`),
          });
        }

        hasMore = offset + limit < data.meta.total;
        offset += limit;
      } catch (error) {
        this.logger.warn(`Mercer API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.apiUrl}/v2/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
