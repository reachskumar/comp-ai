import { Injectable, Logger } from '@nestjs/common';
import { CompportBridgeConfig } from '../config/compport-bridge.config';
import {
  CompportApiResponseSchema,
  CompportEmployeeArraySchema,
  CompportCompensationArraySchema,
  CompportUserArraySchema,
  type CompportEmployee,
  type CompportCompensation,
  type CompportUser,
  type SyncResult,
} from '../schemas/compport-data.schemas';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * REST client for Compport PHP API bridge mode.
 * SECURITY:
 * - HTTPS enforced in production (validated in config)
 * - API key never logged (masked in all output)
 * - All responses validated with Zod schemas
 * - Retry with exponential backoff
 * - Response caching with configurable TTL
 */
@Injectable()
export class CompportApiService {
  private readonly logger = new Logger(CompportApiService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 1000;

  constructor(private readonly config: CompportBridgeConfig) {}

  async syncEmployees(tenantId: string): Promise<SyncResult> {
    if (!this.config.isApiBridge) {
      return { synced: 0, skipped: 0, errors: 0, details: [] };
    }
    const data = await this.fetchEmployees(tenantId);
    return {
      synced: data.length,
      skipped: 0,
      errors: 0,
      details: data.map((e) => ({ id: e.id, status: 'synced' as const })),
    };
  }

  async fetchEmployees(tenantId: string): Promise<CompportEmployee[]> {
    if (!this.config.isApiBridge) return [];
    const cacheKey = `employees:${tenantId}`;
    const cached = this.getFromCache<CompportEmployee[]>(cacheKey);
    if (cached) return cached;

    const response = await this.request(`/employees?tenant_id=${encodeURIComponent(tenantId)}`);
    const validated = CompportEmployeeArraySchema.safeParse(response);
    if (!validated.success) {
      this.logger.warn(`Employee data validation failed: ${validated.error.message}`);
      return [];
    }
    this.setCache(cacheKey, validated.data);
    return validated.data;
  }

  async fetchCompensationData(tenantId: string): Promise<CompportCompensation[]> {
    if (!this.config.isApiBridge) return [];
    const cacheKey = `compensation:${tenantId}`;
    const cached = this.getFromCache<CompportCompensation[]>(cacheKey);
    if (cached) return cached;

    const response = await this.request(`/compensation?tenant_id=${encodeURIComponent(tenantId)}`);
    const validated = CompportCompensationArraySchema.safeParse(response);
    if (!validated.success) {
      this.logger.warn(`Compensation data validation failed: ${validated.error.message}`);
      return [];
    }
    this.setCache(cacheKey, validated.data);
    return validated.data;
  }

  async syncUsers(tenantId: string): Promise<SyncResult> {
    if (!this.config.isApiBridge) {
      return { synced: 0, skipped: 0, errors: 0, details: [] };
    }
    const data = await this.fetchUsers(tenantId);
    return {
      synced: data.length,
      skipped: 0,
      errors: 0,
      details: data.map((u) => ({ id: u.id, status: 'synced' as const })),
    };
  }

  async fetchUsers(tenantId: string): Promise<CompportUser[]> {
    if (!this.config.isApiBridge) return [];
    const cacheKey = `users:${tenantId}`;
    const cached = this.getFromCache<CompportUser[]>(cacheKey);
    if (cached) return cached;

    const response = await this.request(`/users?tenant_id=${encodeURIComponent(tenantId)}`);
    const validated = CompportUserArraySchema.safeParse(response);
    if (!validated.success) {
      this.logger.warn(`User data validation failed: ${validated.error.message}`);
      return [];
    }
    this.setCache(cacheKey, validated.data);
    return validated.data;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.config.isApiBridge) return true;
    try {
      await this.request('/health');
      return true;
    } catch {
      return false;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Make an HTTP request to the Compport PHP API with retry logic.
   * SECURITY: API key sent in header, never logged.
   */
  private async request(path: string, retryCount = 0): Promise<unknown> {
    const url = `${this.config.apiUrl}${path}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey ?? '',
          'User-Agent': 'CompportBridge/1.0',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const body = await response.json();

      // Validate API response wrapper
      const apiResponse = CompportApiResponseSchema.safeParse(body);
      if (apiResponse.success && apiResponse.data.data !== undefined) {
        return apiResponse.data.data;
      }

      // If no wrapper, return raw body (some endpoints may not wrap)
      return body;
    } catch (error) {
      const errMsg = (error as Error).message;
      // SECURITY: Do not log URL with query params that might contain sensitive data
      this.logger.warn(
        `Compport API request failed (attempt ${retryCount + 1}/${this.MAX_RETRIES + 1}): ${errMsg}`,
      );

      if (retryCount < this.MAX_RETRIES) {
        const delay = this.BASE_DELAY_MS * Math.pow(2, retryCount);
        await this.sleep(delay);
        return this.request(path, retryCount + 1);
      }

      throw new Error(`Compport API request failed after ${this.MAX_RETRIES + 1} attempts: ${errMsg}`);
    }
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setCache<T>(key: string, data: T, ttlMs = this.DEFAULT_TTL_MS): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

