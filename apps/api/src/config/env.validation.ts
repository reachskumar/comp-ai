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

  return validatedConfig;
}

