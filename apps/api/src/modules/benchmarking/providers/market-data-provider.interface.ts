/**
 * Normalized salary band from any market data provider.
 * All providers must map their data to this common format.
 */
export interface NormalizedBand {
  jobFamily: string;
  level: string;
  location: string;
  currency: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  source: string;
  effectiveDate: Date;
  expiresAt?: Date;
}

/**
 * Provider-specific configuration stored in MarketDataSource.config JSON.
 */
export interface ProviderConfig {
  /** API base URL */
  apiUrl?: string;
  /** API key or token */
  apiKey?: string;
  /** Additional provider-specific settings */
  [key: string]: unknown;
}

export interface SyncResult {
  provider: string;
  bandsImported: number;
  bandsSkipped: number;
  errors: string[];
  syncedAt: Date;
}

/**
 * All market data providers must implement this interface.
 * Each provider normalizes external data into NormalizedBand[].
 */
export interface MarketDataProviderAdapter {
  /** Unique provider identifier */
  readonly name: string;

  /** Validate provider-specific config before saving */
  validateConfig(config: ProviderConfig): string[];

  /**
   * Fetch salary bands from the external source.
   * @param config - Provider-specific configuration
   * @param filters - Optional filters (job family, location, etc.)
   */
  fetchBands(
    config: ProviderConfig,
    filters?: { jobFamily?: string; location?: string },
  ): Promise<NormalizedBand[]>;

  /** Check if the provider connection is healthy */
  healthCheck(config: ProviderConfig): Promise<boolean>;
}
