import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPrismaClient,
  PrismaClient,
  withTenantScope,
  type Prisma,
} from '@compensation/database';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private _client: PrismaClient;

  constructor(private readonly configService: ConfigService) {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    this._client = createPrismaClient(databaseUrl);
  }

  get client(): PrismaClient {
    return this._client;
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing database connections...');
    try {
      await this._client.$disconnect();
      this.logger.log('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from database', error);
    }
  }

  /**
   * Execute a callback within a tenant-scoped RLS transaction.
   *
   * All queries inside the callback are restricted by PostgreSQL Row-Level
   * Security to only return/modify rows belonging to the specified tenant.
   *
   * Uses `SET LOCAL` which is scoped to the transaction — the tenant context
   * cannot leak across connections in the pool.
   *
   * @param tenantId - The tenant ID to scope queries to.
   * @param callback - Async function receiving a transaction client.
   * @returns The result of the callback.
   *
   * @example
   * ```ts
   * const employees = await this.db.forTenant(tenantId, async (tx) => {
   *   return tx.employee.findMany({ where: { department: 'Engineering' } });
   *   // tenantId filter is enforced by RLS — even without WHERE tenantId
   * });
   * ```
   */
  async forTenant<T>(
    tenantId: string,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!tenantId) {
      throw new Error('forTenant requires a non-empty tenantId');
    }
    return withTenantScope(this._client, tenantId, callback);
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this._client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async connectWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._client.$connect();
        this.logger.log('Database connected successfully');
        return;
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          this.logger.error(`Failed to connect to database after ${MAX_RETRIES} attempts`, error);
          throw error;
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Database connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms...`,
        );
        await this.sleep(delay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
