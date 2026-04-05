import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Economic Research Institute (ERI) Salary Assessor API integration.
 *
 * US/Canada focus with executive compensation data.
 * Built-in cost-of-living adjustments and geographic differential data.
 * Strong for location-based pay analysis and relocation pricing.
 *
 * Config:
 *   apiUrl    - ERI API base URL
 *   apiKey    - API key from ERI subscription
 *   country   - "US" or "CA" (default: "US")
 *   metroArea - Metro area for geographic differentials (e.g., "San Francisco, CA", "Toronto, ON")
 */

interface EriPosition {
  positionCode: string;
  positionTitle: string;
  jobFamily: string;
  level: string;
  metroArea: string;
  state: string;
  country: string;
  currency: string;
  baseSalary: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  totalCompensation?: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  costOfLivingIndex: number;
  geographicDifferential: number;
  surveyYear: number;
  participantCount: number;
  effectiveDate: string;
}

interface EriResponse {
  success: boolean;
  results: EriPosition[];
  pagination: { total: number; page: number; pageSize: number };
}

// ERI level codes → internal level mapping
const ERI_LEVEL_MAP: Record<string, string> = {
  'Entry': 'IC1',
  'Intermediate': 'IC2',
  'Experienced': 'IC3',
  'Senior': 'IC4',
  'Lead/Expert': 'IC5',
  'Principal/Fellow': 'IC6',
  'Supervisor': 'Manager',
  'Manager': 'Manager',
  'Senior Manager': 'Senior Manager',
  'Director': 'Director',
  'Vice President': 'VP',
  'Senior Vice President': 'SVP',
  'Executive': 'C-Suite',
  'Chief Officer': 'C-Suite',
};

export class EriProvider implements MarketDataProviderAdapter {
  readonly name = 'ERI';
  private readonly logger = new Logger(EriProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (config.country && !['US', 'CA'].includes(config.country as string)) {
      errors.push('country must be "US" or "CA"');
    }
    if (config.metroArea && typeof config.metroArea !== 'string') {
      errors.push('metroArea must be a string (e.g., "San Francisco, CA")');
    }
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const country = (config.country as string) ?? 'US';
    const metroArea = (config.metroArea as string) ?? (filters?.location as string | undefined);

    const bands: NormalizedBand[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        country,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (metroArea) params.set('metroArea', metroArea);
      if (filters?.jobFamily) params.set('jobFamily', filters.jobFamily);

      try {
        const response = await fetch(`${apiUrl}/v1/salary-assessor/positions?${params}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`ERI API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as EriResponse;
        if (!data.success || !data.results?.length) break;

        for (const pos of data.results) {
          // Skip positions with fewer than 5 participants for statistical significance
          if (pos.participantCount < 5) continue;

          const locationLabel = pos.metroArea
            ? `${pos.country} - ${pos.metroArea}`
            : `${pos.country} - ${pos.state}`;

          bands.push({
            jobFamily: pos.jobFamily,
            level: ERI_LEVEL_MAP[pos.level] ?? pos.level,
            location: locationLabel,
            currency: pos.currency,
            p10: pos.baseSalary.p10,
            p25: pos.baseSalary.p25,
            p50: pos.baseSalary.p50,
            p75: pos.baseSalary.p75,
            p90: pos.baseSalary.p90,
            source: `ERI Salary Assessor ${pos.surveyYear} (${pos.participantCount} participants, COL index: ${pos.costOfLivingIndex})`,
            effectiveDate: new Date(pos.effectiveDate),
            expiresAt: new Date(`${pos.surveyYear}-12-31`),
          });
        }

        hasMore = page * pageSize < data.pagination.total;
        page++;
      } catch (error) {
        this.logger.warn(`ERI API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.apiUrl}/v1/health`, {
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
