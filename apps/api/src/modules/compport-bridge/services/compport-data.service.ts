import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';

/**
 * CompportDataService — Direct Compport MySQL reads.
 *
 * IMPORTANT: This service queries Compport MySQL DIRECTLY via executeQuery(),
 * bypassing the catalog validation in CompportQueryCacheService. This ensures
 * data is returned even if the schema catalog hasn't been populated yet.
 */
@Injectable()
export class CompportDataService {
  private readonly logger = new Logger(CompportDataService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly credentialVault: CredentialVaultService,
  ) {}

  /** Get the Compport schema name for a tenant */
  private async getSchema(tenantId: string): Promise<string | null> {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { compportSchema: true },
    });
    return tenant?.compportSchema ?? null;
  }

  /** Ensure Cloud SQL is connected for this tenant */
  private async ensureConnected(tenantId: string): Promise<void> {
    if (this.cloudSql.isConnected) return;

    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL', status: 'ACTIVE' },
      }),
    );

    if (connector?.encryptedCredentials && connector.credentialIv && connector.credentialTag) {
      const creds = this.credentialVault.decrypt(
        tenantId,
        connector.encryptedCredentials,
        connector.credentialIv,
        connector.credentialTag,
      );
      await this.cloudSql.connect({
        host: creds['host'] as string,
        port: (creds['port'] as number) ?? 3306,
        user: creds['user'] as string,
        password: creds['password'] as string,
        database: creds['database'] as string | undefined,
        sslCa: process.env['MYSQL_CA_CERT'],
        sslCert: process.env['MYSQL_CLIENT_CERT'],
        sslKey: process.env['MYSQL_CLIENT_KEY'],
      });
      return;
    }

    // Fallback: env vars
    const schema = await this.getSchema(tenantId);
    await this.cloudSql.connect({
      host: process.env['DB_HOST'] ?? '',
      port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
      user: process.env['DB_USER'] ?? '',
      password: process.env['DB_PWD'] ?? '',
      database: schema ?? undefined,
      sslCa: process.env['MYSQL_CA_CERT'],
      sslCert: process.env['MYSQL_CLIENT_CERT'],
      sslKey: process.env['MYSQL_CLIENT_KEY'],
    });
  }

  /**
   * Direct MySQL query — NO catalog validation, NO cache dependency.
   * This is the core method. If the table doesn't exist, MySQL returns an error
   * which we catch and return empty array.
   */
  private async directQuery(
    tenantId: string,
    tableName: string,
    options?: { limit?: number; orderBy?: string; orderDir?: 'ASC' | 'DESC' },
  ): Promise<unknown[]> {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId);

    const limit = Math.min(options?.limit ?? 50, 500);
    let orderSql = '';
    if (options?.orderBy) {
      const dir = options.orderDir === 'DESC' ? 'DESC' : 'ASC';
      orderSql = ` ORDER BY \`${options.orderBy}\` ${dir}`;
    }

    try {
      const rows = await this.cloudSql.executeQuery<Record<string, unknown>>(
        schema,
        `SELECT * FROM \`${tableName}\`${orderSql} LIMIT ?`,
        [limit],
      );
      // Clean up dates/buffers for JSON
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (v instanceof Date) out[k] = v.toISOString();
          else if (typeof v === 'bigint') out[k] = Number(v);
          else if (Buffer.isBuffer(v))
            out[k] = v.length < 100 ? v.toString() : `<binary:${v.length}>`;
          else out[k] = v;
        }
        return out;
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      // Table doesn't exist — not an error, just no data
      if (msg.includes("doesn't exist") || msg.includes('does not exist')) {
        this.logger.debug(`Table ${tableName} not found in ${schema}`);
        return [];
      }
      this.logger.error(`MySQL query failed for ${schema}.${tableName}: ${msg.substring(0, 200)}`);
      return [];
    }
  }

  /**
   * Direct MySQL count — NO catalog.
   */
  private async directCount(tenantId: string, tableName: string): Promise<number> {
    const schema = await this.getSchema(tenantId);
    if (!schema) return 0;
    await this.ensureConnected(tenantId);
    try {
      const rows = await this.cloudSql.executeQuery<{ cnt: number }>(
        schema,
        `SELECT COUNT(*) AS cnt FROM \`${tableName}\``,
      );
      return Number(rows[0]?.cnt ?? 0);
    } catch {
      return 0;
    }
  }

  // ─── Compensation Cycles ──────────────────────────────────

  async getCompCycles(tenantId: string, limit = 20) {
    return this.directQuery(tenantId, 'performance_cycle', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  // ─── Salary Rules ─────────────────────────────────────────

  async getSalaryRules(tenantId: string, limit = 50) {
    return this.directQuery(tenantId, 'hr_parameter', { limit, orderBy: 'id', orderDir: 'DESC' });
  }

  async getBonusRules(tenantId: string, limit = 50) {
    return this.directQuery(tenantId, 'hr_parameter_bonus', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  async getLtiRules(tenantId: string, limit = 50) {
    return this.directQuery(tenantId, 'lti_rules', { limit });
  }

  // ─── Employee Compensation ────────────────────────────────

  async getEmployeeSalaryDetails(tenantId: string, _filters?: Record<string, unknown>, limit = 50) {
    return this.directQuery(tenantId, 'employee_salary_details', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  async getEmployeeBonusDetails(tenantId: string, _filters?: Record<string, unknown>, limit = 50) {
    return this.directQuery(tenantId, 'employee_bonus_details', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  async getEmployeeLtiDetails(tenantId: string, _filters?: Record<string, unknown>, limit = 50) {
    return this.directQuery(tenantId, 'employee_lti_details', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  // ─── Letters ──────────────────────────────────────────────

  async getLetters(tenantId: string, _filters?: Record<string, unknown>, limit = 50) {
    return this.directQuery(tenantId, 'letter_repository', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  // ─── Market Data ──────────────────────────────────────────

  async getMarketData(tenantId: string, limit = 100) {
    return this.directQuery(tenantId, 'tbl_market_data', { limit });
  }

  async getPayRanges(tenantId: string, limit = 100) {
    return this.directQuery(tenantId, 'payrange_market_data', { limit });
  }

  // ─── Proration ────────────────────────────────────────────

  async getProrationRules(tenantId: string, limit = 50) {
    return this.directQuery(tenantId, 'proration_based_assignment', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  // ─── History ──────────────────────────────────────────────

  async getEmployeeHistory(tenantId: string, _filters?: Record<string, unknown>, limit = 50) {
    return this.directQuery(tenantId, 'login_user_history', {
      limit,
      orderBy: 'id',
      orderDir: 'DESC',
    });
  }

  // ─── Minimum Wage ─────────────────────────────────────────

  async getMinimumWage(tenantId: string, limit = 100) {
    return this.directQuery(tenantId, 'minimum_wage', { limit });
  }

  // ─── Grade / Band / Level Structure ────────────────────────

  async getGradeBands(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'grade_band', { limit });
  }

  async getPayGrades(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'pay_grade', { limit });
  }

  async getSalaryBands(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'salary_bands', { limit });
  }

  async getManageBands(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'manage_band', { limit });
  }

  async getManageGrades(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'manage_grade', { limit });
  }

  async getManageLevels(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'manage_level', { limit });
  }

  async getManageDesignations(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'manage_designation', { limit });
  }

  async getManageFunctions(tenantId: string, limit = 200) {
    return this.directQuery(tenantId, 'manage_function', { limit });
  }

  // ─── Generic table query (for any Compport table) ─────────

  async queryTable(
    tenantId: string,
    tableName: string,
    _filters?: Record<string, unknown>,
    limit = 50,
    orderBy?: string,
    orderDir?: 'ASC' | 'DESC',
  ) {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return [];
    return this.directQuery(tenantId, tableName, { limit, orderBy, orderDir });
  }

  async getTableCount(tenantId: string, tableName: string): Promise<number> {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return 0;
    return this.directCount(tenantId, tableName);
  }
}
