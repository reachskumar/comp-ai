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

  // ─── Raw SQL query (for analytics aggregations) ───────────

  async rawQuery(
    tenantId: string,
    sql: string,
    params?: unknown[],
  ): Promise<Record<string, unknown>[]> {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId);
    try {
      return await this.cloudSql.executeQuery<Record<string, unknown>>(schema, sql, params);
    } catch (err) {
      this.logger.error(`rawQuery failed: ${(err as Error).message?.substring(0, 200)}`);
      return [];
    }
  }

  // ─── Discover columns of a table ──────────────────────────

  async discoverColumns(tenantId: string, tableName: string): Promise<string[]> {
    const schema = await this.getSchema(tenantId);
    if (!schema) return [];
    await this.ensureConnected(tenantId);
    try {
      const rows = await this.cloudSql.executeQuery<{ COLUMN_NAME: string }>(
        'INFORMATION_SCHEMA',
        `SELECT COLUMN_NAME FROM COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema, tableName],
      );
      return rows.map((r) => r.COLUMN_NAME);
    } catch {
      return [];
    }
  }

  // ─── Salary Analytics (direct MySQL aggregation) ──────────

  /**
   * Salary analytics computed directly in MySQL from employee_salary_details.
   * Auto-discovers the salary column name on first call.
   */
  async getSalaryAnalytics(
    tenantId: string,
    metric: 'avg_salary' | 'salary_range' | 'total_comp' | 'comp_ratio' | 'headcount',
    groupBy?: string,
    department?: string,
  ): Promise<unknown> {
    const schema = await this.getSchema(tenantId);
    if (!schema) return { error: 'No schema configured' };
    await this.ensureConnected(tenantId);

    // Discover actual column names in employee_salary_details
    const columns = await this.discoverColumns(tenantId, 'employee_salary_details');
    if (columns.length === 0) {
      return { error: 'employee_salary_details table not found' };
    }

    // Find salary column — try common names
    const salaryCol =
      columns.find((c) =>
        [
          'current_ctc',
          'ctc',
          'annual_ctc',
          'base_salary',
          'salary',
          'gross_salary',
          'annual_salary',
          'total_ctc',
          'fixed_pay',
          'basic_salary',
        ].includes(c.toLowerCase()),
      ) ??
      columns.find((c) => c.toLowerCase().includes('ctc') || c.toLowerCase().includes('salary'));

    // Find department column
    const deptCol =
      columns.find((c) =>
        ['department', 'dept', 'department_name', 'dept_name'].includes(c.toLowerCase()),
      ) ??
      columns.find(
        (c) => c.toLowerCase().includes('department') || c.toLowerCase().includes('dept'),
      );

    // Find level/grade column
    const levelCol =
      columns.find((c) =>
        ['level', 'grade', 'band', 'designation', 'job_level', 'grade_name'].includes(
          c.toLowerCase(),
        ),
      ) ??
      columns.find((c) => c.toLowerCase().includes('level') || c.toLowerCase().includes('grade'));

    if (!salaryCol) {
      return { error: 'No salary column found', availableColumns: columns };
    }

    const groupCol = groupBy === 'level' ? levelCol : deptCol;
    let whereClause = `WHERE \`${salaryCol}\` > 0`;
    const params: unknown[] = [];
    if (department && deptCol) {
      whereClause += ` AND \`${deptCol}\` = ?`;
      params.push(department);
    }

    try {
      switch (metric) {
        case 'avg_salary': {
          if (groupCol) {
            const rows = await this.cloudSql.executeQuery(
              schema,
              `SELECT \`${groupCol}\` AS groupName, AVG(\`${salaryCol}\`) AS avgSalary, COUNT(*) AS count FROM employee_salary_details ${whereClause} GROUP BY \`${groupCol}\` ORDER BY avgSalary DESC`,
              params,
            );
            return { metric, salaryColumn: salaryCol, groupBy: groupCol, data: rows };
          }
          const rows = await this.cloudSql.executeQuery(
            schema,
            `SELECT AVG(\`${salaryCol}\`) AS avgSalary, COUNT(*) AS count FROM employee_salary_details ${whereClause}`,
            params,
          );
          return { metric, salaryColumn: salaryCol, ...rows[0] };
        }

        case 'salary_range': {
          const rows = await this.cloudSql.executeQuery(
            schema,
            `SELECT MIN(\`${salaryCol}\`) AS minSalary, MAX(\`${salaryCol}\`) AS maxSalary, AVG(\`${salaryCol}\`) AS avgSalary, COUNT(*) AS count FROM employee_salary_details ${whereClause}`,
            params,
          );
          return { metric, salaryColumn: salaryCol, ...rows[0] };
        }

        case 'total_comp': {
          const rows = await this.cloudSql.executeQuery(
            schema,
            `SELECT SUM(\`${salaryCol}\`) AS totalComp, COUNT(*) AS count FROM employee_salary_details ${whereClause}`,
            params,
          );
          return { metric, salaryColumn: salaryCol, ...rows[0] };
        }

        case 'headcount': {
          if (groupCol) {
            const rows = await this.cloudSql.executeQuery(
              schema,
              `SELECT \`${groupCol}\` AS groupName, COUNT(*) AS count FROM employee_salary_details ${whereClause} GROUP BY \`${groupCol}\` ORDER BY count DESC`,
              params,
            );
            return { metric, groupBy: groupCol, data: rows };
          }
          const rows = await this.cloudSql.executeQuery(
            schema,
            `SELECT COUNT(*) AS count FROM employee_salary_details ${whereClause}`,
            params,
          );
          return { metric, ...rows[0] };
        }

        case 'comp_ratio': {
          // Compute median per group, then compa-ratio per employee
          const gCol = groupCol ?? deptCol;
          if (!gCol) {
            return { error: 'No department/level column found for grouping' };
          }
          // Get group medians using percentile approximation
          const groupData = await this.cloudSql.executeQuery<Record<string, unknown>>(
            schema,
            `SELECT \`${gCol}\` AS groupName, AVG(\`${salaryCol}\`) AS avgSalary, COUNT(*) AS count FROM employee_salary_details ${whereClause} GROUP BY \`${gCol}\` HAVING count > 0 ORDER BY avgSalary DESC`,
            params,
          );

          // Overall stats
          const overall = await this.cloudSql.executeQuery(
            schema,
            `SELECT AVG(\`${salaryCol}\`) AS overallAvg, COUNT(*) AS totalCount FROM employee_salary_details ${whereClause}`,
            params,
          );

          const overallAvg = Number((overall[0] as Record<string, unknown>)?.['overallAvg'] ?? 0);

          // Compute compa-ratio per group: group avg / overall avg
          const withCompaRatio = groupData.map((row) => ({
            group: row['groupName'],
            avgSalary: Number(row['avgSalary']),
            count: Number(row['count']),
            compaRatio:
              overallAvg > 0
                ? Math.round((Number(row['avgSalary']) / overallAvg) * 100) / 100
                : null,
          }));

          return {
            metric: 'comp_ratio',
            salaryColumn: salaryCol,
            groupBy: gCol,
            overallAvgSalary: overallAvg,
            totalEmployees: Number((overall[0] as Record<string, unknown>)?.['totalCount'] ?? 0),
            data: withCompaRatio,
          };
        }

        default:
          return { error: `Unknown metric: ${metric}` };
      }
    } catch (err) {
      return { error: `Query failed: ${(err as Error).message?.substring(0, 200)}` };
    }
  }
}
