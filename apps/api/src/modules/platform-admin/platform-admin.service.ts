import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../database';
import { CredentialVaultService } from '../integrations/services/credential-vault.service';
import { TenantRegistryService } from '../compport-bridge/services/tenant-registry.service';
import { CompportCloudSqlService } from '../compport-bridge/services/compport-cloudsql.service';
import { InboundSyncService } from '../compport-bridge/services/inbound-sync.service';
import { CreateTenantDto, UpdateTenantDto, CreateTenantUserDto, OnboardTenantDto } from './dto';

/** Canonical feature keys that can be toggled per-tenant */
export const FEATURE_KEYS = [
  'ai_features',
  'data_hygiene',
  'comp_cycles',
  'payroll_guard',
  'benefits',
  'organization',
  'equity_plans',
  'analytics',
  'integrations',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly credentialVault: CredentialVaultService,
    private readonly configService: ConfigService,
    private readonly tenantRegistry: TenantRegistryService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly inboundSyncService: InboundSyncService,
  ) {}

  // ─── Tenant CRUD ──────────────────────────────────────────

  async listTenants(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.db.client.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          subdomain: true,
          customDomain: true,
          logoUrl: true,
          primaryColor: true,
          isActive: true,
          plan: true,
          compportSchema: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              users: true,
              employees: true,
              ruleSets: true,
              compCycles: true,
              importJobs: true,
              integrationConnectors: true,
              tenantRoles: true,
            },
          },
          // Last sync job status
          integrationConnectors: {
            take: 1,
            orderBy: { lastSyncAt: 'desc' },
            select: {
              id: true,
              status: true,
              lastSyncAt: true,
              syncJobs: {
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: { status: true, totalRecords: true, processedRecords: true, completedAt: true },
              },
            },
          },
        },
      }),
      this.db.client.tenant.count({ where }),
    ]);

    // Flatten connector info into a sync summary
    const data = tenants.map((t) => {
      const connector = t.integrationConnectors[0];
      const lastJob = connector?.syncJobs?.[0];
      return {
        ...t,
        integrationConnectors: undefined, // remove raw data
        syncStatus: connector ? {
          connected: true,
          connectorStatus: connector.status,
          lastSyncAt: connector.lastSyncAt,
          lastJobStatus: lastJob?.status ?? null,
          lastJobRecords: lastJob?.totalRecords ?? 0,
        } : { connected: false, connectorStatus: null, lastSyncAt: null, lastJobStatus: null, lastJobRecords: 0 },
      };
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTenant(id: string) {
    // Use Prisma _count for a single efficient query (no RLS/forTenant needed
    // because tenant table has no RLS and _count joins through FK relations)
    const tenant = await this.db.client.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, employees: true, compCycles: true, importJobs: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    return tenant;
  }

  async createTenant(dto: CreateTenantDto) {
    const slug =
      dto.slug ||
      dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const finalSlug = `${slug}-${Date.now()}`;

    const tenant = await this.db.client.tenant.create({
      data: {
        name: dto.name,
        slug: finalSlug,
        subdomain: dto.subdomain || null,
        plan: dto.plan || 'free',
        compportSchema: dto.compportSchema || null,
      },
    });
    this.logger.log(`Tenant created: ${tenant.name} (${tenant.id})`);

    // Auto-create integration connector if a Compport schema is provided
    if (dto.compportSchema) {
      await this.ensureConnectorExists(tenant.id, dto.name, dto.compportSchema);
    }

    return tenant;
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    await this.getTenant(id); // ensure exists
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.subdomain !== undefined) data['subdomain'] = dto.subdomain || null;
    if (dto.customDomain !== undefined) data['customDomain'] = dto.customDomain || null;
    if (dto.logoUrl !== undefined) data['logoUrl'] = dto.logoUrl || null;
    if (dto.primaryColor !== undefined) data['primaryColor'] = dto.primaryColor || null;
    if (dto.plan !== undefined) data['plan'] = dto.plan;
    if (dto.isActive !== undefined) data['isActive'] = dto.isActive;
    if (dto.compportSchema !== undefined) data['compportSchema'] = dto.compportSchema || null;

    const updated = await this.db.client.tenant.update({ where: { id }, data });
    this.logger.log(`Tenant updated: ${updated.name} (${updated.id})`);

    // Auto-create connector if schema was just set and no connector exists
    if (dto.compportSchema) {
      await this.ensureConnectorExists(id, updated.name, dto.compportSchema);
    }

    return updated;
  }

  async suspendTenant(id: string, adminUserId?: string) {
    const tenant = await this.getTenant(id);
    if (!tenant.isActive) return tenant;
    const updated = await this.db.client.tenant.update({
      where: { id },
      data: { isActive: false },
    });
    if (adminUserId) {
      await this.logAdminAction(adminUserId, 'TENANT_SUSPEND', 'tenant', id, {
        tenantName: tenant.name,
      });
    }
    this.logger.warn(`Tenant SUSPENDED: ${updated.name} (${updated.id})`);
    return updated;
  }

  async activateTenant(id: string, adminUserId?: string) {
    const tenant = await this.getTenant(id);
    if (tenant.isActive) return tenant;
    const updated = await this.db.client.tenant.update({
      where: { id },
      data: { isActive: true },
    });
    if (adminUserId) {
      await this.logAdminAction(adminUserId, 'TENANT_ACTIVATE', 'tenant', id, {
        tenantName: tenant.name,
      });
    }
    this.logger.log(`Tenant ACTIVATED: ${updated.name} (${updated.id})`);
    return updated;
  }

  async deleteTenant(id: string) {
    const tenant = await this.getTenant(id);

    // Delete in correct FK dependency order inside a single transaction.
    // No superuser-only commands — works on Cloud SQL managed PostgreSQL.
    try {
      await this.db.client.$transaction(async (tx) => {
        // Set RLS context so policies allow the deletes
        await (tx as any).$executeRaw`SELECT set_config('app.current_tenant_id', ${id}, true)`;

        const del = (sql: string) => tx.$executeRawUnsafe(sql, id).catch((e: Error) => {
          this.logger.debug(`deleteTenant skip: ${e.message?.substring(0, 80)}`);
        });

        // 1. Deepest leaf tables (no other table references these)
        //    Tables WITHOUT tenantId — delete via parent FK subquery
        await del(`DELETE FROM "anomaly_explanations" WHERE "anomalyId" IN (SELECT "id" FROM "payroll_anomalies" WHERE "payrollRunId" IN (SELECT "id" FROM "payroll_runs" WHERE "tenantId" = $1))`);
        await del(`DELETE FROM "pay_equity_dimensions" WHERE "reportId" IN (SELECT "id" FROM "pay_equity_reports" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "compliance_findings" WHERE "scanId" IN (SELECT "id" FROM "compliance_scans" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "simulation_results" WHERE "simulationRunId" IN (SELECT "id" FROM "simulation_runs" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "vesting_events" WHERE "grantId" IN (SELECT "id" FROM "equity_grants" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "payroll_line_items" WHERE "payrollRunId" IN (SELECT "id" FROM "payroll_runs" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "payroll_anomalies" WHERE "payrollRunId" IN (SELECT "id" FROM "payroll_runs" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "cycle_budgets" WHERE "cycleId" IN (SELECT "id" FROM "comp_cycles" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "comp_recommendations" WHERE "cycleId" IN (SELECT "id" FROM "comp_cycles" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "calibration_sessions" WHERE "cycleId" IN (SELECT "id" FROM "comp_cycles" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "rules" WHERE "ruleSetId" IN (SELECT "id" FROM "rule_sets" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "test_cases" WHERE "ruleSetId" IN (SELECT "id" FROM "rule_sets" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "import_issues" WHERE "importJobId" IN (SELECT "id" FROM "import_jobs" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "sync_logs" WHERE "syncJobId" IN (SELECT "id" FROM "sync_jobs" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "benefit_dependents" WHERE "enrollmentId" IN (SELECT "id" FROM "benefit_enrollments" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "refresh_tokens" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "write_back_records" WHERE "batchId" IN (SELECT "id" FROM "write_back_batches" WHERE "tenantId" = $1)`);
        await del(`DELETE FROM "copilot_messages" WHERE "conversationId" IN (SELECT "id" FROM "copilot_conversations" WHERE "tenantId" = $1)`);

        // 2. Tables with tenantId — leaf-level
        await del(`DELETE FROM "tenant_role_permissions" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "tenant_pages" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "tenant_roles" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "policy_chunks" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "import_ai_analyses" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "compensation_letters" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "attrition_risk_scores" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "policy_conversions" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "saved_reports" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "simulation_scenarios" WHERE "tenantId" = $1`);

        // 3. Mid-level tables
        await del(`DELETE FROM "copilot_conversations" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "write_back_batches" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "compliance_scans" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "pay_equity_reports" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "simulation_runs" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "attrition_analysis_runs" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "rewards_statements" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "equity_grants" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "equity_plans" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "life_events" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "enrollment_windows" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "benefit_enrollments" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "benefit_plans" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "ad_hoc_increases" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "field_mappings" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "webhook_endpoints" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "sync_jobs" WHERE "tenantId" = $1`);

        // 4. Higher-level tables
        await del(`DELETE FROM "career_ladders" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "job_levels" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "job_families" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "salary_bands" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "market_data_sources" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "merit_matrices" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "exchange_rates" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "tenant_currencies" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "payroll_runs" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "comp_cycles" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "rule_sets" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "import_jobs" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "policy_documents" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "integration_connectors" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "audit_logs" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "notifications" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "token_blacklist" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "user_sessions" WHERE "tenantId" = $1`);

        // 5. Users and employees last
        await del(`DELETE FROM "users" WHERE "tenantId" = $1`);
        await del(`DELETE FROM "employees" WHERE "tenantId" = $1`);

        // 6. Finally the tenant itself
        await tx.$executeRawUnsafe(`DELETE FROM "tenants" WHERE "id" = $1`, id);
      }, { timeout: 300_000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`deleteTenant FAILED for ${id}: ${msg}`, (err as Error).stack);
      throw new BadRequestException(`Failed to delete tenant: ${msg}`);
    }

    this.logger.warn(`Tenant DELETED: ${tenant.name} (${tenant.id})`);
    return { deleted: true, id, name: tenant.name };
  }

  // ─── User Management ─────────────────────────────────────

  async listTenantUsers(tenantId: string) {
    await this.getTenant(tenantId);
    const users = await this.db.forTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return { data: users, total: users.length };
  }

  async createTenantUser(tenantId: string, dto: CreateTenantUserDto) {
    await this.getTenant(tenantId);

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : '';

    const { user, existing } = await this.db.forTenant(tenantId, async (tx) => {
      const found = await tx.user.findFirst({
        where: { tenantId, email: dto.email },
      });
      if (found) {
        return { user: null, existing: true };
      }

      const created = await tx.user.create({
        data: {
          tenantId,
          email: dto.email,
          name: dto.name,
          role: (dto.role as any) || 'ADMIN',
          passwordHash,
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true },
      });
      return { user: created, existing: false };
    });

    if (existing) {
      throw new ConflictException(`User ${dto.email} already exists in this tenant`);
    }

    // TODO: Send invite email (placeholder — log invite link)
    const inviteLink = `https://app.compportiq.ai/login?invite=${user!.id}`;
    this.logger.log(`Invite link for ${user!.email}: ${inviteLink}`);

    return { user, inviteLink };
  }

  async removeTenantUser(tenantId: string, userId: string) {
    const user = await this.db.forTenant(tenantId, (tx) =>
      tx.user.findFirst({
        where: { id: userId, tenantId },
      }),
    );
    if (!user) throw new NotFoundException(`User ${userId} not found in tenant ${tenantId}`);

    await this.db.forTenant(tenantId, (tx) => tx.user.delete({ where: { id: userId } }));
    this.logger.log(`User removed: ${user.email} from tenant ${tenantId}`);
    return { deleted: true };
  }

  // ─── Compport Tenant Discovery ──────────────────────────

  /**
   * Get MySQL connection config from environment.
   * Primary: DB_HOST / DB_USER / DB_PWD (production Cloud Run)
   * Fallback: COMPPORT_CLOUDSQL_HOST / USER / PASSWORD (legacy)
   */
  /** Create a COMPPORT_CLOUDSQL connector for a tenant if one doesn't exist. Uses forTenant to satisfy RLS. */
  private async ensureConnectorExists(tenantId: string, tenantName: string, schema: string) {
    try {
      const exists = await this.db.forTenant(tenantId, (tx) =>
        tx.integrationConnector.findFirst({
          where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
          select: { id: true },
        }),
      );
      if (!exists) {
        await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.create({
            data: {
              tenantId,
              name: `Compport - ${tenantName}`,
              connectorType: 'COMPPORT_CLOUDSQL',
              status: 'ACTIVE',
              syncDirection: 'INBOUND',
              syncSchedule: 'DAILY',
              conflictStrategy: 'SOURCE_PRIORITY',
              config: { cloudSqlSchema: schema, schemaName: schema },
            },
          }),
        );
        this.logger.log(`Connector created for ${tenantName} (schema: ${schema})`);
      }
    } catch (err) {
      this.logger.warn(`Failed to create connector for ${tenantName}: ${err}`);
    }
  }

  private getMySqlConfig() {
    const host =
      this.configService.get('DB_HOST', '') || this.configService.get('COMPPORT_CLOUDSQL_HOST', '');
    const port = parseInt(this.configService.get('COMPPORT_CLOUDSQL_PORT', '3306'), 10);
    const user =
      this.configService.get('DB_USER', '') || this.configService.get('COMPPORT_CLOUDSQL_USER', '');
    const password =
      this.configService.get('DB_PWD', '') ||
      this.configService.get('COMPPORT_CLOUDSQL_PASSWORD', '');

    // SSL client certificates (required by Cloud SQL in production)
    const sslCa = process.env['MYSQL_CA_CERT'];
    const sslCert = process.env['MYSQL_CLIENT_CERT'];
    const sslKey = process.env['MYSQL_CLIENT_KEY'];

    return { host, port, user, password, sslCa, sslCert, sslKey };
  }

  async listCompportTenants() {
    const { host, port, user, password, sslCa, sslCert, sslKey } = this.getMySqlConfig();

    if (!host || !user || !password) {
      const missing = [!host && 'DB_HOST', !user && 'DB_USER', !password && 'DB_PWD'].filter(
        Boolean,
      );
      this.logger.warn(
        `MySQL env vars not set (missing: ${missing.join(', ')}) — returning empty tenant list`,
      );
      return { tenants: [], count: 0 };
    }

    try {
      await this.cloudSql.connect({ host, port, user, password, sslCa, sslCert, sslKey });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `MySQL connection failed (host=${host}, port=${port}, user=${user}, ` +
          `ssl=${sslCa ? 'yes' : 'no'}): ${msg}`,
      );
      return { tenants: [], count: 0 };
    }

    try {
      const tenants = await this.tenantRegistry.discoverTenants();
      this.logger.log(`Compport tenant discovery returned ${tenants.length} tenants`);
      return { tenants, count: tenants.length };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Tenant discovery query failed: ${msg}`);
      throw error;
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Onboarding ──────────────────────────────────────────

  async onboardFromCompport(dto: OnboardTenantDto) {
    // Check if schema is already onboarded
    const existing = await this.db.client.tenant.findFirst({
      where: { compportSchema: dto.compportSchema },
    });
    if (existing) {
      throw new ConflictException(
        `Compport schema "${dto.compportSchema}" is already onboarded as "${existing.name}"`,
      );
    }

    // Create tenant
    const slug = dto.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Build settings with enabledFeatures (if provided)
    const settings: Record<string, unknown> = {};
    if (dto.enabledFeatures && dto.enabledFeatures.length > 0) {
      settings['enabledFeatures'] = dto.enabledFeatures;
    }

    const tenant = await this.db.client.tenant.create({
      data: {
        name: dto.companyName,
        slug: `${slug}-${Date.now()}`,
        subdomain: dto.subdomain || slug,
        compportSchema: dto.compportSchema,
        plan: 'enterprise',
        ...(Object.keys(settings).length > 0 && { settings: settings as any }),
      },
    });

    // Create admin user + integration connector inside tenant-scoped RLS context
    // Both `users` and `integration_connectors` tables have RLS policies
    const { adminUser, connector, queryReady } = await this.db.forTenant(tenant.id, async (tx) => {
      // Create admin user if provided
      let createdAdmin = null;
      if (dto.adminEmail) {
        const passwordHash = dto.adminPassword ? await bcrypt.hash(dto.adminPassword, 12) : '';

        createdAdmin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: dto.adminEmail,
            name: dto.adminName || dto.adminEmail.split('@')[0] || 'Admin',
            role: (dto.adminRole as any) || 'ADMIN',
            passwordHash,
          },
          select: { id: true, email: true, name: true, role: true },
        });
      }

      // Create integration connector for Cloud SQL with encrypted credentials
      const mysqlConfig = this.getMySqlConfig();
      const cloudSqlCreds: Record<string, unknown> = {
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        database: dto.compportSchema,
      };

      let encryptedCredentials: string | undefined;
      let credentialIv: string | undefined;
      let credentialTag: string | undefined;

      if (cloudSqlCreds['host'] && cloudSqlCreds['user'] && cloudSqlCreds['password']) {
        const encrypted = this.credentialVault.encrypt(tenant.id, cloudSqlCreds);
        encryptedCredentials = encrypted.encrypted;
        credentialIv = encrypted.iv;
        credentialTag = encrypted.tag;
        this.logger.log(`Cloud SQL credentials provisioned for tenant ${tenant.id}`);
      } else {
        this.logger.warn(
          'MySQL env vars (DB_HOST/DB_USER/DB_PWD) not set — connector created without credentials.',
        );
      }

      const createdConnector = await tx.integrationConnector.create({
        data: {
          tenantId: tenant.id,
          name: `Compport - ${dto.companyName}`,
          connectorType: 'COMPPORT_CLOUDSQL',
          status: 'ACTIVE',
          syncDirection: 'INBOUND',
          syncSchedule: 'DAILY',
          conflictStrategy: 'SOURCE_PRIORITY',
          config: {
            cloudSqlSchema: dto.compportSchema,
            schemaName: dto.compportSchema,
          } as any,
          ...(encryptedCredentials && {
            encryptedCredentials,
            credentialIv,
            credentialTag,
          }),
        },
      });

      return {
        adminUser: createdAdmin,
        connector: createdConnector,
        queryReady: !!encryptedCredentials,
      };
    });

    this.logger.log(
      `Onboarded: ${dto.companyName} (schema=${dto.compportSchema}, tenant=${tenant.id})`,
    );

    // Immediately sync roles & permissions so tenant is usable from day one
    let roleSyncResult = null;
    let employeeCount: number | null = null;
    if (queryReady) {
      try {
        // Cloud SQL connection is already available via getMySqlConfig
        const mysqlConfig = this.getMySqlConfig();
        await this.cloudSql.connect({
          host: mysqlConfig.host!,
          port: mysqlConfig.port ?? 3306,
          user: mysqlConfig.user!,
          password: mysqlConfig.password!,
          database: dto.compportSchema,
          sslCa: mysqlConfig.sslCa,
          sslCert: mysqlConfig.sslCert,
          sslKey: mysqlConfig.sslKey,
        });

        roleSyncResult = await this.inboundSyncService.syncRolesAndPermissions(
          tenant.id,
          dto.compportSchema,
        );
        this.logger.log(
          `Initial role sync for ${dto.companyName}: roles=${roleSyncResult.roles.synced}, ` +
            `pages=${roleSyncResult.pages.synced}, permissions=${roleSyncResult.permissions.synced}, ` +
            `users=${roleSyncResult.users.synced}`,
        );

        // Quick employee count from Cloud SQL (login_user is the employee data table)
        try {
          const countResult = await this.cloudSql.executeQuery<{ total: number }>(
            dto.compportSchema,
            'SELECT COUNT(*) AS total FROM `login_user`',
          );
          employeeCount = countResult[0]?.total ?? null;
          this.logger.log(`Employee count for ${dto.companyName}: ${employeeCount}`);
        } catch (err) {
          this.logger.warn(
            `Failed to count employees for ${dto.companyName}: ${(err as Error).message}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Initial role sync failed for ${dto.companyName}: ${(err as Error).message}. ` +
            `Roles will be synced on the next scheduled inbound sync.`,
        );
      } finally {
        await this.cloudSql.disconnect();
      }
    }

    return {
      tenant,
      adminUser,
      connector: { id: connector.id, name: connector.name },
      queryReady,
      roleSyncResult,
      employeeCount,
    };
  }

  // ─── Tenant Overview & Roles ────────────────────────────

  /**
   * Full tenant overview: counts, role distribution, last sync, permission summary.
   */
  async getTenantOverview(tenantId: string) {
    const tenant = await this.getTenant(tenantId);

    // Single forTenant call — all queries in one transaction
    let userCount = 0;
    let employeeCount = 0;
    let roles: { id: string; compportRoleId: string; name: string }[] = [];
    let pages = 0;
    let permissions = 0;
    let lastSync: Record<string, unknown> | null = null;
    let roleGroups: { role: string; _count: { role: number } }[] = [];

    try {
      [userCount, employeeCount, roles, pages, permissions, lastSync, roleGroups] =
        await this.db.forTenant(tenantId, (tx) =>
          Promise.all([
            tx.user.count({ where: { tenantId } }),
            tx.employee.count({ where: { tenantId } }),
            tx.tenantRole.findMany({
              where: { tenantId, isActive: true },
              select: { id: true, compportRoleId: true, name: true },
            }),
            tx.tenantPage.count({ where: { tenantId } }),
            tx.tenantRolePermission.count({ where: { tenantId } }),
            tx.syncJob.findFirst({
              where: { tenantId },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true, status: true, entityType: true,
                totalRecords: true, processedRecords: true, failedRecords: true,
                startedAt: true, completedAt: true, errorMessage: true,
              },
            }),
            tx.user.groupBy({
              by: ['role'],
              where: { tenantId },
              _count: { role: true },
            }),
          ]),
        );
    } catch (err) {
      this.logger.warn(`getTenantOverview failed for ${tenantId}: ${err}`);
    }

    const roleCountMap = new Map<string, number>();
    for (const g of roleGroups) {
      roleCountMap.set(g.role, g._count.role);
    }

    const roleDistribution = roles.map((r) => ({
      compportRoleId: r.compportRoleId,
      name: r.name,
      userCount: roleCountMap.get(r.compportRoleId) ?? 0,
    }));

    // Add any user roles that aren't in TenantRole (e.g., PLATFORM_ADMIN, legacy roles)
    for (const [role, count] of roleCountMap) {
      if (!roles.some((r) => r.compportRoleId === role)) {
        roleDistribution.push({ compportRoleId: role, name: role, userCount: count });
      }
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isActive: tenant.isActive,
        plan: tenant.plan,
        compportSchema: tenant.compportSchema,
      },
      counts: { users: userCount, employees: employeeCount },
      syncedEntities: { roles: roles.length, pages, permissions },
      roleDistribution,
      lastSync: lastSync ?? null,
    };
  }

  /**
   * Recent sync jobs for a tenant.
   */
  async getTenantSyncStatus(tenantId: string, limit = 10) {
    await this.getTenant(tenantId); // ensure exists

    const syncJobs = await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          entityType: true,
          direction: true,
          totalRecords: true,
          processedRecords: true,
          failedRecords: true,
          skippedRecords: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
    );

    return { tenantId, syncJobs, total: syncJobs.length };
  }

  /**
   * All synced Compport roles for a tenant with user counts.
   */
  async getTenantRoles(tenantId: string) {
    await this.getTenant(tenantId);

    let roles: {
      id: string;
      compportRoleId: string;
      name: string;
      module: string | null;
      isActive: boolean;
      syncedAt: Date | null;
    }[] = [];
    let users: { role: string }[] = [];

    try {
      [roles, users] = await this.db.forTenant(tenantId, (tx) =>
        Promise.all([
          tx.tenantRole.findMany({
            where: { tenantId },
            select: {
              id: true,
              compportRoleId: true,
              name: true,
              module: true,
              isActive: true,
              syncedAt: true,
            },
            orderBy: { name: 'asc' },
          }),
          tx.user.findMany({
            where: { tenantId },
            select: { role: true },
          }),
        ]),
      );
    } catch (err) {
      this.logger.warn(`getTenantRoles: forTenant query failed for ${tenantId}: ${err}`);
    }

    const roleCountMap = new Map<string, number>();
    for (const u of users) {
      roleCountMap.set(u.role, (roleCountMap.get(u.role) ?? 0) + 1);
    }

    const data = roles.map((r) => ({
      ...r,
      userCount: roleCountMap.get(r.compportRoleId) ?? 0,
    }));

    return { tenantId, roles: data, total: data.length };
  }

  /**
   * Full role→page→action permission matrix for a tenant.
   */
  async getTenantPermissions(tenantId: string) {
    await this.getTenant(tenantId);

    let permissions: {
      role: { compportRoleId: string; name: string };
      page: { name: string; compportPageId: string };
      canView: boolean;
      canInsert: boolean;
      canUpdate: boolean;
      canDelete: boolean;
    }[] = [];

    try {
      permissions = await this.db.forTenant(tenantId, (tx) =>
        tx.tenantRolePermission.findMany({
          where: { tenantId },
          include: {
            role: { select: { compportRoleId: true, name: true } },
            page: { select: { name: true, compportPageId: true } },
          },
          orderBy: [{ role: { name: 'asc' } }, { page: { name: 'asc' } }],
        }),
      );
    } catch (err) {
      this.logger.warn(`getTenantPermissions: forTenant query failed for ${tenantId}: ${err}`);
    }

    // Group by role
    const byRole = new Map<
      string,
      {
        compportRoleId: string;
        roleName: string;
        pages: Array<{
          pageName: string;
          canView: boolean;
          canInsert: boolean;
          canUpdate: boolean;
          canDelete: boolean;
        }>;
      }
    >();

    for (const p of permissions) {
      const key = p.role.compportRoleId;
      if (!byRole.has(key)) {
        byRole.set(key, {
          compportRoleId: p.role.compportRoleId,
          roleName: p.role.name,
          pages: [],
        });
      }
      byRole.get(key)!.pages.push({
        pageName: p.page.name,
        canView: p.canView,
        canInsert: p.canInsert,
        canUpdate: p.canUpdate,
        canDelete: p.canDelete,
      });
    }

    return {
      tenantId,
      roles: Array.from(byRole.values()),
      totalPermissions: permissions.length,
    };
  }

  /**
   * Re-sync roles, pages, and permissions for a tenant from Compport Cloud SQL.
   * This is useful after changing the schema mapping or when roles/permissions
   * need to be refreshed.
   */
  async syncTenantRoles(tenantId: string) {
    const tenant = await this.getTenant(tenantId);

    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured. Cannot sync roles.`,
      );
    }

    // Connect to Cloud SQL
    const mysqlConfig = this.getMySqlConfig();
    try {
      await this.cloudSql.connect({
        host: mysqlConfig.host!,
        port: mysqlConfig.port ?? 3306,
        user: mysqlConfig.user!,
        password: mysqlConfig.password!,
        database: tenant.compportSchema,
        sslCa: mysqlConfig.sslCa,
        sslCert: mysqlConfig.sslCert,
        sslKey: mysqlConfig.sslKey,
      });

      // Sync roles, pages, permissions, and users
      const result = await this.inboundSyncService.syncRolesAndPermissions(
        tenantId,
        tenant.compportSchema,
      );

      this.logger.log(
        `Re-sync roles for ${tenant.name}: roles=${result.roles.synced}, ` +
          `pages=${result.pages.synced}, permissions=${result.permissions.synced}, ` +
          `users=${result.users.synced}`,
      );

      return {
        tenantId,
        tenantName: tenant.name,
        compportSchema: tenant.compportSchema,
        result,
      };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  /**
   * Full sync: roles, pages, permissions, users, AND employees.
   * This is the complete sync that should be triggered from the admin UI.
   */
  async syncTenantFull(tenantId: string) {
    const tenant = await this.getTenant(tenantId);

    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured. Cannot sync.`,
      );
    }

    // Use an ISOLATED Cloud SQL instance so concurrent requests
    // (e.g. tenant list, sync-roles) don't clobber our connection pool.
    const isolatedSql = CompportCloudSqlService.createIsolated();
    const mysqlConfig = this.getMySqlConfig();
    try {
      await isolatedSql.connect({
        host: mysqlConfig.host!,
        port: mysqlConfig.port ?? 3306,
        user: mysqlConfig.user!,
        password: mysqlConfig.password!,
        database: tenant.compportSchema,
        sslCa: mysqlConfig.sslCa,
        sslCert: mysqlConfig.sslCert,
        sslKey: mysqlConfig.sslKey,
      });

      this.logger.log(`[sync-full] Isolated Cloud SQL connected for ${tenant.name}`);

      // Step 1: Sync roles, pages, permissions, and users
      const roleResult = await this.inboundSyncService.syncRolesAndPermissions(
        tenantId,
        tenant.compportSchema,
        isolatedSql,
      );

      // Step 2: Sync employees — auto-detect table (employee_master → login_user → employees)
      let employeeResult: { synced: number; skipped: number; errors: number; durationMs: number };
      const candidateTables = ['employee_master', 'login_user', 'employees'];
      let syncError: Error | null = null;

      for (const table of candidateTables) {
        try {
          employeeResult = await this.inboundSyncService.syncEmployeesForTenant(
            tenantId,
            tenant.compportSchema,
            table,
            isolatedSql,
          );
          this.logger.log(
            `[sync-full] Employee sync used table "${table}": synced=${employeeResult!.synced}`,
          );
          syncError = null;
          break;
        } catch (err) {
          syncError = err instanceof Error ? err : new Error(String(err));
          this.logger.warn(
            `[sync-full] Employee table "${table}" failed: ${syncError.message.substring(0, 120)}`,
          );
        }
      }

      if (syncError || !employeeResult!) {
        employeeResult = { synced: 0, skipped: 0, errors: 1, durationMs: 0 };
        this.logger.error(`[sync-full] All employee table candidates failed for ${tenant.name}`);
      }

      this.logger.log(
        `[sync-full] Complete for ${tenant.name}: roles=${roleResult.roles.synced}, ` +
          `pages=${roleResult.pages.synced}, permissions=${roleResult.permissions.synced}, ` +
          `users=${roleResult.users.synced}, employees=${employeeResult.synced}`,
      );

      return {
        tenantId,
        tenantName: tenant.name,
        compportSchema: tenant.compportSchema,
        roles: roleResult,
        employees: employeeResult,
      };
    } finally {
      await isolatedSql.disconnect();
      this.logger.log(`[sync-full] Isolated Cloud SQL disconnected for ${tenant.name}`);
    }
  }

  /**
   * Test Cloud SQL connectivity for a tenant's Compport schema.
   * Lightweight check: connect → ping → disconnect.
   */
  async testTenantConnection(tenantId: string) {
    const tenant = await this.getTenant(tenantId);

    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured. Cannot test connection.`,
      );
    }

    const mysqlConfig = this.getMySqlConfig();
    const start = Date.now();

    if (!mysqlConfig.host || !mysqlConfig.user || !mysqlConfig.password) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        schema: tenant.compportSchema,
        error: 'Cloud SQL credentials not configured (missing DB_HOST, DB_USER, or DB_PWD)',
      };
    }

    try {
      await this.cloudSql.connect({
        host: mysqlConfig.host,
        port: mysqlConfig.port ?? 3306,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        database: tenant.compportSchema,
        sslCa: mysqlConfig.sslCa,
        sslCert: mysqlConfig.sslCert,
        sslKey: mysqlConfig.sslKey,
      });

      const healthy = await this.cloudSql.isHealthy();
      const durationMs = Date.now() - start;

      if (!healthy) {
        return {
          ok: false,
          durationMs,
          schema: tenant.compportSchema,
          error: 'Connected but health check (ping) failed',
        };
      }

      this.logger.log(
        `Connection test OK for ${tenant.name} (schema=${tenant.compportSchema}, ${durationMs}ms)`,
      );

      return {
        ok: true,
        durationMs,
        schema: tenant.compportSchema,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Connection test FAILED for ${tenant.name} (schema=${tenant.compportSchema}): ${message}`,
      );
      return {
        ok: false,
        durationMs,
        schema: tenant.compportSchema,
        error: message,
      };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Admin Impersonation ─────────────────────────────────

  async impersonate(tenantId: string, targetUserId: string, adminUserId: string) {
    const tenant = await this.getTenant(tenantId);
    const targetUser = await this.db.client.user.findFirst({
      where: { id: targetUserId, tenantId },
    });
    if (!targetUser) throw new NotFoundException(`User ${targetUserId} not found in tenant`);

    await this.logAdminAction(adminUserId, 'IMPERSONATE', 'user', targetUserId, {
      tenantId,
      tenantName: tenant.name,
      targetEmail: targetUser.email,
    });

    this.logger.warn(
      `Admin ${adminUserId} IMPERSONATING ${targetUser.email} in tenant ${tenant.name}`,
    );

    // Return user data that the caller can use to generate a scoped JWT
    return {
      userId: targetUser.id,
      tenantId: targetUser.tenantId,
      email: targetUser.email,
      role: targetUser.role,
      name: targetUser.name,
      impersonatedBy: adminUserId,
    };
  }

  // ─── Tenant Usage ────────────────────────────────────────

  async getTenantUsage(tenantId: string) {
    await this.getTenant(tenantId);

    const [
      userCount,
      employeeCount,
      cycleCount,
      importJobCount,
      payrollRunCount,
      complianceScanCount,
    ] = await Promise.all([
      this.db.client.user.count({ where: { tenantId } }),
      this.db.client.employee.count({ where: { tenantId } }),
      this.db.client.compCycle.count({ where: { tenantId } }),
      this.db.client.importJob.count({ where: { tenantId } }),
      this.db.client.payrollRun.count({ where: { tenantId } }),
      this.db.client.complianceScan.count({ where: { tenantId } }),
    ]);

    return {
      tenantId,
      users: userCount,
      employees: employeeCount,
      compCycles: cycleCount,
      importJobs: importJobCount,
      payrollRuns: payrollRunCount,
      complianceScans: complianceScanCount,
    };
  }

  // ─── Admin Action Audit Log ──────────────────────────────

  async logAdminAction(
    adminUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ) {
    // Platform admin actions are logged to the platform tenant (or null tenant)
    // We use the raw client since these are cross-tenant operations
    await this.db.client.auditLog.create({
      data: {
        tenantId: 'PLATFORM',
        userId: adminUserId,
        action,
        entityType,
        entityId,
        changes: (metadata ?? {}) as never,
      },
    });
  }

  async getAdminAuditLog(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.db.client.auditLog.findMany({
        where: { tenantId: 'PLATFORM' },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.auditLog.count({ where: { tenantId: 'PLATFORM' } }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Platform Stats ──────────────────────────────────────

  async getStats() {
    // Single query using Prisma aggregate — no N+1 loop, no RLS needed
    const [totalTenants, activeTenants, totalUsers, totalEmployees] = await Promise.all([
      this.db.client.tenant.count(),
      this.db.client.tenant.count({ where: { isActive: true } }),
      this.db.client.user.count(),
      this.db.client.employee.count(),
    ]);

    return {
      totalTenants,
      activeTenants,
      suspendedTenants: totalTenants - activeTenants,
      totalUsers,
      totalEmployees,
    };
  }

  // ─── Audit Logs (cross-tenant) ──────────────────────────────

  async listAuditLogs(query: {
    page?: number;
    limit?: number;
    tenantId?: string;
    userId?: string;
    action?: string;
    entityType?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.tenantId) where['tenantId'] = query.tenantId;
    if (query.userId) where['userId'] = query.userId;
    if (query.action) where['action'] = query.action;
    if (query.entityType) where['entityType'] = query.entityType;
    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (query.dateFrom) createdAt['gte'] = new Date(query.dateFrom);
      if (query.dateTo) createdAt['lte'] = new Date(query.dateTo);
      where['createdAt'] = createdAt;
    }

    // Direct client — no RLS scoping (platform admin sees all)
    const [data, total] = await Promise.all([
      this.db.client.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          tenant: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.db.client.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTenantAuditLogs(
    tenantId: string,
    query: {
      page?: number;
      limit?: number;
      userId?: string;
      action?: string;
      entityType?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    return this.listAuditLogs({ ...query, tenantId });
  }
}
