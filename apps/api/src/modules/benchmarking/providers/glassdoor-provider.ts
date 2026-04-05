import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Glassdoor Salary API integration (Partner API program).
 *
 * Partner API — requires Glassdoor partner agreement.
 * Data: Employee-reported salaries, company-level and job-level.
 * Good as a validation/secondary source alongside enterprise surveys.
 *
 * Config:
 *   partnerId - Glassdoor Partner ID
 *   apiKey    - Partner API key
 *   country   - ISO 3166-1 alpha-2 country code (default: "US")
 */

interface GlassdoorSalary {
  jobTitle: string;
  jobCategory: string;
  seniorityLevel: string;
  employer?: string;
  location: {
    country: string;
    state?: string;
    metro?: string;
  };
  currency: string;
  payPercentiles: {
    payPercentile10: number;
    payPercentile25: number;
    payPercentile50: number;
    payPercentile75: number;
    payPercentile90: number;
  };
  lastUpdated: string;
  sampleSize: number;
}

interface GlassdoorResponse {
  success: boolean;
  status: number;
  response: {
    salaries: GlassdoorSalary[];
    totalCount: number;
    page: number;
    pageSize: number;
  };
}

// Glassdoor seniority levels → internal level mapping
const GLASSDOOR_LEVEL_MAP: Record<string, string> = {
  Intern: 'Intern',
  'Entry Level': 'IC1',
  Junior: 'IC2',
  'Mid-Level': 'IC3',
  Senior: 'IC4',
  Lead: 'IC5',
  Staff: 'IC5',
  Principal: 'IC6',
  Manager: 'Manager',
  'Senior Manager': 'Senior Manager',
  Director: 'Director',
  'Vice President': 'VP',
  'C-Suite': 'C-Suite',
};

export class GlassdoorProvider implements MarketDataProviderAdapter {
  readonly name = 'GLASSDOOR';
  private readonly logger = new Logger(GlassdoorProvider.name);
  private readonly BASE_URL = 'https://api.glassdoor.com/api/api.htm';

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.partnerId) errors.push('partnerId is required');
    if (!config.apiKey) errors.push('apiKey is required');
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const partnerId = config.partnerId as string;
    const apiKey = config.apiKey as string;
    const country = (config.country as string) ?? 'US';

    const bands: NormalizedBand[] = [];
    let page = 1;
    const pageSize = 50;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        't.p': partnerId,
        't.k': apiKey,
        action: 'salaries',
        format: 'json',
        country,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (filters?.jobFamily) params.set('jobCategory', filters.jobFamily);
      if (filters?.location) params.set('location', filters.location);

      try {
        const response = await fetch(`${this.BASE_URL}?${params}`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Glassdoor API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as GlassdoorResponse;
        if (!data.success || !data.response?.salaries?.length) break;

        for (const salary of data.response.salaries) {
          // Skip low-confidence data with fewer than 10 respondents
          if (salary.sampleSize < 10) continue;

          const locationParts = [salary.location.country];
          if (salary.location.state) locationParts.push(salary.location.state);
          if (salary.location.metro) locationParts.push(salary.location.metro);

          const reportYear = new Date(salary.lastUpdated).getFullYear();

          bands.push({
            jobFamily: salary.jobCategory,
            level: GLASSDOOR_LEVEL_MAP[salary.seniorityLevel] ?? salary.seniorityLevel,
            location: locationParts.join(' - '),
            currency: salary.currency,
            p10: salary.payPercentiles.payPercentile10,
            p25: salary.payPercentiles.payPercentile25,
            p50: salary.payPercentiles.payPercentile50,
            p75: salary.payPercentiles.payPercentile75,
            p90: salary.payPercentiles.payPercentile90,
            source: `Glassdoor ${reportYear} (${salary.sampleSize} reports)`,
            effectiveDate: new Date(salary.lastUpdated),
            expiresAt: new Date(`${reportYear}-12-31`),
          });
        }

        hasMore = page * pageSize < data.response.totalCount;
        page++;
      } catch (error) {
        this.logger.warn(`Glassdoor API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        't.p': config.partnerId as string,
        't.k': config.apiKey as string,
        action: 'health',
        format: 'json',
      });

      const response = await fetch(`${this.BASE_URL}?${params}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });

      const data = (await response.json()) as GlassdoorResponse;
      return data.success;
    } catch {
      return false;
    }
  }
}
