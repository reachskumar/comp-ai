import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportBridgeConfig } from '../config/compport-bridge.config';
import {
  CompportEmployeeSchema,
  CompportCompensationSchema,
  CompportUserSchema,
  type CompportEmployee,
  type CompportCompensation,
  type CompportUser,
} from '../schemas/compport-data.schemas';
import { Prisma } from '@compensation/database';

/**
 * Shared Database service for reading Compport PHP tables.
 * SECURITY:
 * - Uses ONLY Prisma parameterized queries (tagged template literals)
 * - ALL queries include tenant ID filter for tenant isolation
 * - Data validated with Zod schemas before returning
 * - Returns empty arrays gracefully in standalone mode
 */
@Injectable()
export class CompportDbService {
  private readonly logger = new Logger(CompportDbService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: CompportBridgeConfig,
  ) {}

  /**
   * Fetch employees from Compport PHP tables.
   * SECURITY: Tenant isolation enforced via parameterized query.
   */
  async getEmployees(tenantId: string): Promise<CompportEmployee[]> {
    if (!this.config.isSharedDb) {
      this.logger.debug('Not in shared_db mode, returning empty employees');
      return [];
    }

    try {
      const tableName = `${this.config.dbPrefix}employees`;
      // SECURITY: Using Prisma tagged template literal for parameterized query
      const rows = await this.db.client.$queryRaw<unknown[]>(
        Prisma.sql`SELECT * FROM ${Prisma.raw(tableName)} WHERE tenant_id = ${tenantId} AND status = 'active' LIMIT 10000`
      );

      const validated: CompportEmployee[] = [];
      for (const row of rows) {
        const result = CompportEmployeeSchema.safeParse(row);
        if (result.success) {
          validated.push(result.data);
        } else {
          this.logger.warn(`Invalid employee record skipped: ${result.error.message}`);
        }
      }
      return validated;
    } catch (error) {
      this.logger.error('Failed to fetch Compport employees', (error as Error).message);
      return [];
    }
  }

  /**
   * Fetch compensation data from Compport PHP tables.
   * SECURITY: Tenant isolation enforced via parameterized query.
   */
  async getCompensationData(tenantId: string): Promise<CompportCompensation[]> {
    if (!this.config.isSharedDb) {
      this.logger.debug('Not in shared_db mode, returning empty compensation data');
      return [];
    }

    try {
      const tableName = `${this.config.dbPrefix}compensation`;
      const rows = await this.db.client.$queryRaw<unknown[]>(
        Prisma.sql`SELECT * FROM ${Prisma.raw(tableName)} WHERE tenant_id = ${tenantId} LIMIT 10000`
      );

      const validated: CompportCompensation[] = [];
      for (const row of rows) {
        const result = CompportCompensationSchema.safeParse(row);
        if (result.success) {
          validated.push(result.data);
        } else {
          this.logger.warn(`Invalid compensation record skipped: ${result.error.message}`);
        }
      }
      return validated;
    } catch (error) {
      this.logger.error('Failed to fetch Compport compensation data', (error as Error).message);
      return [];
    }
  }

  /**
   * Fetch users from Compport PHP tables.
   * SECURITY: Tenant isolation enforced via parameterized query.
   */
  async getUsers(tenantId: string): Promise<CompportUser[]> {
    if (!this.config.isSharedDb) {
      this.logger.debug('Not in shared_db mode, returning empty users');
      return [];
    }

    try {
      const tableName = `${this.config.dbPrefix}users`;
      const rows = await this.db.client.$queryRaw<unknown[]>(
        Prisma.sql`SELECT * FROM ${Prisma.raw(tableName)} WHERE tenant_id = ${tenantId} AND is_active = true LIMIT 10000`
      );

      const validated: CompportUser[] = [];
      for (const row of rows) {
        const result = CompportUserSchema.safeParse(row);
        if (result.success) {
          validated.push(result.data);
        } else {
          this.logger.warn(`Invalid user record skipped: ${result.error.message}`);
        }
      }
      return validated;
    } catch (error) {
      this.logger.error('Failed to fetch Compport users', (error as Error).message);
      return [];
    }
  }

  /**
   * Check if shared DB tables are accessible.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.config.isSharedDb) return true;
    try {
      const tableName = `${this.config.dbPrefix}employees`;
      await this.db.client.$queryRaw(
        Prisma.sql`SELECT 1 FROM ${Prisma.raw(tableName)} LIMIT 1`
      );
      return true;
    } catch {
      return false;
    }
  }
}

