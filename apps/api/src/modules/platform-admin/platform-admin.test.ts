import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import {
  createMockDatabaseService,
  createMockConfigService,
  TEST_TENANT_ID,
  TEST_USER_ID,
} from '../../test/setup';
import { AuthService } from '../../auth/auth.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { getJwtService } from '../../test/setup';

// ─── PlatformAdminGuard Tests ────────────────────────────────────────────────

describe('PlatformAdminGuard', () => {
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    guard = new PlatformAdminGuard();
  });

  function mockContext(role?: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: TEST_USER_ID, role } }),
      }),
    } as any;
  }

  it('should allow PLATFORM_ADMIN role', () => {
    expect(guard.canActivate(mockContext('PLATFORM_ADMIN'))).toBe(true);
  });

  it('should reject ADMIN role', () => {
    expect(() => guard.canActivate(mockContext('ADMIN'))).toThrow(ForbiddenException);
  });

  it('should reject USER role', () => {
    expect(() => guard.canActivate(mockContext('USER'))).toThrow(ForbiddenException);
  });

  it('should reject undefined role', () => {
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(ForbiddenException);
  });

  it('should reject missing user', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as any;
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});

// ─── TenantGuard — Suspension Tests ──────────────────────────────────────────

describe('TenantGuard — suspension enforcement', () => {
  let guard: TenantGuard;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    db = createMockDatabaseService();
    guard = new (TenantGuard as any)(db);
  });

  function mockContext(tenantId?: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { tenantId } }),
      }),
    } as any;
  }

  it('should allow active tenant', async () => {
    db.client.tenant.findUnique.mockResolvedValue({ id: TEST_TENANT_ID, isActive: true });
    await expect(guard.canActivate(mockContext(TEST_TENANT_ID))).resolves.toBe(true);
  });

  it('should reject suspended tenant', async () => {
    db.client.tenant.findUnique.mockResolvedValue({ id: TEST_TENANT_ID, isActive: false });
    await expect(guard.canActivate(mockContext(TEST_TENANT_ID))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should reject missing tenant', async () => {
    db.client.tenant.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(mockContext(TEST_TENANT_ID))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should reject missing tenantId', async () => {
    await expect(guard.canActivate(mockContext(undefined))).rejects.toThrow(ForbiddenException);
  });
});

// ─── PlatformAdminService Tests ──────────────────────────────────────────────

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;
  let db: ReturnType<typeof createMockDatabaseService>;
  const mockCredentialVault = {
    encrypt: vi.fn(() => ({ encrypted: 'enc', iv: 'iv', tag: 'tag' })),
    decrypt: vi.fn(() => ({})),
    maskCredentials: vi.fn(() => ({})),
  };

  beforeEach(() => {
    db = createMockDatabaseService();
    const configService = createMockConfigService({
      COMPPORT_CLOUDSQL_HOST: '10.0.0.1',
      COMPPORT_CLOUDSQL_PORT: '3306',
      COMPPORT_CLOUDSQL_USER: 'reader',
      COMPPORT_CLOUDSQL_PASSWORD: 'secret',
      INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(32),
    });
    service = new (PlatformAdminService as any)(db, mockCredentialVault, configService);
  });

  describe('listTenants', () => {
    it('should return paginated tenants', async () => {
      const tenants = [{ id: 't1', name: 'Tenant 1' }];
      db.client.tenant.findMany.mockResolvedValue(tenants);
      db.client.tenant.count.mockResolvedValue(1);

      const result = await service.listTenants(1, 20);
      expect(result).toMatchObject({ data: tenants, total: 1, page: 1, limit: 20 });
    });

    it('should apply search filter', async () => {
      db.client.tenant.findMany.mockResolvedValue([]);
      db.client.tenant.count.mockResolvedValue(0);

      await service.listTenants(1, 20, 'acme');
      const call = db.client.tenant.findMany.mock.calls[0][0];
      expect(call.where.OR).toBeDefined();
    });
  });

  describe('getTenant', () => {
    it('should return tenant by id', async () => {
      const tenant = { id: 't1', name: 'Acme', _count: { users: 5, employees: 100 } };
      db.client.tenant.findUnique.mockResolvedValue(tenant);
      const result = await service.getTenant('t1');
      expect(result).toEqual(tenant);
    });

    it('should throw NotFoundException for missing tenant', async () => {
      db.client.tenant.findUnique.mockResolvedValue(null);
      await expect(service.getTenant('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspendTenant', () => {
    it('should suspend an active tenant', async () => {
      db.client.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: true });
      db.client.tenant.update.mockResolvedValue({ id: 't1', name: 'X', isActive: false });
      const result = await service.suspendTenant('t1');
      expect(result.isActive).toBe(false);
      expect(db.client.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { isActive: false },
      });
    });
  });

  describe('activateTenant', () => {
    it('should activate a suspended tenant', async () => {
      db.client.tenant.findUnique.mockResolvedValue({ id: 't1', isActive: false });
      db.client.tenant.update.mockResolvedValue({ id: 't1', name: 'X', isActive: true });
      const result = await service.activateTenant('t1');
      expect(result.isActive).toBe(true);
      expect(db.client.tenant.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { isActive: true },
      });
    });

    it('should no-op if tenant is already active', async () => {
      const tenant = { id: 't1', isActive: true };
      db.client.tenant.findUnique.mockResolvedValue(tenant);
      const result = await service.activateTenant('t1');
      expect(result).toEqual(tenant);
      expect(db.client.tenant.update).not.toHaveBeenCalled();
    });
  });

  describe('onboardFromCompport', () => {
    it('should create tenant, admin user, and connector', async () => {
      db.client.tenant.findFirst.mockResolvedValue(null); // no existing
      db.client.tenant.create.mockResolvedValue({
        id: 't-new',
        name: 'Standard Bank',
        slug: 'standard-bank-123',
      });
      db.client.user.create.mockResolvedValue({
        id: 'u-new',
        email: 'admin@sb.com',
        name: 'Admin',
        role: 'ADMIN',
      });
      db.client.integrationConnector.create.mockResolvedValue({
        id: 'c-new',
        name: 'Compport - Standard Bank',
      });

      const result = await service.onboardFromCompport({
        companyName: 'Standard Bank',
        compportSchema: '200326_1585209819',
        subdomain: 'standardbank',
        adminEmail: 'admin@sb.com',
        adminName: 'Admin',
      });

      expect(result.tenant.id).toBe('t-new');
      expect(result.adminUser.email).toBe('admin@sb.com');
      expect(result.connector.id).toBe('c-new');
      expect(result.queryReady).toBe(true);
      expect(db.client.tenant.create).toHaveBeenCalledOnce();
      expect(db.client.user.create).toHaveBeenCalledOnce();
      expect(db.client.integrationConnector.create).toHaveBeenCalledOnce();

      // Verify connector type is COMPPORT_CLOUDSQL (not HRIS)
      const connectorData = db.client.integrationConnector.create.mock.calls[0][0].data;
      expect(connectorData.connectorType).toBe('COMPPORT_CLOUDSQL');
      // Verify credentials were encrypted
      expect(mockCredentialVault.encrypt).toHaveBeenCalledOnce();
      expect(connectorData.encryptedCredentials).toBe('enc');
    });

    it('should reject duplicate Compport schema', async () => {
      db.client.tenant.findFirst.mockResolvedValue({ id: 't-existing', name: 'Existing' });
      await expect(
        service.onboardFromCompport({
          companyName: 'Dup',
          compportSchema: '200326_1585209819',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getStats', () => {
    it('should return platform statistics', async () => {
      db.client.tenant.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8); // active
      db.client.user.count.mockResolvedValue(50);
      db.client.employee.count.mockResolvedValue(5000);

      const result = await service.getStats();
      expect(result).toEqual({
        totalTenants: 10,
        activeTenants: 8,
        suspendedTenants: 2,
        totalUsers: 50,
        totalEmployees: 5000,
      });
    });
  });
});

// ─── Tenant Branding Resolution Tests ────────────────────────────────────────

describe('AuthService — resolveTenantBranding', () => {
  let service: AuthService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    db = createMockDatabaseService();
    const jwtService = getJwtService();
    const configService = createMockConfigService({
      AZURE_AD_CLIENT_ID: 'test-client-id',
      AZURE_AD_TENANT_ID: 'test-tenant-id',
    });
    service = new (AuthService as any)(db, jwtService, configService);
  });

  it('should resolve branding by subdomain', async () => {
    db.client.tenant.findFirst.mockResolvedValue({
      name: 'Standard Bank',
      slug: 'standardbank',
      subdomain: 'standardbank',
      logoUrl: 'https://logo.png',
      primaryColor: '#003366',
    });

    const result = await service.resolveTenantBranding('standardbank.compportiq.ai');
    expect(result).toMatchObject({
      name: 'Standard Bank',
      slug: 'standardbank',
      logoUrl: 'https://logo.png',
      primaryColor: '#003366',
      azureAdEnabled: true,
    });
  });

  it('should return null for unknown domain', async () => {
    db.client.tenant.findFirst.mockResolvedValue(null);
    const result = await service.resolveTenantBranding('unknown.compportiq.ai');
    expect(result).toBeNull();
  });

  it('should not resolve branding for suspended tenant', async () => {
    // resolveTenantBranding filters by isActive: true in the query
    db.client.tenant.findFirst.mockResolvedValue(null);
    const result = await service.resolveTenantBranding('suspended.compportiq.ai');
    expect(result).toBeNull();
    // Verify the query included isActive: true
    const call = db.client.tenant.findFirst.mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
  });

  it('should report azureAdEnabled=false when not configured', async () => {
    // Create service without Azure AD config
    const configNoAzure = createMockConfigService();
    const svcNoAzure = new (AuthService as any)(db, getJwtService(), configNoAzure);

    db.client.tenant.findFirst.mockResolvedValue({
      name: 'Test',
      slug: 'test',
      subdomain: 'test',
      logoUrl: null,
      primaryColor: null,
    });

    const result = await svcNoAzure.resolveTenantBranding('test.compportiq.ai');
    expect(result?.azureAdEnabled).toBe(false);
  });
});
