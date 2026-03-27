import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../../database';
import { CredentialVaultService } from '../integrations/services/credential-vault.service';
import { TenantRegistryService } from '../compport-bridge/services/tenant-registry.service';
import { CompportCloudSqlService } from '../compport-bridge/services/compport-cloudsql.service';
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

    const [data, total] = await Promise.all([
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
          _count: { select: { users: true, employees: true } },
        },
      }),
      this.db.client.tenant.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTenant(id: string) {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, employees: true, compCycles: true, importJobs: true } },
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

  async listCompportTenants() {
    const host = this.configService.get('COMPPORT_CLOUDSQL_HOST', '');
    const port = parseInt(this.configService.get('COMPPORT_CLOUDSQL_PORT', '3306'), 10);
    const user = this.configService.get('COMPPORT_CLOUDSQL_USER', '');
    const password = this.configService.get('COMPPORT_CLOUDSQL_PASSWORD', '');

    if (!host || !user || !password) {
      this.logger.warn('COMPPORT_CLOUDSQL_* env vars not set — returning empty tenant list');
      return { tenants: [], count: 0 };
    }

    await this.cloudSql.connect({ host, port, user, password });
    try {
      const tenants = await this.tenantRegistry.discoverTenants();
      return { tenants, count: tenants.length };
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
      const cloudSqlCreds: Record<string, unknown> = {
        host: this.configService.get('COMPPORT_CLOUDSQL_HOST', ''),
        port: parseInt(this.configService.get('COMPPORT_CLOUDSQL_PORT', '3306'), 10),
        user: this.configService.get('COMPPORT_CLOUDSQL_USER', ''),
        password: this.configService.get('COMPPORT_CLOUDSQL_PASSWORD', ''),
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
          'COMPPORT_CLOUDSQL_* env vars not set — connector created without credentials. ' +
            'Set COMPPORT_CLOUDSQL_HOST, COMPPORT_CLOUDSQL_USER, COMPPORT_CLOUDSQL_PASSWORD ' +
            'to enable immediate MySQL access after onboarding.',
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

    return {
      tenant,
      adminUser,
      connector: { id: connector.id, name: connector.name },
      queryReady,
    };
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
}
