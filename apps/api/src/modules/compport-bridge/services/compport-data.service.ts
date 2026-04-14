import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportQueryCacheService } from './compport-query-cache.service';
import { CompportCloudSqlService } from './compport-cloudsql.service';

/**
 * CompportDataService — Direct Compport MySQL reads for UI pages.
 *
 * Each method maps a UI page's data need to the corresponding Compport
 * MySQL table(s). Data is served via the Redis cache layer (5 min TTL)
 * so repeated page loads are fast.
 *
 * This replaces the old pattern of syncing Compport data into PG typed
 * models. Compport IS the source of truth — we read it directly.
 */
@Injectable()
export class CompportDataService {
  private readonly logger = new Logger(CompportDataService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly queryCache: CompportQueryCacheService,
    private readonly cloudSql: CompportCloudSqlService,
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
  private async ensureConnected(tenantId: string, schema: string): Promise<void> {
    if (!this.cloudSql.isConnected) {
      const connector = await this.db.forTenant(tenantId, (tx) =>
        tx.integrationConnector.findFirst({
          where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL', status: 'ACTIVE' },
        }),
      );
      if (connector?.encryptedCredentials) {
        // Connection will be handled by the cache service
        return;
      }
      // Fallback: connect from env vars
      await this.cloudSql.connect({
        host: process.env['DB_HOST'] ?? '',
        port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
        user: process.env['DB_USER'] ?? '',
        password: process.env['DB_PWD'] ?? '',
        database: schema,
        sslCa: process.env['MYSQL_CA_CERT'],
        sslCert: process.env['MYSQL_CLIENT_CERT'],
        sslKey: process.env['MYSQL_CLIENT_KEY'],
      });
    }
  }

  // ─── Compensation Cycles ──────────────────────────────────

  async getCompCycles(tenantId: string, limit = 20) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'performance_cycle', this.cloudSql,
      { orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  // ─── Salary Rules ─────────────────────────────────────────

  async getSalaryRules(tenantId: string, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'hr_parameter', this.cloudSql,
      { orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  async getBonusRules(tenantId: string, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'hr_parameter_bonus', this.cloudSql,
      { orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  async getLtiRules(tenantId: string, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'lti_rules', this.cloudSql,
      { limit },
    );
  }

  // ─── Employee Compensation ────────────────────────────────

  async getEmployeeSalaryDetails(tenantId: string, filters?: Record<string, unknown>, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'employee_salary_details', this.cloudSql,
      { where: filters, orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  async getEmployeeBonusDetails(tenantId: string, filters?: Record<string, unknown>, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'employee_bonus_details', this.cloudSql,
      { where: filters, orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  async getEmployeeLtiDetails(tenantId: string, filters?: Record<string, unknown>, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'employee_lti_details', this.cloudSql,
      { where: filters, orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  // ─── Letters ──────────────────────────────────────────────

  async getLetters(tenantId: string, filters?: Record<string, unknown>, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'letter_repository', this.cloudSql,
      { where: filters, orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  // ─── Market Data ──────────────────────────────────────────

  async getMarketData(tenantId: string, limit = 100) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'tbl_market_data', this.cloudSql,
      { limit },
    );
  }

  async getPayRanges(tenantId: string, limit = 100) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'payrange_market_data', this.cloudSql,
      { limit },
    );
  }

  // ─── Proration ────────────────────────────────────────────

  async getProrationRules(tenantId: string, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'proration_based_assignment', this.cloudSql,
      { orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  // ─── History ──────────────────────────────────────────────

  async getEmployeeHistory(tenantId: string, filters?: Record<string, unknown>, limit = 50) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'login_user_history', this.cloudSql,
      { where: filters, orderBy: 'id', orderDir: 'DESC', limit },
    );
  }

  // ─── Minimum Wage ─────────────────────────────────────────

  async getMinimumWage(tenantId: string, limit = 100) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'minimum_wage', this.cloudSql,
      { limit },
    );
  }

  // ─── Grade / Band / Level Structure ────────────────────────

  async getGradeBands(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'grade_band', this.cloudSql,
      { limit },
    );
  }

  async getPayGrades(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'pay_grade', this.cloudSql,
      { limit },
    );
  }

  async getSalaryBands(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'salary_bands', this.cloudSql,
      { limit },
    );
  }

  async getManageBands(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'manage_band', this.cloudSql,
      { limit },
    );
  }

  async getManageGrades(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'manage_grade', this.cloudSql,
      { limit },
    );
  }

  async getManageLevels(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'manage_level', this.cloudSql,
      { limit },
    );
  }

  async getManageDesignations(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'manage_designation', this.cloudSql,
      { limit },
    );
  }

  async getManageFunctions(tenantId: string, limit = 200) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, 'manage_function', this.cloudSql,
      { limit },
    );
  }

  // ─── Generic table query (for any Compport table) ─────────

  async queryTable(
    tenantId: string,
    tableName: string,
    filters?: Record<string, unknown>,
    limit = 50,
    orderBy?: string,
    orderDir?: 'ASC' | 'DESC',
  ) {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId, schema);
    return this.queryCache.queryTable(
      tenantId, schema, tableName, this.cloudSql,
      { where: filters, orderBy, orderDir, limit },
    );
  }

  async getTableCount(tenantId: string, tableName: string): Promise<number> {
    const schema = await this.getSchema(tenantId);
    if (!schema) return 0;
    await this.ensureConnected(tenantId, schema);
    const result = await this.queryCache.queryTable(
      tenantId, schema, tableName, this.cloudSql,
      { columns: ['COUNT(*) AS count'], limit: 1 },
    );
    const row = result[0] as Record<string, unknown> | undefined;
    return Number(row?.['count'] ?? 0);
  }
}
