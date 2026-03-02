import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CompportCloudSqlService } from './compport-cloudsql.service';

// ─── Types ───────────────────────────────────────────────

export interface CompportTenantInfo {
  schemaName: string;
  companyName: string;
  status: string;
  createdAt: string | null;
  employeeCount: number | null;
}

const PLATFORM_ADMIN_DB = 'platform_admin_db';

/**
 * Tenant Registry Service
 *
 * Reads the `platform_admin_db` in Compport Cloud SQL to discover
 * all tenant schemas and map them to company names.
 *
 * This enables:
 * - Auto-discovery of all 165+ Compport tenants
 * - Mapping schema names (e.g., `200326_1585209819`) to human-readable company names
 * - Bulk onboarding (Phase 8)
 *
 * SECURITY: Read-only. Parameterized queries only.
 */
@Injectable()
export class TenantRegistryService {
  private readonly logger = new Logger(TenantRegistryService.name);

  constructor(private readonly cloudSql: CompportCloudSqlService) {}

  /**
   * Discover all tenants from the platform admin database.
   * Reads the `clients` table which maps schema names to company info.
   */
  async discoverTenants(): Promise<CompportTenantInfo[]> {
    this.logger.log('Discovering tenants from platform_admin_db');

    try {
      // First verify the admin database exists
      const databases = await this.cloudSql.executeQuery<{ Database: string }>(
        'information_schema',
        'SELECT SCHEMA_NAME AS `Database` FROM SCHEMATA WHERE SCHEMA_NAME = ?',
        [PLATFORM_ADMIN_DB],
      );

      if (databases.length === 0) {
        throw new BadRequestException(
          `Database '${PLATFORM_ADMIN_DB}' not found in Cloud SQL. ` +
            'Ensure the Cloud SQL connection has access to the platform admin database.',
        );
      }

      // Query the clients/companies table
      // Compport stores tenant info with schema_name → company mapping
      const rows = await this.cloudSql.executeQuery<{
        database_name: string;
        company_name: string;
        status: string;
        created_at: string | null;
        employee_count: number | null;
      }>(
        PLATFORM_ADMIN_DB,
        `SELECT
          database_name,
          COALESCE(company_name, name, '') AS company_name,
          COALESCE(status, 'active') AS status,
          created_at,
          employee_count
        FROM clients
        WHERE database_name IS NOT NULL AND database_name != ''
        ORDER BY company_name`,
      );

      const tenants: CompportTenantInfo[] = rows.map((row) => ({
        schemaName: row.database_name,
        companyName: row.company_name,
        status: row.status,
        createdAt: row.created_at,
        employeeCount: row.employee_count,
      }));

      this.logger.log(`Discovered ${tenants.length} tenants from platform_admin_db`);
      return tenants;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to discover tenants: ${message}`);

      // Check for common MySQL errors
      if (message.includes("doesn't exist") || message.includes('Table')) {
        throw new BadRequestException(
          `The 'clients' table was not found in ${PLATFORM_ADMIN_DB}. ` +
            'The table name may differ in this Compport installation. ' +
            'Check the platform_admin_db structure manually.',
        );
      }

      throw error;
    }
  }

  /**
   * Look up a single tenant by schema name.
   */
  async findTenantBySchema(schemaName: string): Promise<CompportTenantInfo | null> {
    const rows = await this.cloudSql.executeQuery<{
      database_name: string;
      company_name: string;
      status: string;
      created_at: string | null;
      employee_count: number | null;
    }>(
      PLATFORM_ADMIN_DB,
      `SELECT
        database_name,
        COALESCE(company_name, name, '') AS company_name,
        COALESCE(status, 'active') AS status,
        created_at,
        employee_count
      FROM clients
      WHERE database_name = ?`,
      [schemaName],
    );

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      schemaName: row.database_name,
      companyName: row.company_name,
      status: row.status,
      createdAt: row.created_at,
      employeeCount: row.employee_count,
    };
  }
}
