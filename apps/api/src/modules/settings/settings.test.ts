import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsService } from './settings.service';
import {
  createMockDatabaseService,
  TEST_TENANT,
  TEST_TENANT_ID,
} from '../../test/setup';

function createSettingsService() {
  const db = createMockDatabaseService();
  const service = new (SettingsService as any)(db);
  return { service: service as SettingsService, db };
}

describe('SettingsService — getTenantInfo', () => {
  let service: SettingsService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createSettingsService());
  });

  it('should return tenant info with user/employee counts', async () => {
    db.client.tenant.findUnique.mockResolvedValue({
      ...TEST_TENANT,
      _count: { users: 5, employees: 50 },
    });

    const result = await service.getTenantInfo(TEST_TENANT_ID);

    expect(result).toMatchObject({
      id: TEST_TENANT_ID,
      name: 'Acme Corp',
      slug: 'acme-corp',
    });
    expect(result._count).toEqual({ users: 5, employees: 50 });
    expect(db.client.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TEST_TENANT_ID } }),
    );
  });

  it('should return null for non-existent tenant', async () => {
    db.client.tenant.findUnique.mockResolvedValue(null);

    const result = await service.getTenantInfo('non-existent');

    expect(result).toBeNull();
  });
});

describe('SettingsService — listUsers', () => {
  let service: SettingsService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createSettingsService());
  });

  it('should return users list with total count', async () => {
    const mockUsers = [
      { id: 'u1', email: 'admin@acme.com', name: 'Admin', role: 'ADMIN', avatarUrl: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'u2', email: 'hr@acme.com', name: 'HR Manager', role: 'HR_MANAGER', avatarUrl: null, createdAt: new Date(), updatedAt: new Date() },
    ];
    db.client.user.findMany.mockResolvedValue(mockUsers);

    const result = await service.listUsers(TEST_TENANT_ID);

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data[0].email).toBe('admin@acme.com');
    expect(db.client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TEST_TENANT_ID } }),
    );
  });

  it('should return empty list when no users', async () => {
    db.client.user.findMany.mockResolvedValue([]);

    const result = await service.listUsers(TEST_TENANT_ID);

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('SettingsService — listAuditLogs', () => {
  let service: SettingsService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createSettingsService());
  });

  it('should return paginated audit logs', async () => {
    const mockLogs = [
      { id: 'log1', action: 'LOGIN', userId: 'u1', tenantId: TEST_TENANT_ID, createdAt: new Date(), user: { id: 'u1', name: 'Admin', email: 'admin@acme.com' } },
    ];
    db.client.auditLog.findMany.mockResolvedValue(mockLogs);
    db.client.auditLog.count.mockResolvedValue(1);

    const result = await service.listAuditLogs(TEST_TENANT_ID, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(1);
  });

  it('should filter by action when provided', async () => {
    db.client.auditLog.findMany.mockResolvedValue([]);
    db.client.auditLog.count.mockResolvedValue(0);

    await service.listAuditLogs(TEST_TENANT_ID, { action: 'LOGIN', page: 1, limit: 10 });

    expect(db.client.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TEST_TENANT_ID, action: 'LOGIN' }),
      }),
    );
  });

  it('should use default pagination when not specified', async () => {
    db.client.auditLog.findMany.mockResolvedValue([]);
    db.client.auditLog.count.mockResolvedValue(0);

    const result = await service.listAuditLogs(TEST_TENANT_ID, {});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });
});

