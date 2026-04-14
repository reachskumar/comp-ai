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
import { SchemaCatalogService } from '../compport-bridge/services/schema-catalog.service';
import { MirrorSyncService } from '../compport-bridge/services/mirror-sync.service';
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
    private readonly schemaCatalogService: SchemaCatalogService,
    private readonly mirrorSyncService: MirrorSyncService,
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
          id: true, name: true, slug: true, subdomain: true,
          customDomain: true, logoUrl: true, primaryColor: true,
          isActive: true, plan: true, compportSchema: true,
          createdAt: true, updatedAt: true,
        },
      }),
      this.db.client.tenant.count({ where }),
    ]);

    // Get counts per tenant using forTenant (RLS requires tenant context)
    const countsResults = await Promise.all(
      tenants.map((t) =>
        this.db.forTenant(t.id, (tx) =>
          Promise.all([
            tx.user.count({ where: { tenantId: t.id } }),
            tx.employee.count({ where: { tenantId: t.id } }),
            tx.tenantRole.count({ where: { tenantId: t.id } }),
            tx.integrationConnector.count({ where: { tenantId: t.id } }),
          ]),
        ).catch(() => [0, 0, 0, 0] as [number, number, number, number]),
      ),
    );

    const data = tenants.map((t, i) => {
      const [users, employees, roles, connectors] = countsResults[i]!;
      return {
        ...t,
        _count: { users, employees, tenantRoles: roles, integrationConnectors: connectors },
        syncStatus: connectors > 0
          ? { connected: true, connectorStatus: 'ACTIVE', lastSyncAt: null, lastJobStatus: null, lastJobRecords: 0 }
          : { connected: false, connectorStatus: null, lastSyncAt: null, lastJobStatus: null, lastJobRecords: 0 },
      };
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTenant(id: string) {
    const tenant = await this.db.client.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    // Count via forTenant so RLS context is set (Prisma _count bypasses
    // RLS on the parent but child table JOINs still hit FORCE RLS)
    let _count = { users: 0, employees: 0, compCycles: 0, importJobs: 0 };
    try {
      const [users, employees, compCycles, importJobs] = await this.db.forTenant(id, (tx) =>
        Promise.all([
          tx.user.count({ where: { tenantId: id } }),
          tx.employee.count({ where: { tenantId: id } }),
          tx.compCycle.count({ where: { tenantId: id } }),
          tx.importJob.count({ where: { tenantId: id } }),
        ]),
      );
      _count = { users, employees, compCycles, importJobs };
    } catch {
      this.logger.warn(`getTenant counts failed for ${id}`);
    }

    return { ...tenant, _count };
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

      // Auto-trigger full sync (discover + employees + roles + catalog + mirror)
      // Fire-and-forget so tenant creation returns immediately.
      this.logger.log(
        `[onboard] Auto-triggering full sync for new tenant ${tenant.name} (schema: ${dto.compportSchema})`,
      );
      void this.startTenantFullSync(tenant.id).catch((err) => {
        this.logger.warn(
          `[onboard] Auto-sync failed for ${tenant.name}: ${(err as Error).message?.substring(0, 200)}`,
        );
      });
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
  /** Create a COMPPORT_CLOUDSQL connector for a tenant if one doesn't exist.
   *  Also encrypts and stores MySQL credentials so the bridge query endpoints
   *  can connect to Compport MySQL on behalf of this tenant. */
  private async ensureConnectorExists(tenantId: string, tenantName: string, schema: string) {
    try {
      const existing = await this.db.forTenant(tenantId, (tx) =>
        tx.integrationConnector.findFirst({
          where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
          select: { id: true, encryptedCredentials: true },
        }),
      );

      // Build encrypted credentials from env vars
      const mysqlConfig = this.getMySqlConfig();
      let encryptedCredentials: string | undefined;
      let credentialIv: string | undefined;
      let credentialTag: string | undefined;

      if (mysqlConfig.host && mysqlConfig.user && mysqlConfig.password) {
        const creds = {
          host: mysqlConfig.host,
          port: mysqlConfig.port ?? 3306,
          user: mysqlConfig.user,
          password: mysqlConfig.password,
          database: schema,
        };
        const encrypted = this.credentialVault.encrypt(tenantId, creds);
        encryptedCredentials = encrypted.encrypted;
        credentialIv = encrypted.iv;
        credentialTag = encrypted.tag;
      }

      if (!existing) {
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
              ...(encryptedCredentials && { encryptedCredentials, credentialIv, credentialTag }),
            },
          }),
        );
        this.logger.log(`Connector created for ${tenantName} (schema: ${schema}, creds: ${!!encryptedCredentials})`);
      } else if (!existing.encryptedCredentials && encryptedCredentials) {
        // Connector exists but has no credentials — update it
        await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.update({
            where: { id: existing.id },
            data: { encryptedCredentials, credentialIv, credentialTag },
          }),
        );
        this.logger.log(`Connector credentials updated for ${tenantName}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to create/update connector for ${tenantName}: ${err}`);
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

    // Auto-trigger full sync in the background (employees + catalog + mirror).
    // The role sync above ran synchronously for immediate usability, but the
    // full sync is heavier and runs async.
    if (queryReady) {
      this.logger.log(
        `[onboard] Auto-triggering full sync for ${dto.companyName}`,
      );
      void this.startTenantFullSync(tenant.id).catch((err) => {
        this.logger.warn(
          `[onboard] Auto-sync failed for ${dto.companyName}: ${(err as Error).message?.substring(0, 200)}`,
        );
      });
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
   * Start a full sync asynchronously. Creates a SyncJob row, kicks off the
   * actual sync work in the background, and returns the jobId immediately.
   *
   * The UI polls /sync-status to track progress. This avoids long-running HTTP
   * connections that hit Cloud Run's 900s timeout or get killed by browser /
   * load-balancer buffering.
   */
  async startTenantFullSync(tenantId: string): Promise<{ jobId: string; status: string }> {
    const tenant = await this.getTenant(tenantId);

    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured. Cannot sync.`,
      );
    }

    // Reject if there's already a running full_sync for this tenant.
    // Concurrent runs cause Postgres deadlocks on the employee table.
    const existingRunning = await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.findFirst({
        where: {
          tenantId,
          entityType: 'full_sync',
          status: { in: ['PENDING', 'RUNNING'] },
        },
        select: { id: true, startedAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (existingRunning) {
      // If the job is "stuck" (started > 30 min ago), mark it failed and start fresh.
      const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
      const startedAt = existingRunning.startedAt?.getTime() ?? 0;
      const isStuck = startedAt && Date.now() - startedAt > STUCK_THRESHOLD_MS;
      if (isStuck) {
        await this.markJobFailed(tenantId, existingRunning.id, 'Stuck — superseded by new sync');
      } else {
        this.logger.log(
          `[sync-full] Reusing in-flight job ${existingRunning.id} for ${tenant.name}`,
        );
        return { jobId: existingRunning.id, status: 'RUNNING' };
      }
    }

    // Find or create the COMPPORT_CLOUDSQL connector (SyncJob requires connectorId)
    await this.ensureConnectorExists(tenantId, tenant.name, tenant.compportSchema);
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
        select: { id: true },
      }),
    );
    if (!connector) {
      throw new BadRequestException(`No COMPPORT_CLOUDSQL connector for tenant "${tenant.name}"`);
    }

    // Create the SyncJob in RUNNING state. UI polls this row.
    const job = await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.create({
        data: {
          tenantId,
          connectorId: connector.id,
          direction: 'INBOUND',
          entityType: 'full_sync',
          status: 'RUNNING',
          startedAt: new Date(),
          metadata: { type: 'full', source: 'platform-admin' } as never,
        },
      }),
    );

    this.logger.log(`[sync-full] Started job ${job.id} for ${tenant.name}`);

    // Fire and forget. cpu-throttling=false + minScale=1 keeps the instance
    // alive so the background work continues after the HTTP response is sent.
    // Pass connectorId so syncEmployeesForTenant can persist the detected
    // id column into connector.config (per context.md rule: "ALWAYS store
    // detectedEmployeeIdColumn in connector config after first detection").
    void this.runFullSyncBackground(tenantId, job.id, connector.id).catch((err) => {
      this.logger.error(`[sync-full] Background job ${job.id} crashed: ${err}`);
    });

    return { jobId: job.id, status: 'RUNNING' };
  }

  /**
   * The actual sync work. Runs in the background, updates the SyncJob row
   * with progress and final status. NEVER throws — failures are recorded.
   */
  private async runFullSyncBackground(
    tenantId: string,
    jobId: string,
    connectorId: string,
  ): Promise<void> {
    const tenant = await this.getTenant(tenantId).catch(() => null);
    if (!tenant || !tenant.compportSchema) {
      await this.markJobFailed(tenantId, jobId, 'Tenant or compportSchema missing');
      return;
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

      this.logger.log(`[sync-full] Isolated Cloud SQL connected for ${tenant.name} (job ${jobId})`);

      await this.updateJobPhase(tenantId, jobId, 'roles');

      // Step 1: Sync roles, pages, permissions, and users
      const roleResult = await this.inboundSyncService.syncRolesAndPermissions(
        tenantId,
        tenant.compportSchema,
        isolatedSql,
      );

      await this.updateJobPhase(tenantId, jobId, 'employees');

      // Step 2: Sync employees — auto-detect table (employee_master → login_user → employees)
      let employeeResult: {
        synced: number;
        skipped: number;
        errors: number;
        durationMs: number;
        syncedCodes: Set<string>;
      };
      const candidateTables = ['employee_master', 'login_user', 'employees'];
      let syncError: Error | null = null;

      for (const table of candidateTables) {
        try {
          employeeResult = await this.inboundSyncService.syncEmployeesForTenant(
            tenantId,
            tenant.compportSchema,
            table,
            isolatedSql,
            jobId,
            connectorId,
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
        employeeResult = {
          synced: 0,
          skipped: 0,
          errors: 1,
          durationMs: 0,
          syncedCodes: new Set(),
        };
        this.logger.error(`[sync-full] All employee table candidates failed for ${tenant.name}`);
      }

      // Bug B: prune ghost rows from previous broken syncs. Only run when
      // the sync wrote a non-trivial number of rows — otherwise we'd risk
      // wiping the tenant after a partial failure.
      let pruneResult = { deleted: 0 };
      if (employeeResult.syncedCodes.size > 100) {
        try {
          pruneResult = await this.inboundSyncService.pruneStaleEmployees(
            tenantId,
            employeeResult.syncedCodes,
          );
        } catch (err) {
          this.logger.warn(
            `[sync-full] Stale-row prune failed: ${(err as Error).message?.substring(0, 200)}`,
          );
        }
      } else {
        this.logger.warn(
          `[sync-full] Skipping stale-row prune (only ${employeeResult.syncedCodes.size} rows synced)`,
        );
      }

      // BLOCKER 4: link Users → Employees now that both are synced.
      // syncRolesAndPermissions deliberately skips this for performance,
      // so we run it as an explicit pass at the end of every full sync.
      let linkResult: { candidates: number; linked: number; notFound: number } = {
        candidates: 0,
        linked: 0,
        notFound: 0,
      };
      try {
        linkResult = await this.inboundSyncService.linkUsersToEmployees(
          tenantId,
          tenant.compportSchema,
          isolatedSql,
        );
      } catch (err) {
        this.logger.warn(
          `[sync-full] User→Employee linking failed: ${(err as Error).message?.substring(0, 200)}`,
        );
      }

      // ── Phase 3: Universal discovery + mirror sync ──────────
      // Discover EVERY table in the Compport schema and mirror them all
      // into a per-tenant Postgres schema. This gives the AI agent
      // access to everything — salary, bonus, perf, history, modules,
      // rules, audit, etc. — not just the 5 typed models.
      await this.updateJobPhase(tenantId, jobId, 'mirror');
      let mirrorResult = { tablesProcessed: 0, totalRowsMirrored: 0, errors: [] as string[] };
      try {
        // Step 1: catalog every table
        await this.schemaCatalogService.discoverAllTables(
          tenantId,
          connectorId,
          tenant.compportSchema,
          isolatedSql,
        );
        this.logger.log(`[sync-full] Schema catalog complete for ${tenant.name}`);

        // Step 2: mirror all mirrorable tables
        const result = await this.mirrorSyncService.syncAllTables(
          tenantId,
          tenant.slug,
          tenant.compportSchema,
          isolatedSql,
        );
        mirrorResult = result;
        this.logger.log(
          `[sync-full] Mirror sync complete for ${tenant.name}: ` +
            `tables=${result.tablesProcessed}, rows=${result.totalRowsMirrored}, errors=${result.errors.length}`,
        );
      } catch (err) {
        this.logger.warn(
          `[sync-full] Mirror sync failed for ${tenant.name}: ${(err as Error).message?.substring(0, 200)}`,
        );
      }

      this.logger.log(
        `[sync-full] Complete for ${tenant.name}: roles=${roleResult.roles.synced}, ` +
          `pages=${roleResult.pages.synced}, permissions=${roleResult.permissions.synced}, ` +
          `users=${roleResult.users.synced}, employees=${employeeResult.synced}, ` +
          `pruned=${pruneResult.deleted}, linked=${linkResult.linked}/${linkResult.candidates}, ` +
          `mirrorTables=${mirrorResult.tablesProcessed}, mirrorRows=${mirrorResult.totalRowsMirrored}`,
      );

      // Mark job as completed with final counts in metadata
      await this.db.forTenant(tenantId, (tx) =>
        tx.syncJob.update({
          where: { id: jobId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            totalRecords:
              roleResult.roles.synced +
              roleResult.pages.synced +
              roleResult.permissions.synced +
              roleResult.users.synced +
              employeeResult.synced,
            processedRecords:
              roleResult.roles.synced +
              roleResult.pages.synced +
              roleResult.permissions.synced +
              roleResult.users.synced +
              employeeResult.synced,
            metadata: {
              type: 'full',
              source: 'platform-admin',
              roles: roleResult.roles.synced,
              pages: roleResult.pages.synced,
              permissions: roleResult.permissions.synced,
              users: roleResult.users.synced,
              employees: employeeResult.synced,
              employeeErrors: employeeResult.errors,
              staleEmployeesPruned: pruneResult.deleted,
              usersLinkedToEmployees: linkResult.linked,
              usersUnlinked: linkResult.notFound,
              userLinkCandidates: linkResult.candidates,
              mirrorTablesProcessed: mirrorResult.tablesProcessed,
              mirrorRowsMirrored: mirrorResult.totalRowsMirrored,
              mirrorErrors: mirrorResult.errors.length,
            } as never,
          },
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[sync-full] Job ${jobId} failed: ${message}`);
      await this.markJobFailed(tenantId, jobId, message);
    } finally {
      await isolatedSql.disconnect().catch(() => {});
      this.logger.log(`[sync-full] Isolated Cloud SQL disconnected for ${tenant.name}`);
    }
  }

  /** Update the SyncJob's phase in metadata so the UI can show where the sync is. */
  private async updateJobPhase(
    tenantId: string,
    jobId: string,
    phase: 'roles' | 'employees' | 'mirror',
  ): Promise<void> {
    try {
      await this.db.forTenant(tenantId, (tx) =>
        tx.syncJob.update({
          where: { id: jobId },
          data: {
            metadata: { type: 'full', source: 'platform-admin', phase } as never,
          },
        }),
      );
    } catch (err) {
      this.logger.warn(`[sync-full] Failed to update phase for job ${jobId}: ${err}`);
    }
  }

  private async markJobFailed(tenantId: string, jobId: string, message: string): Promise<void> {
    try {
      await this.db.forTenant(tenantId, (tx) =>
        tx.syncJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: message.substring(0, 500),
          },
        }),
      );
    } catch (err) {
      this.logger.error(`[sync-full] Failed to mark job ${jobId} as FAILED: ${err}`);
    }
  }

  /**
   * Get a single sync job's status (used for polling from the UI).
   */
  async getSyncJob(tenantId: string, jobId: string) {
    await this.getTenant(tenantId);
    const job = await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.findFirst({
        where: { id: jobId, tenantId },
        select: {
          id: true,
          status: true,
          entityType: true,
          totalRecords: true,
          processedRecords: true,
          failedRecords: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          metadata: true,
          createdAt: true,
        },
      }),
    );
    if (!job) {
      throw new NotFoundException(`Sync job ${jobId} not found`);
    }
    return job;
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

  // ─── Data Audit ──────────────────────────────────────────

  /**
   * Audit what's actually in the tenant's Compport Cloud SQL schema and
   * how much has been synced into compportiq. Returns row counts for every
   * table in the schema, plus a "coverage" comparison for the tables we
   * currently sync (employees, roles, pages, permissions, users).
   *
   * This is the tool the user needs to know "am I missing anything?"
   */
  /**
   * BLOCKER 6 (context.md): scan tenant Compport schema for compensation
   * tables and persist them on the connector. Used by the platform admin
   * UI to discover what's available before wiring the comp data sync.
   */
  async discoverCompensationTables(tenantId: string) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured. Cannot discover comp tables.`,
      );
    }

    // Find/ensure the connector so persistence works
    await this.ensureConnectorExists(tenantId, tenant.name, tenant.compportSchema);
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
        select: { id: true },
      }),
    );

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
      const result = await this.inboundSyncService.discoverCompensationTables(
        tenantId,
        tenant.compportSchema,
        isolatedSql,
        connector?.id,
      );
      return {
        tenantId,
        tenantName: tenant.name,
        compportSchema: tenant.compportSchema,
        connectorId: connector?.id ?? null,
        ...result,
      };
    } finally {
      await isolatedSql.disconnect().catch(() => {});
    }
  }

  /**
   * Universal Compport schema discovery (Phase 1 of universal sync).
   * Walks every table in the tenant's Compport schema and persists a
   * full catalog into TenantSchemaCatalog. Phase 2 (mirror sync) reads
   * from this catalog so it knows what to mirror.
   */
  async discoverTenantSchema(tenantId: string) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured.`,
      );
    }

    await this.ensureConnectorExists(tenantId, tenant.name, tenant.compportSchema);
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
        select: { id: true },
      }),
    );
    if (!connector) {
      throw new BadRequestException(`No COMPPORT_CLOUDSQL connector for tenant "${tenant.name}"`);
    }

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
      const entries = await this.schemaCatalogService.discoverAllTables(
        tenantId,
        connector.id,
        tenant.compportSchema,
        isolatedSql,
      );
      return {
        tenantId,
        tenantName: tenant.name,
        compportSchema: tenant.compportSchema,
        connectorId: connector.id,
        totalTables: entries.length,
        mirrorableTables: entries.filter((e) => e.isMirrorable).length,
        totalRows: entries.reduce((s, e) => s + e.rowCount, 0),
        tables: entries.map((e) => ({
          name: e.tableName,
          rowCount: e.rowCount,
          columnCount: e.columns.length,
          primaryKey: e.primaryKeyColumns,
          lastModifiedColumn: e.lastModifiedColumn,
          isMirrorable: e.isMirrorable,
          reasonNotMirrorable: e.reasonNotMirrorable,
        })),
      };
    } finally {
      await isolatedSql.disconnect().catch(() => {});
    }
  }

  /**
   * Universal mirror sync (Phase 2). Reads TenantSchemaCatalog (Phase 1),
   * creates per-tenant Postgres schema mirror_<slug>, and copies every
   * mirrorable table from Compport MySQL → Postgres.
   *
   * Fire-and-forget via controller; caller polls SyncJob or the
   * TenantDataMirrorState table for per-table status.
   */
  async syncTenantMirror(tenantId: string) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured.`,
      );
    }

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

      const result = await this.mirrorSyncService.syncAllTables(
        tenantId,
        tenant.slug,
        tenant.compportSchema,
        isolatedSql,
      );

      return {
        tenantId,
        tenantName: tenant.name,
        compportSchema: tenant.compportSchema,
        ...result,
      };
    } finally {
      await isolatedSql.disconnect().catch(() => {});
    }
  }

  async auditTenantData(tenantId: string): Promise<{
    tenantId: string;
    tenantName: string;
    compportSchema: string | null;
    totalTables: number;
    totalRowsInSchema: number;
    tables: Array<{
      name: string;
      rowCount: number;
      isSynced: boolean;
      syncedTo: string | null;
      syncedCount: number | null;
      coveragePercent: number | null;
    }>;
    coverage: {
      employees: { source: number; synced: number; percent: number };
      users: { source: number; synced: number; percent: number };
      roles: { source: number; synced: number; percent: number };
      pages: { source: number; synced: number; percent: number };
      permissions: { source: number; synced: number; percent: number };
    };
  }> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema configured. Cannot audit.`,
      );
    }

    // Connect via an isolated instance so we don't interfere with other calls
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

      // 1) Discover all tables + their row counts from INFORMATION_SCHEMA.
      //    table_rows is an estimate but fast; good enough for an audit view.
      const rawTables = await isolatedSql.executeQuery<{
        TABLE_NAME: string;
        TABLE_ROWS: number | string | null;
      }>(
        tenant.compportSchema,
        `SELECT TABLE_NAME, TABLE_ROWS
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_ROWS DESC`,
        [tenant.compportSchema],
      );

      // 2) For the tables we actually sync, get an EXACT count
      //    (INFORMATION_SCHEMA.TABLE_ROWS is just an estimate for InnoDB).
      //    Real Compport schemas use these names — we tried alternates
      //    in the past but they returned 0 for BFL because the wrong name
      //    was hard-coded. Now we ALSO read from the connector config so
      //    the audit always matches what the sync actually used.
      const exactCountCandidates = new Set<string>([
        'employee_master',
        'login_user',
        'employees',
        'roles',
        'pages',
        'role_permissions',
        // legacy/alt names — kept for tenants that did use them
        'tbl_role',
        'role',
        'tbl_page',
        'page',
      ]);

      // Pull whatever the sync actually wrote so the audit aligns with reality
      let syncedEmployeeTable: string | null = null;
      try {
        const cfgConnector = await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.findFirst({
            where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
            select: { config: true },
          }),
        );
        const idColumns = (cfgConnector?.config as Record<string, unknown> | null)?.[
          'idColumns'
        ] as Record<string, unknown> | undefined;
        if (idColumns) {
          for (const tableName of Object.keys(idColumns)) {
            exactCountCandidates.add(tableName);
            // Pick the first employee-data table the sync actually used
            if (!syncedEmployeeTable) syncedEmployeeTable = tableName;
          }
        }
      } catch {
        /* non-fatal — fall back to hard-coded list */
      }

      const exactCounts = new Map<string, number>();
      for (const tbl of exactCountCandidates) {
        if (!rawTables.some((r) => String(r.TABLE_NAME) === tbl)) continue;
        try {
          const rows = await isolatedSql.executeQuery<{ c: number | string }>(
            tenant.compportSchema,
            `SELECT COUNT(*) AS c FROM \`${tbl}\``,
          );
          exactCounts.set(tbl, Number(rows[0]?.c ?? 0) || 0);
        } catch {
          /* ignore */
        }
      }

      // 3) Fetch compportiq-side counts so we can show coverage %
      const [
        syncedEmployees,
        syncedUsers,
        syncedRoles,
        syncedPages,
        syncedPermissions,
      ] = await this.db.forTenant(tenantId, (tx) =>
        Promise.all([
          tx.employee.count({ where: { tenantId } }),
          tx.user.count({ where: { tenantId } }),
          tx.tenantRole.count({ where: { tenantId } }),
          tx.tenantPage.count({ where: { tenantId } }),
          tx.tenantRolePermission.count({ where: { tenantId } }),
        ]),
      );

      // Map each table to its sync status. login_user is special: it
      // can be the employee source (BFL) AND it always supplies User
      // records, so it counts toward both targets when the sync used it.
      const syncedTableMap: Record<string, { target: string; count: number }> = {
        employee_master: { target: 'Employee', count: syncedEmployees },
        employees: { target: 'Employee', count: syncedEmployees },
        login_user:
          syncedEmployeeTable === 'login_user'
            ? { target: 'Employee + User', count: syncedEmployees }
            : { target: 'User', count: syncedUsers },
        roles: { target: 'TenantRole', count: syncedRoles },
        pages: { target: 'TenantPage', count: syncedPages },
        tbl_role: { target: 'TenantRole', count: syncedRoles },
        role: { target: 'TenantRole', count: syncedRoles },
        tbl_page: { target: 'TenantPage', count: syncedPages },
        page: { target: 'TenantPage', count: syncedPages },
        role_permissions: { target: 'TenantRolePermission', count: syncedPermissions },
      };

      const tables = rawTables.map((r) => {
        const name = String(r.TABLE_NAME);
        const exactCount = exactCounts.get(name);
        const rowCount = exactCount ?? (Number(r.TABLE_ROWS ?? 0) || 0);
        const synced = syncedTableMap[name];
        const coverage =
          synced && rowCount > 0 ? Math.round((synced.count / rowCount) * 100) : null;
        return {
          name,
          rowCount,
          isSynced: !!synced,
          syncedTo: synced?.target ?? null,
          syncedCount: synced?.count ?? null,
          coveragePercent: coverage,
        };
      });

      const totalRowsInSchema = tables.reduce((sum, t) => sum + t.rowCount, 0);

      // Source-of-truth counts. For employees, prefer the table the sync
      // actually used (read from connector config). Falls back to scanning
      // candidates so a tenant that hasn't synced yet still gets a number.
      const emp =
        (syncedEmployeeTable ? exactCounts.get(syncedEmployeeTable) : undefined) ??
        exactCounts.get('employee_master') ??
        exactCounts.get('employees') ??
        exactCounts.get('login_user') ??
        0;
      const lu = exactCounts.get('login_user') ?? 0;
      const tr =
        exactCounts.get('roles') ??
        exactCounts.get('tbl_role') ??
        exactCounts.get('role') ??
        0;
      const tp =
        exactCounts.get('pages') ??
        exactCounts.get('tbl_page') ??
        exactCounts.get('page') ??
        0;
      const rp = exactCounts.get('role_permissions') ?? 0;

      const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

      return {
        tenantId,
        tenantName: tenant.name,
        compportSchema: tenant.compportSchema,
        totalTables: tables.length,
        totalRowsInSchema,
        tables,
        coverage: {
          employees: { source: emp, synced: syncedEmployees, percent: pct(syncedEmployees, emp) },
          users: { source: lu, synced: syncedUsers, percent: pct(syncedUsers, lu) },
          roles: { source: tr, synced: syncedRoles, percent: pct(syncedRoles, tr) },
          pages: { source: tp, synced: syncedPages, percent: pct(syncedPages, tp) },
          permissions: { source: rp, synced: syncedPermissions, percent: pct(syncedPermissions, rp) },
        },
      };
    } finally {
      await isolatedSql.disconnect().catch(() => {});
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
    // Tenant counts (no RLS on tenants table)
    const [totalTenants, activeTenants] = await Promise.all([
      this.db.client.tenant.count(),
      this.db.client.tenant.count({ where: { isActive: true } }),
    ]);

    // User/employee counts need per-tenant aggregation due to FORCE RLS
    const tenantIds = await this.db.client.tenant.findMany({ select: { id: true } });
    let totalUsers = 0;
    let totalEmployees = 0;

    // Batch all tenants in parallel (fast — each is a single count query)
    const results = await Promise.all(
      tenantIds.map((t) =>
        this.db.forTenant(t.id, (tx) =>
          Promise.all([
            tx.user.count({ where: { tenantId: t.id } }),
            tx.employee.count({ where: { tenantId: t.id } }),
          ]),
        ).catch(() => [0, 0] as [number, number]),
      ),
    );

    for (const [users, employees] of results) {
      totalUsers += users;
      totalEmployees += employees;
    }

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
