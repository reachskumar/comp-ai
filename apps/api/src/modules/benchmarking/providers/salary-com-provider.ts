import { Logger } from '@nestjs/common';
import type {
  MarketDataProviderAdapter,
  NormalizedBand,
  ProviderConfig,
} from './market-data-provider.interface';

/**
 * Salary.com CompAnalyst API integration.
 *
 * Requires paid API subscription.
 * Data: US-primary with international expansion, job-level granularity.
 * API Docs: Available after enterprise partnership.
 *
 * Config:
 *   apiUrl   - CompAnalyst API base URL
 *   apiKey   - API authentication key
 *   clientId - Client identifier for multi-tenant access
 *   country  - ISO 3166-1 alpha-2 country code (default: "US")
 */

interface SalaryComJob {
  jobCode: string;
  jobTitle: string;
  jobFamily: string;
  level: string;
  location: string;
  currency: string;
  percentiles: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  effectiveDate: string;
  surveyYear: number;
}

interface SalaryComResponse {
  success: boolean;
  data: SalaryComJob[];
  pagination?: { total: number; page: number; pageSize: number };
}

export class SalaryComProvider implements MarketDataProviderAdapter {
  readonly name = 'SALARY_COM';
  private readonly logger = new Logger(SalaryComProvider.name);

  validateConfig(config: ProviderConfig): string[] {
    const errors: string[] = [];
    if (!config.apiUrl) errors.push('apiUrl is required');
    if (!config.apiKey) errors.push('apiKey is required');
    if (!config.clientId) errors.push('clientId is required');
    return errors;
  }

  async fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]> {
    const apiUrl = config.apiUrl as string;
    const apiKey = config.apiKey as string;
    const clientId = config.clientId as string;
    const country = (config.country as string) ?? 'US';

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
      if (filters?.jobFamily) params.set('jobFamily', filters.jobFamily);
      if (filters?.location) params.set('location', filters.location);

      try {
        const response = await fetch(`${apiUrl}/v1/market-data?${params}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Client-Id': clientId,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          this.logger.warn(`Salary.com API returned ${response.status}`);
          break;
        }

        const data = (await response.json()) as SalaryComResponse;
        if (!data.success || !data.data?.length) break;

        for (const job of data.data) {
          bands.push({
            jobFamily: job.jobFamily,
            level: job.level,
            location: job.location,
            currency: job.currency,
            p10: job.percentiles.p10,
            p25: job.percentiles.p25,
            p50: job.percentiles.p50,
            p75: job.percentiles.p75,
            p90: job.percentiles.p90,
            source: `Salary.com ${job.surveyYear}`,
            effectiveDate: new Date(job.effectiveDate),
            expiresAt: new Date(`${job.surveyYear}-12-31`),
          });
        }

        hasMore = data.pagination ? page * pageSize < data.pagination.total : false;
        page++;
      } catch (error) {
        this.logger.warn(`Salary.com API fetch failed: ${(error as Error).message}`);
        break;
      }
    }

    return bands;
  }

  async healthCheck(config: ProviderConfig): Promise<boolean> {
    try {
      const response = await fetch(`${config.apiUrl}/v1/health`, {
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
