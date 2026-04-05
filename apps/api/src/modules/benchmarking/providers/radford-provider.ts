import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Radford (Aon) Global Technology Survey API integration.
 *
 * Enterprise API — requires Radford/Aon subscription agreement.
 * Data: 100+ countries, technology-focused, strong equity/stock data.
 * Covers: Software, Hardware, Semiconductor, Life Sciences, Internet/Digital.
 *
 * Config:
 *   apiUrl      - Radford API gateway URL
 *   apiKey      - API key or OAuth2 token
 *   surveyYear  - Survey year (e.g., 2026)
 *   industry    - Industry filter (e.g., "software", "semiconductor", "life_sciences")
 */

interface RadfordPosition {
  positionId: string;
  positionTitle: string;
  jobFamily: string;
  level: string;
  country: string;
  region?: string;
  currency: string;
  baseSalary: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  totalCashCompensation?: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  equity?: {
    grantValueP50: number;
    grantValueP75: number;
    vestingScheduleMonths: number;
  };
  surveyYear: number;
  participantCount: number;
  incumbentCount: number;
}

interface RadfordResponse {
  status: string;
  positions: RadfordPosition[];
  pagination: { total: number; offset: number; limit: number };
}

// Radford levels → internal level mapping
// P = Professional/Individual Contributor, M = Management
const RADFORD_LEVEL_MAP: Record<string, string> = {
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
};

// Country code → location label
const COUNTRY_LABELS: Record<string, string> = {
  US: 'US',
  IN: 'India',
  GB: 'UK',
  DE: 'Germany',
  IE: 'Ireland',
  IL: 'Israel',
  CA: 'Canada',
  AU: 'Australia',
  SG: 'Singapore',
  JP: 'Japan',
  CN: 'China',
  KR: 'South Korea',
  TW: 'Taiwan',
  FR: 'France',
  NL: 'Netherlands',
  SE: 'Sweden',
  FI: 'Finland',
};

export class RadfordProvider implements MarketDataProviderAdapter {
  readonly name = 'RADFORD';
  private readonly logger = new Logger(RadfordProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (!config.surveyYear) errors.push('surveyYear is required (e.g., 2026)');
    if (config.industry && typeof config.industry !== 'string') {
      errors.push('industry must be a string (e.g., "software", "semiconductor")');
    }
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const surveyYear = config.surveyYear as number;
    const industry = config.industry as string | undefined;

    const bands: NormalizedBand[] = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        surveyYear: String(surveyYear),
        offset: String(offset),
        limit: String(limit),
      });
      if (filters?.jobFamily) params.set('jobFamily', filters.jobFamily);
      if (filters?.location) params.set('country', filters.location);
      if (industry) params.set('industry', industry);

      try {
        const response = await fetch(`${apiUrl}/v1/surveys/technology/positions?${params}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Radford API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as RadfordResponse;
        if (data.status !== 'success' || !data.positions?.length) break;

        for (const pos of data.positions) {
          // Skip positions with fewer than 5 participants for statistical significance
          if (pos.participantCount < 5) continue;

          const locationLabel = pos.region
            ? `${COUNTRY_LABELS[pos.country] ?? pos.country} - ${pos.region}`
            : COUNTRY_LABELS[pos.country] ?? pos.country;

          bands.push({
            jobFamily: pos.jobFamily,
            level: RADFORD_LEVEL_MAP[pos.level] ?? pos.level,
            location: locationLabel,
            currency: pos.currency,
            p10: pos.baseSalary.p10,
            p25: pos.baseSalary.p25,
            p50: pos.baseSalary.p50,
            p75: pos.baseSalary.p75,
            p90: pos.baseSalary.p90,
            source: `Radford GTS ${pos.surveyYear} (${pos.participantCount} participants, ${pos.incumbentCount} incumbents)`,
            effectiveDate: new Date(`${pos.surveyYear}-01-01`),
            expiresAt: new Date(`${pos.surveyYear}-12-31`),
          });
        }

        hasMore = offset + limit < data.pagination.total;
        offset += limit;
      } catch (error) {
        this.logger.warn(`Radford API fetch failed: ${(error as Error).message}`);
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
