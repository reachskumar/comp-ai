'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Query Hooks ──────────────────────────────────────────

export function useAdminTenants(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: ['admin-tenants', params],
    queryFn: () => apiClient.adminListTenants(params),
  });
}

export function useAdminTenant(id: string | null) {
  return useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: () => apiClient.adminGetTenant(id!),
    enabled: !!id,
  });
}

export function useAdminTenantUsers(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-users', tenantId],
    queryFn: () => apiClient.adminListTenantUsers(tenantId!),
    enabled: !!tenantId,
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiClient.adminGetStats(),
  });
}

// ─── Mutation Hooks ───────────────────────────────────────

export function useAdminCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      slug?: string;
      subdomain?: string;
      plan?: string;
      compportSchema?: string;
    }) => apiClient.adminCreateTenant(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}

export function useAdminUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.adminUpdateTenant(id, data),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      void qc.invalidateQueries({ queryKey: ['admin-tenant', vars.id] });
    },
  });
}

export function useAdminSuspendTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.adminSuspendTenant(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}

export function useAdminActivateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.adminActivateTenant(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}

export function useAdminCreateTenantUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tenantId,
      data,
    }: {
      tenantId: string;
      data: { email: string; name: string; role?: string };
    }) => apiClient.adminCreateTenantUser(tenantId, data),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['admin-tenant-users', vars.tenantId],
      });
    },
  });
}

export function useAdminRemoveTenantUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, userId }: { tenantId: string; userId: string }) =>
      apiClient.adminRemoveTenantUser(tenantId, userId),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: ['admin-tenant-users', vars.tenantId],
      });
    },
  });
}

export function useAdminOnboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      companyName: string;
      compportSchema: string;
      subdomain?: string;
      adminEmail?: string;
      adminName?: string;
    }) => apiClient.adminOnboard(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
}

// ─── Bridge Query Hooks ──────────────────────────────────

export function useBridgeDiscoveryTables(schemaName: string | null) {
  return useQuery({
    queryKey: ['bridge-discovery-tables', schemaName],
    queryFn: () => apiClient.bridgeDiscoveryTables(schemaName!),
    enabled: !!schemaName,
  });
}

export function useBridgeQueryTable(
  schemaName: string | null,
  tableName: string | null,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: ['bridge-query', schemaName, tableName, params],
    queryFn: () => apiClient.bridgeQueryTable(schemaName!, tableName!, params),
    enabled: !!schemaName && !!tableName,
  });
}

export function useMyDataTables() {
  return useQuery({
    queryKey: ['my-data-tables'],
    queryFn: () => apiClient.bridgeMyDataTables(),
  });
}

export function useMyDataQuery(
  tableName: string | null,
  params?: { limit?: number; offset?: number },
) {
  return useQuery({
    queryKey: ['my-data-query', tableName, params],
    queryFn: () => apiClient.bridgeMyDataQuery(tableName!, params),
    enabled: !!tableName,
  });
}
