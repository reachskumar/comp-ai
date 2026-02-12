import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CompportMode = 'standalone' | 'shared_db' | 'api_bridge';

/**
 * Centralized configuration for the Compport PHP Bridge module.
 * Validates configuration at startup and provides typed access.
 */
@Injectable()
export class CompportBridgeConfig {
  private readonly logger = new Logger(CompportBridgeConfig.name);

  readonly mode: CompportMode;
  readonly apiUrl: string | undefined;
  readonly apiKey: string | undefined;
  readonly dbPrefix: string;
  readonly sessionSecret: string | undefined;
  readonly nodeEnv: string;

  constructor(private readonly configService: ConfigService) {
    this.nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    this.mode = (this.configService.get<string>('COMPPORT_MODE') ?? 'standalone') as CompportMode;
    this.apiUrl = this.configService.get<string>('COMPPORT_API_URL');
    this.apiKey = this.configService.get<string>('COMPPORT_API_KEY');
    this.dbPrefix = this.configService.get<string>('COMPPORT_DB_PREFIX') ?? 'compport_';
    this.sessionSecret = this.configService.get<string>('COMPPORT_SESSION_SECRET');

    this.validate();
    this.logger.log(`Compport bridge initialized in "${this.mode}" mode`);
  }

  get isStandalone(): boolean {
    return this.mode === 'standalone';
  }

  get isSharedDb(): boolean {
    return this.mode === 'shared_db';
  }

  get isApiBridge(): boolean {
    return this.mode === 'api_bridge';
  }

  /**
   * Mask sensitive values for safe logging.
   * SECURITY: Never log raw API keys or secrets.
   */
  getMaskedApiKey(): string {
    if (!this.apiKey) return '(not set)';
    if (this.apiKey.length <= 8) return '****';
    return `${this.apiKey.slice(0, 4)}...${this.apiKey.slice(-4)}`;
  }

  private validate(): void {
    if (this.mode === 'api_bridge') {
      if (!this.apiUrl) {
        throw new Error('COMPPORT_API_URL is required when COMPPORT_MODE=api_bridge');
      }
      if (!this.apiKey) {
        throw new Error('COMPPORT_API_KEY is required when COMPPORT_MODE=api_bridge');
      }
      // SECURITY: Enforce HTTPS in production
      if (this.nodeEnv !== 'development' && !this.apiUrl.startsWith('https://')) {
        throw new Error(
          'COMPPORT_API_URL must use HTTPS in non-development environments',
        );
      }
    }

    if (this.mode === 'shared_db' && !this.dbPrefix) {
      throw new Error('COMPPORT_DB_PREFIX is required when COMPPORT_MODE=shared_db');
    }
  }
}

