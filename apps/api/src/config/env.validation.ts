import { plainToInstance, Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsIn, validateSync } from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @Transform(({ value }) => (value != null ? parseInt(String(value), 10) : value))
  @IsNumber()
  @IsOptional()
  API_PORT?: number = 4000;

  @IsString()
  @IsOptional()
  NODE_ENV?: string = 'development';

  // ---- Logging ----

  @IsString()
  @IsOptional()
  @IsIn(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
  LOG_LEVEL?: string;

  // ---- Lifecycle ----

  @Transform(({ value }) => (value != null ? parseInt(String(value), 10) : value))
  @IsNumber()
  @IsOptional()
  SHUTDOWN_TIMEOUT?: number = 30000;

  // ---- AI Provider ----

  @IsString()
  @IsOptional()
  @IsIn(['openai', 'azure'])
  AI_PROVIDER?: string = 'openai';

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;

  @IsString()
  @IsOptional()
  AZURE_OPENAI_API_KEY?: string;

  @IsString()
  @IsOptional()
  AZURE_OPENAI_ENDPOINT?: string;

  @IsString()
  @IsOptional()
  AZURE_OPENAI_DEPLOYMENT_NAME?: string;

  @IsString()
  @IsOptional()
  AZURE_OPENAI_API_VERSION?: string;

  // ---- Azure AD SSO ----

  @IsString()
  @IsOptional()
  AZURE_AD_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  AZURE_AD_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  AZURE_AD_TENANT_ID?: string;

  @IsString()
  @IsOptional()
  AZURE_AD_REDIRECT_URI?: string;

  // ---- Compport PHP Bridge ----

  @IsString()
  @IsOptional()
  @IsIn(['shared_db', 'api_bridge', 'standalone'])
  COMPPORT_MODE?: string = 'standalone';

  @IsString()
  @IsOptional()
  COMPPORT_API_URL?: string;

  @IsString()
  @IsOptional()
  COMPPORT_API_KEY?: string;

  @IsString()
  @IsOptional()
  COMPPORT_DB_PREFIX?: string = 'compport_';

  @IsString()
  @IsOptional()
  COMPPORT_SESSION_SECRET?: string;

  // ---- Integration Hub ----

  @IsString()
  @IsOptional()
  INTEGRATION_ENCRYPTION_KEY?: string;

  // ---- Encryption keys (required in production — see env.validation.ts
  //      productionRequiredKeys list and the post-validation hard check) ----

  @IsString()
  @IsOptional()
  BENEFITS_ENCRYPTION_KEY?: string;

  @IsString()
  @IsOptional()
  PLATFORM_CONFIG_ENCRYPTION_KEY?: string;

  @IsString()
  @IsOptional()
  PII_ENCRYPTION_KEY?: string;

  // ---- Real-time Sync ----

  @Transform(({ value }) => (value != null ? parseInt(String(value), 10) : value))
  @IsNumber()
  @IsOptional()
  SYNC_INTERVAL_SECONDS?: number = 120;
}

export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Config validation error: ${errors.toString()}`);
  }

  // Production-only hard checks. Per context.md BLOCKERS 2 & 3, encryption
  // keys MUST be set before the app boots in production. The encryption
  // services also throw, but failing here gives a single, clear error
  // message at startup instead of a runtime error the first time the
  // service is instantiated.
  if (validatedConfig.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!validatedConfig.BENEFITS_ENCRYPTION_KEY || validatedConfig.BENEFITS_ENCRYPTION_KEY.length < 32) {
      missing.push('BENEFITS_ENCRYPTION_KEY (must be >=32 chars)');
    }
    const platformKey =
      validatedConfig.PLATFORM_CONFIG_ENCRYPTION_KEY ?? validatedConfig.PII_ENCRYPTION_KEY ?? '';
    if (platformKey.length < 32) {
      missing.push('PLATFORM_CONFIG_ENCRYPTION_KEY or PII_ENCRYPTION_KEY (must be >=32 chars)');
    }
    if (
      !validatedConfig.INTEGRATION_ENCRYPTION_KEY ||
      validatedConfig.INTEGRATION_ENCRYPTION_KEY.length < 32
    ) {
      missing.push('INTEGRATION_ENCRYPTION_KEY (must be >=32 chars)');
    }
    if (missing.length > 0) {
      throw new Error(
        `Production config missing required encryption keys:\n  - ${missing.join('\n  - ')}\n` +
          'Generate with `openssl rand -hex 32` and store in GCP Secret Manager.',
      );
    }
  }

  return validatedConfig;
}
