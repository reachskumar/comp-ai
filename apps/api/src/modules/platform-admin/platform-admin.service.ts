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
        },
      }),
      this.db.client.tenant.count({ where }),
    ]);

    // Query counts per tenant via forTenant() so RLS context is set
    const data = await Promise.all(
      tenants.map(async (t) => {
        const _count = await this.db
          .forTenant(t.id, (tx) =>
            Promise.all([
              tx.user.count({ where: { tenantId: t.id } }),
              tx.employee.count({ where: { tenantId: t.id } }),
            ]),
          )
          .then(([users, employees]) => ({ users, employees }))
          .catch(() => ({ users: 0, employees: 0 }));
        return { ...t, _count };
      }),
    );

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTenant(id: string) {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);

    // Query counts via forTenant() so RLS context is properly set
    const _count = await this.db
      .forTenant(id, (tx) =>
        Promise.all([
          tx.user.count({ where: { tenantId: id } }),
          tx.employee.count({ where: { tenantId: id } }),
          tx.compCycle.count({ where: { tenantId: id } }),
          tx.importJob.count({ where: { tenantId: id } }),
        ]),
      )
      .then(([users, employees, compCycles, importJobs]) => ({
        users,
        employees,
        compCycles,
        importJobs,
      }))
      .catch((err) => {
        this.logger.warn(`Failed to get counts for tenant ${id}: ${err}`);
        return { users: 0, employees: 0, compCycles: 0, importJobs: 0 };
      });

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
    return updated;
  }

  async suspendTenant(id: string) {
    const tenant = await this.getTenant(id);
    if (!tenant.isActive) return tenant;
    const updated = await this.db.client.tenant.update({
      where: { id },
      data: { isActive: false },
    });
    this.logger.warn(`Tenant SUSPENDED: ${updated.name} (${updated.id})`);
    return updated;
  }

  async activateTenant(id: string) {
    const tenant = await this.getTenant(id);
    if (tenant.isActive) return tenant;
    const updated = await this.db.client.tenant.update({
      where: { id },
      data: { isActive: true },
    });
    this.logger.log(`Tenant ACTIVATED: ${updated.name} (${updated.id})`);
    return updated;
  }

  async deleteTenant(id: string) {
    const tenant = await this.getTenant(id);
    await this.db.client.tenant.delete({ where: { id } });
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
  private getMySqlConfig() {
    const host =
      this.configService.get('DB_HOST', '') || this.configService.get('COMPPORT_CLOUDSQL_HOST', '');
    const port = parseInt(this.configService.get('COMPPORT_CLOUDSQL_PORT', '3306'), 10);
    const user =
      this.configService.get('DB_USER', '') || this.configService.get('COMPPORT_CLOUDSQL_USER', '');
    const password =
      this.configService.get('DB_PWD', '') ||
      this.configService.get('COMPPORT_CLOUDSQL_PASSWORD', '');

    return { host, port, user, password };
  }

  async listCompportTenants() {
    const { host, port, user, password } = this.getMySqlConfig();

    if (!host || !user || !password) {
      const missing = [!host && 'DB_HOST', !user && 'DB_USER', !password && 'DB_PWD'].filter(
        Boolean,
      );
      this.logger.warn(
        `MySQL env vars not set (missing: ${missing.join(', ')}) — returning empty tenant list`,
      );
      return { tenants: [], count: 0 };
    }

    const sslCa = process.env['MYSQL_CA_CERT'];
    const sslCert = process.env['MYSQL_CLIENT_CERT'];
    const sslKey = process.env['MYSQL_CLIENT_KEY'];

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

    // Wrap all forTenant calls so RLS/query failures return safe defaults
    let userCount = 0;
    let employeeCount = 0;
    let roles: { id: string; compportRoleId: string; name: string }[] = [];
    let pages = 0;
    let permissions = 0;
    let lastSync: Record<string, unknown> | null = null;
    let users: { role: string }[] = [];

    try {
      [userCount, employeeCount, roles, pages, permissions, lastSync] = await this.db.forTenant(
        tenantId,
        (tx) =>
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
                id: true,
                status: true,
                entityType: true,
                totalRecords: true,
                processedRecords: true,
                failedRecords: true,
                startedAt: true,
                completedAt: true,
                errorMessage: true,
              },
            }),
          ]),
      );
    } catch (err) {
      this.logger.warn(`getTenantOverview: forTenant query failed for ${tenantId}: ${err}`);
    }

    // Build role distribution: count users per Compport role
    try {
      users = await this.db.forTenant(tenantId, (tx) =>
        tx.user.findMany({
          where: { tenantId },
          select: { role: true },
        }),
      );
    } catch (err) {
      this.logger.warn(`getTenantOverview: user role query failed for ${tenantId}: ${err}`);
    }

    const roleCountMap = new Map<string, number>();
    for (const u of users) {
      roleCountMap.set(u.role, (roleCountMap.get(u.role) ?? 0) + 1);
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

  // ─── Platform Stats ──────────────────────────────────────

  async getStats() {
    // Tenant table has no RLS — count directly
    const [totalTenants, activeTenants] = await Promise.all([
      this.db.client.tenant.count(),
      this.db.client.tenant.count({ where: { isActive: true } }),
    ]);

    // Users and employees tables have FORCE RLS — must query per-tenant
    const tenantIds = await this.db.client.tenant.findMany({
      select: { id: true },
    });

    let totalUsers = 0;
    let totalEmployees = 0;
    for (const { id } of tenantIds) {
      const [users, employees] = await this.db.forTenant(id, (tx) =>
        Promise.all([
          tx.user.count({ where: { tenantId: id } }),
          tx.employee.count({ where: { tenantId: id } }),
        ]),
      );
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
