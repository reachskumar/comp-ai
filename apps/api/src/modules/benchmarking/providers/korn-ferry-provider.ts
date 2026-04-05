import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Korn Ferry Hay Group Pay API integration.
 *
 * Enterprise API — requires Korn Ferry partnership agreement.
 * Data: 100+ countries, job evaluation methodology (Hay points).
 * Supports grade-based and market-based pricing.
 * Strong in manufacturing, pharmaceuticals, FMCG, financial services.
 *
 * Config:
 *   apiUrl              - Korn Ferry API gateway URL
 *   apiKey              - API key or OAuth2 token
 *   clientId            - Client identifier for multi-tenant access
 *   country             - ISO 3166-1 alpha-2 country code
 *   jobEvaluationMethod - "hay_points" | "market_pricing" (default: "market_pricing")
 */

interface KornFerryPosition {
  positionCode: string;
  positionTitle: string;
  jobFamily: string;
  hayGrade: string;
  hayPoints?: number;
  careerLevel: string;
  country: string;
  sector: string;
  currency: string;
  baseSalary: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  totalRemuneration?: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  surveyYear: number;
  organizationCount: number;
  incumbentCount: number;
}

interface KornFerryResponse {
  success: boolean;
  data: KornFerryPosition[];
  meta: { total: number; offset: number; limit: number };
}

// Korn Ferry career levels → internal level mapping
const KF_LEVEL_MAP: Record<string, string> = {
  'Professional 1': 'IC1',
  'Professional 2': 'IC2',
  'Professional 3': 'IC3',
  'Professional 4': 'IC4',
  'Expert/Specialist': 'IC5',
  'Principal/Fellow': 'IC6',
  'Team Lead': 'Manager',
  Manager: 'Manager',
  'Senior Manager': 'Senior Manager',
  Director: 'Director',
  'Vice President': 'VP',
  'Senior Vice President': 'SVP',
  'Executive/C-Level': 'C-Suite',
};

// Country code → location label
const COUNTRY_LABELS: Record<string, string> = {
  US: 'US',
  IN: 'India',
  GB: 'UK',
  DE: 'Germany',
  FR: 'France',
  CH: 'Switzerland',
  NL: 'Netherlands',
  BE: 'Belgium',
  AU: 'Australia',
  SG: 'Singapore',
  JP: 'Japan',
  CN: 'China',
  BR: 'Brazil',
  MX: 'Mexico',
  ZA: 'South Africa',
  AE: 'UAE',
  CA: 'Canada',
};

export class KornFerryProvider implements MarketDataProviderAdapter {
  readonly name = 'KORN_FERRY';
  private readonly logger = new Logger(KornFerryProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (!config.clientId) errors.push('clientId is required');
    if (!config.country) errors.push('country is required (ISO 3166 code)');
    if (
      config.jobEvaluationMethod &&
      !['hay_points', 'market_pricing'].includes(config.jobEvaluationMethod as string)
    ) {
      errors.push('jobEvaluationMethod must be "hay_points" or "market_pricing"');
    }
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const clientId = config.clientId as string;
    const country = config.country as string;
    const method = (config.jobEvaluationMethod as string) ?? 'market_pricing';

    const bands: NormalizedBand[] = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        country,
        method,
        offset: String(offset),
        limit: String(limit),
      });
      if (filters?.jobFamily) params.set('jobFamily', filters.jobFamily);
      if (filters?.location) params.set('location', filters.location);

      try {
        const response = await fetch(`${apiUrl}/v2/compensation/positions?${params}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Client-Id': clientId,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Korn Ferry API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as KornFerryResponse;
        if (!data.success || !data.data?.length) break;

        for (const pos of data.data) {
          // Skip positions with fewer than 5 organizations for statistical significance
          if (pos.organizationCount < 5) continue;

          const locationLabel = COUNTRY_LABELS[pos.country] ?? pos.country;

          bands.push({
            jobFamily: pos.jobFamily,
            level: KF_LEVEL_MAP[pos.careerLevel] ?? pos.careerLevel,
            location: locationLabel,
            currency: pos.currency,
            p10: pos.baseSalary.p10,
            p25: pos.baseSalary.p25,
            p50: pos.baseSalary.p50,
            p75: pos.baseSalary.p75,
            p90: pos.baseSalary.p90,
            source: `Korn Ferry Hay ${pos.surveyYear} (${pos.organizationCount} orgs, ${pos.incumbentCount} incumbents)`,
            effectiveDate: new Date(`${pos.surveyYear}-01-01`),
            expiresAt: new Date(`${pos.surveyYear}-12-31`),
          });
        }

        hasMore = offset + limit < data.meta.total;
        offset += limit;
      } catch (error) {
        this.logger.warn(`Korn Ferry API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.apiUrl}/v2/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'X-Client-Id': config.clientId as string,
        },
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
