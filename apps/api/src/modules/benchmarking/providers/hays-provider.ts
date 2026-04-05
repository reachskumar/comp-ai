import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Hays Salary Guide API integration.
 *
 * Coverage: UK, Germany, France, Benelux, Australia, New Zealand, APAC.
 * Sector-specific data (IT, Engineering, Finance, Construction, etc.).
 * Annual survey data with quarterly updates.
 *
 * Config:
 *   apiUrl  - Hays API base URL
 *   apiKey  - API key from Hays data partnership
 *   country - ISO 3166-1 alpha-2 country code (e.g., "GB", "DE", "FR", "AU")
 *   sector  - Sector filter (e.g., "IT", "Engineering", "Finance", "Construction")
 */

interface HaysPosition {
  roleId: string;
  roleTitle: string;
  sector: string;
  subSector: string;
  seniorityLevel: string;
  country: string;
  region?: string;
  currency: string;
  annualSalary: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  surveyYear: number;
  surveyQuarter: number;
  respondentCount: number;
  employerCount: number;
}

interface HaysResponse {
  success: boolean;
  data: HaysPosition[];
  meta: { total: number; offset: number; limit: number };
}

// Hays seniority levels → internal level mapping
const HAYS_LEVEL_MAP: Record<string, string> = {
  'Graduate/Trainee': 'IC1',
  Junior: 'IC2',
  'Mid-Level': 'IC3',
  Senior: 'IC4',
  Specialist: 'IC5',
  'Principal/Lead': 'IC6',
  'Team Leader': 'Manager',
  Manager: 'Manager',
  'Senior Manager': 'Senior Manager',
  'Head of Department': 'Director',
  Director: 'Director',
  'Managing Director': 'VP',
  'C-Level': 'C-Suite',
};

// Country code → location label
const COUNTRY_LABELS: Record<string, string> = {
  GB: 'UK',
  DE: 'Germany',
  FR: 'France',
  BE: 'Belgium',
  NL: 'Netherlands',
  LU: 'Luxembourg',
  AU: 'Australia',
  NZ: 'New Zealand',
  SG: 'Singapore',
  HK: 'Hong Kong',
  MY: 'Malaysia',
  JP: 'Japan',
  CN: 'China',
  AT: 'Austria',
  CH: 'Switzerland',
  IE: 'Ireland',
  PL: 'Poland',
  CZ: 'Czech Republic',
  HU: 'Hungary',
};

export class HaysProvider implements MarketDataProviderAdapter {
  readonly name = 'HAYS';
  private readonly logger = new Logger(HaysProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (!config.country) errors.push('country is required (ISO 3166 code, e.g., "GB", "DE", "FR")');
    if (config.sector && typeof config.sector !== 'string') {
      errors.push('sector must be a string (e.g., "IT", "Engineering", "Finance")');
    }
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const country = config.country as string;
    const sector = config.sector as string | undefined;

    const bands: NormalizedBand[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        country,
        offset: String(offset),
        limit: String(limit),
      });
      if (sector) params.set('sector', sector);
      if (filters?.jobFamily) params.set('subSector', filters.jobFamily);
      if (filters?.location) params.set('region', filters.location);

      try {
        const response = await fetch(`${apiUrl}/v1/salary-guide/positions?${params}`, {
          method: 'GET',
          headers: {
            'X-Api-Key': apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Hays API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as HaysResponse;
        if (!data.success || !data.data?.length) break;

        for (const pos of data.data) {
          // Skip positions with fewer than 5 employers for statistical significance
          if (pos.employerCount < 5) continue;

          const countryLabel = COUNTRY_LABELS[pos.country] ?? pos.country;
          const locationLabel = pos.region
            ? `${countryLabel} - ${pos.region}`
            : countryLabel;

          bands.push({
            jobFamily: pos.subSector || pos.sector,
            level: HAYS_LEVEL_MAP[pos.seniorityLevel] ?? pos.seniorityLevel,
            location: locationLabel,
            currency: pos.currency,
            p10: pos.annualSalary.p10,
            p25: pos.annualSalary.p25,
            p50: pos.annualSalary.p50,
            p75: pos.annualSalary.p75,
            p90: pos.annualSalary.p90,
            source: `Hays Salary Guide ${pos.surveyYear} Q${pos.surveyQuarter} (${pos.respondentCount} respondents, ${pos.employerCount} employers)`,
            effectiveDate: new Date(`${pos.surveyYear}-${String(pos.surveyQuarter * 3 - 2).padStart(2, '0')}-01`),
            expiresAt: new Date(`${pos.surveyYear}-12-31`),
          });
        }

        hasMore = offset + limit < data.meta.total;
        offset += limit;
      } catch (error) {
        this.logger.warn(`Hays API fetch failed: ${(error as Error).message}`);
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
