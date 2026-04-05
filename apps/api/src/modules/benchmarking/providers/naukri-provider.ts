import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Naukri / InfoEdge India salary data API integration.
 *
 * India-specific provider with 20M+ salary records.
 * City-level granularity across major Indian metros.
 * Experience-level mapping to IC levels.
 *
 * Config:
 *   apiUrl   - Naukri API base URL
 *   apiKey   - API key from InfoEdge partnership
 *   city     - City filter (e.g., "Mumbai", "Bangalore", "Delhi", "Hyderabad")
 *   industry - Industry filter (e.g., "IT", "BFSI", "Manufacturing", "Pharma")
 */

interface NaukriSalaryRecord {
  designationId: string;
  designation: string;
  functionalArea: string;
  experienceBand: string;
  city: string;
  industry: string;
  currency: string;
  annualSalary: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  dataYear: number;
  dataQuarter: number;
  respondentCount: number;
}

interface NaukriResponse {
  status: string;
  data: NaukriSalaryRecord[];
  pagination: { total: number; offset: number; limit: number };
}

// Naukri experience bands → internal level mapping
const EXPERIENCE_LEVEL_MAP: Record<string, string> = {
  '0-1': 'IC1',
  '1-3': 'IC1',
  '3-5': 'IC2',
  '5-8': 'IC3',
  '8-12': 'IC4',
  '12-16': 'IC5',
  '16-20': 'IC6',
  '20+': 'IC6',
  'Manager 5-8': 'Manager',
  'Manager 8-12': 'Senior Manager',
  'Manager 12-16': 'Director',
  'Manager 16+': 'VP',
};

// Major Indian cities for location labeling
const CITY_LABELS: Record<string, string> = {
  mumbai: 'India - Mumbai',
  bangalore: 'India - Bangalore',
  bengaluru: 'India - Bangalore',
  delhi: 'India - Delhi NCR',
  'new delhi': 'India - Delhi NCR',
  gurgaon: 'India - Delhi NCR',
  gurugram: 'India - Delhi NCR',
  noida: 'India - Delhi NCR',
  hyderabad: 'India - Hyderabad',
  pune: 'India - Pune',
  chennai: 'India - Chennai',
  kolkata: 'India - Kolkata',
  ahmedabad: 'India - Ahmedabad',
  kochi: 'India - Kochi',
  thiruvananthapuram: 'India - Thiruvananthapuram',
  jaipur: 'India - Jaipur',
  chandigarh: 'India - Chandigarh',
  coimbatore: 'India - Coimbatore',
};

export class NaukriProvider implements MarketDataProviderAdapter {
  readonly name = 'NAUKRI';
  private readonly logger = new Logger(NaukriProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (config.city && typeof config.city !== 'string') {
      errors.push('city must be a string (e.g., "Bangalore", "Mumbai")');
    }
    if (config.industry && typeof config.industry !== 'string') {
      errors.push('industry must be a string (e.g., "IT", "BFSI")');
    }
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const city = (config.city as string) ?? (filters?.location as string | undefined);
    const industry = config.industry as string | undefined;

    const bands: NormalizedBand[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      });
      if (city) params.set('city', city);
      if (industry) params.set('industry', industry);
      if (filters?.jobFamily) params.set('functionalArea', filters.jobFamily);

      try {
        const response = await fetch(`${apiUrl}/v1/salary-data?${params}`, {
          method: 'GET',
          headers: {
            'X-Api-Key': apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Naukri API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as NaukriResponse;
        if (data.status !== 'success' || !data.data?.length) break;

        for (const record of data.data) {
          // Skip records with fewer than 10 respondents for statistical reliability
          if (record.respondentCount < 10) continue;

          const cityKey = record.city.toLowerCase();
          const locationLabel = CITY_LABELS[cityKey] ?? `India - ${record.city}`;

          bands.push({
            jobFamily: record.functionalArea,
            level: EXPERIENCE_LEVEL_MAP[record.experienceBand] ?? record.experienceBand,
            location: locationLabel,
            currency: record.currency || 'INR',
            p10: record.annualSalary.p10,
            p25: record.annualSalary.p25,
            p50: record.annualSalary.p50,
            p75: record.annualSalary.p75,
            p90: record.annualSalary.p90,
            source: `Naukri ${record.dataYear} Q${record.dataQuarter} (${record.respondentCount} respondents)`,
            effectiveDate: new Date(`${record.dataYear}-${String(record.dataQuarter * 3 - 2).padStart(2, '0')}-01`),
            expiresAt: new Date(`${record.dataYear}-12-31`),
          });
        }

        hasMore = offset + limit < data.pagination.total;
        offset += limit;
      } catch (error) {
        this.logger.warn(`Naukri API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.apiUrl}/v1/health`, {
        method: 'GET',
        headers: { 'X-Api-Key': config.apiKey as string },
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
