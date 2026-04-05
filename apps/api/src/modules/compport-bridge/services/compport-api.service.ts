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

// ─── Circuit Breaker ──────────────────────────────────────

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 60_000,
  ) {}

  get isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      // Check if reset timeout has elapsed → transition to half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

/**
 * REST client for Compport PHP API bridge mode.
 * SECURITY:
 * - HTTPS enforced in production (validated in config)
 * - API key never logged (masked in all output)
 * - All responses validated with Zod schemas
 * - Retry with exponential backoff
 * - Response caching with configurable TTL
 * - Circuit breaker prevents cascading failures
 */
// ─── API Version Endpoint Mapping ─────────────────────────

interface VersionEndpoints {
  employees: string;
  compensation: string;
  users: string;
  health: string;
}

const API_VERSIONS: Record<string, VersionEndpoints> = {
  v1: {
    employees: '/employees',
    compensation: '/compensation',
    users: '/users',
    health: '/health',
  },
  v2: {
    employees: '/api/v2/employees',
    compensation: '/api/v2/compensation',
    users: '/api/v2/users',
    health: '/api/v2/health',
  },
  v3: {
    employees: '/api/v3/hr/employees',
    compensation: '/api/v3/compensation/data',
    users: '/api/v3/identity/users',
    health: '/api/v3/system/health',
  },
};

@Injectable()
export class CompportApiService {
  private readonly logger = new Logger(CompportApiService.name);
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly circuitBreaker = new CircuitBreaker(5, 60_000);
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 1000;
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 1000;
  private detectedVersion: string | null = null;
  private readonly endpoints: VersionEndpoints;

  constructor(private readonly config: CompportBridgeConfig) {
    // Use configured version or default to v1
    const version = (this.config as unknown as Record<string, string>).apiVersion ?? 'v1';
    this.endpoints = API_VERSIONS[version] ?? API_VERSIONS['v1']!;
  }

  /**
   * Auto-detect the Compport API version by probing endpoints.
   * Called lazily on first request if version not explicitly configured.
   */
  async detectApiVersion(): Promise<string> {
    if (this.detectedVersion) return this.detectedVersion;

    for (const [version, endpoints] of Object.entries(API_VERSIONS).reverse()) {
      try {
        const response = await fetch(`${this.config.apiUrl}${endpoints.health}`, {
          method: 'GET',
          headers: {
            'X-API-Key': this.config.apiKey ?? '',
            'User-Agent': 'CompportBridge/1.0',
          },
          signal: AbortSignal.timeout(5_000),
        });

        if (response.ok) {
          this.detectedVersion = version;
          this.logger.log(`Detected Compport API version: ${version}`);
          return version;
        }
      } catch {
        // Try next version
      }
    }

    this.detectedVersion = 'v1';
    this.logger.warn('Could not detect Compport API version, defaulting to v1');
    return 'v1';
  }

  /** Get the resolved endpoint paths for the current API version */
  getEndpoints(): VersionEndpoints {
    if (this.detectedVersion && API_VERSIONS[this.detectedVersion]) {
      return API_VERSIONS[this.detectedVersion]!;
    }
    return this.endpoints;
  }

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

    const ep = this.getEndpoints();
    const response = await this.request(`${ep.employees}?tenant_id=${encodeURIComponent(tenantId)}`);
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

    const ep = this.getEndpoints();
    const response = await this.request(`${ep.compensation}?tenant_id=${encodeURIComponent(tenantId)}`);
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

    const ep = this.getEndpoints();
    const response = await this.request(`${ep.users}?tenant_id=${encodeURIComponent(tenantId)}`);
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
      const ep = this.getEndpoints();
      await this.request(ep.health);
      return true;
    } catch {
      return false;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Make an HTTP request to the Compport PHP API with retry logic and circuit breaker.
   * SECURITY: API key sent in header, never logged.
   */
  private async request(path: string, retryCount = 0): Promise<unknown> {
    if (this.circuitBreaker.isOpen) {
      this.logger.warn(`Circuit breaker OPEN — skipping Compport API call: ${path}`);
      throw new Error('Compport API circuit breaker is open — service temporarily unavailable');
    }

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
      this.circuitBreaker.recordSuccess();

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

      this.circuitBreaker.recordFailure();
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
    // Evict oldest entries if cache exceeds max size
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

