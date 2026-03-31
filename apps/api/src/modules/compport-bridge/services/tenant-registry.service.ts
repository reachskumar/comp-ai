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
   * Discover all active tenants from the platform admin database.
   * Reads the `manage_company` table which maps dbname (schema) to company info.
   * Only returns companies with status = 1 (active).
   */
  async discoverTenants(): Promise<CompportTenantInfo[]> {
    this.logger.log('Discovering tenants from platform_admin_db.manage_company');

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

      // Auto-discover the company name column from manage_company
      const columns = await this.cloudSql.executeQuery<{ Field: string }>(
        PLATFORM_ADMIN_DB,
        'DESCRIBE manage_company',
      );
      const columnNames = columns.map((c) => c.Field);
      this.logger.log(`manage_company columns: ${columnNames.join(', ')}`);

      // Pick the best column for company name
      const companyCol =
        columnNames.find((c) => c === 'company_name') ||
        columnNames.find((c) => c === 'name') ||
        columnNames.find((c) => c.toLowerCase().includes('company')) ||
        columnNames.find((c) => c.toLowerCase().includes('name')) ||
        'dbname'; // fallback to dbname if no name column found

      this.logger.log(`Using "${companyCol}" as company name column`);

      // Query manage_company — status=1 means active
      const rows = await this.cloudSql.executeQuery<{
        dbname: string;
        company_name: string;
        status: number;
      }>(
        PLATFORM_ADMIN_DB,
        `SELECT
          dbname,
          COALESCE(\`${companyCol}\`, dbname) AS company_name,
          status
        FROM manage_company
        WHERE dbname IS NOT NULL AND dbname != '' AND status = 1
        ORDER BY company_name`,
      );

      const tenants: CompportTenantInfo[] = rows.map((row) => ({
        schemaName: row.dbname,
        companyName: row.company_name,
        status: String(row.status),
        createdAt: null,
        employeeCount: null,
      }));

      this.logger.log(`Discovered ${tenants.length} active tenants from manage_company`);
      return tenants;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to discover tenants: ${message}`);

      if (message.includes("doesn't exist") || message.includes('Table')) {
        throw new BadRequestException(
          `The 'manage_company' table was not found in ${PLATFORM_ADMIN_DB}. ` +
            'Check the platform_admin_db structure manually.',
        );
      }

      throw error;
    }
  }

  /**
   * Look up a single tenant by schema name (dbname).
   */
  async findTenantBySchema(schemaName: string): Promise<CompportTenantInfo | null> {
    const rows = await this.cloudSql.executeQuery<{
      dbname: string;
      company_name: string;
      status: number;
    }>(
      PLATFORM_ADMIN_DB,
      `SELECT dbname, dbname AS company_name, status
      FROM manage_company
      WHERE dbname = ?`,
      [schemaName],
    );

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      schemaName: row.dbname,
      companyName: row.company_name,
      status: String(row.status),
      createdAt: null,
      employeeCount: null,
    };
  }
}
