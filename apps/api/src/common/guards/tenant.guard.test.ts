import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import {
  createMockDatabaseService,
  TEST_TENANT_ID,
} from '../../test/setup';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockExecutionContext(user: { tenantId?: string } | undefined = undefined): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
    getType: () => 'http',
    getArgs: () => [request],
    getArgByIndex: (index: number) => [request][index],
    switchToRpc: () => ({ getContext: () => ({}), getData: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }),
  } as unknown as ExecutionContext;
}

function createTenantGuard() {
  const db = createMockDatabaseService();
  const guard = new (TenantGuard as any)(db) as TenantGuard;
  return { guard, db };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ guard, db } = createTenantGuard());
  });

  describe('canActivate', () => {
    it('should allow access for an active tenant', async () => {
      db.client.tenant.findUnique.mockResolvedValue({
        id: TEST_TENANT_ID,
        name: 'Acme Corp',
        isActive: true,
      });
      const context = createMockExecutionContext({ tenantId: TEST_TENANT_ID });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(db.client.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: TEST_TENANT_ID },
      });
    });

    it('should throw ForbiddenException when tenant is inactive', async () => {
      db.client.tenant.findUnique.mockResolvedValue({
        id: TEST_TENANT_ID,
        name: 'Suspended Corp',
        isActive: false,
      });
      const context = createMockExecutionContext({ tenantId: TEST_TENANT_ID });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Tenant is suspended. Please contact your administrator.',
      );
    });

    it('should throw ForbiddenException when tenant is not found', async () => {
      db.client.tenant.findUnique.mockResolvedValue(null);
      const context = createMockExecutionContext({ tenantId: 'non-existent-tenant' });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Tenant not found or inactive');
    });

    it('should throw ForbiddenException when tenantId is missing from user', async () => {
      const context = createMockExecutionContext({ tenantId: undefined });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Tenant context is required');
    });

    it('should throw ForbiddenException when user is undefined', async () => {
      const context = createMockExecutionContext(undefined);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Tenant context is required');
    });

    it('should throw ForbiddenException when user object has no tenantId property', async () => {
      const context = createMockExecutionContext({} as any);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Tenant context is required');
    });

    it('should extract tenantId from the JWT user in the request', async () => {
      db.client.tenant.findUnique.mockResolvedValue({
        id: 'tenant-xyz',
        name: 'XYZ Corp',
        isActive: true,
      });
      const context = createMockExecutionContext({ tenantId: 'tenant-xyz' });

      await guard.canActivate(context);

      expect(db.client.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: 'tenant-xyz' },
      });
    });

    it('should not make a DB call when tenantId is missing', async () => {
      const context = createMockExecutionContext({ tenantId: undefined });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);

      // tenant lookup should never happen if tenantId is missing
      expect(db.client.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('should look up tenant using db.client (not forTenant)', async () => {
      db.client.tenant.findUnique.mockResolvedValue({
        id: TEST_TENANT_ID,
        name: 'Acme Corp',
        isActive: true,
      });
      const context = createMockExecutionContext({ tenantId: TEST_TENANT_ID });

      await guard.canActivate(context);

      // The guard uses db.client directly (not forTenant), because the guard
      // itself needs to verify the tenant before scoped queries can happen
      expect(db.client.tenant.findUnique).toHaveBeenCalledOnce();
      expect(db.forTenant).not.toHaveBeenCalled();
    });
  });

  describe('cross-tenant isolation', () => {
    it('should always use the tenantId from the authenticated user JWT', async () => {
      // Simulate two different tenant requests
      const tenantIds = ['tenant-alpha', 'tenant-beta'];

      for (const tenantId of tenantIds) {
        db.client.tenant.findUnique.mockResolvedValue({
          id: tenantId,
          name: `Tenant ${tenantId}`,
          isActive: true,
        });

        const context = createMockExecutionContext({ tenantId });
        const result = await guard.canActivate(context);
        expect(result).toBe(true);
      }

      // Verify each call used the correct tenant ID
      expect(db.client.tenant.findUnique).toHaveBeenNthCalledWith(1, {
        where: { id: 'tenant-alpha' },
      });
      expect(db.client.tenant.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: 'tenant-beta' },
      });
    });

    it('should not allow one tenant to access another tenant by having correct tenantId', async () => {
      // Tenant A's user should only be able to access tenant A
      db.client.tenant.findUnique.mockResolvedValue({
        id: 'tenant-a',
        name: 'Tenant A',
        isActive: true,
      });

      const contextA = createMockExecutionContext({ tenantId: 'tenant-a' });
      expect(await guard.canActivate(contextA)).toBe(true);

      // If tenant B doesn't exist, access is denied
      db.client.tenant.findUnique.mockResolvedValue(null);

      const contextB = createMockExecutionContext({ tenantId: 'tenant-b' });
      await expect(guard.canActivate(contextB)).rejects.toThrow(ForbiddenException);
    });

    it('should reject a request if the tenant was recently deactivated', async () => {
      // First check: tenant is active
      db.client.tenant.findUnique.mockResolvedValueOnce({
        id: TEST_TENANT_ID,
        name: 'Acme Corp',
        isActive: true,
      });

      const context1 = createMockExecutionContext({ tenantId: TEST_TENANT_ID });
      expect(await guard.canActivate(context1)).toBe(true);

      // Second check: tenant was deactivated between requests
      db.client.tenant.findUnique.mockResolvedValueOnce({
        id: TEST_TENANT_ID,
        name: 'Acme Corp',
        isActive: false,
      });

      const context2 = createMockExecutionContext({ tenantId: TEST_TENANT_ID });
      await expect(guard.canActivate(context2)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context2)).rejects.toThrow(
        'Tenant is suspended. Please contact your administrator.',
      );
    });
  });
});
