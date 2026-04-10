'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Query Hooks ──────────────────────────────────────────

export function useAdminTenants(params?: { page?: number; limit?: number; search?: string }) {
  return useQuery({
    queryKey: ['admin-tenants', params?.page ?? 1, params?.limit ?? 20, params?.search ?? ''],
    queryFn: () => apiClient.adminListTenants(params),
    staleTime: 30_000,
  });
}

export function useAdminTenant(id: string | null) {
  return useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: () => apiClient.adminGetTenant(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useAdminTenantUsers(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-users', tenantId],
    queryFn: () => apiClient.adminListTenantUsers(tenantId!),
    enabled: !!tenantId,
    staleTime: 30_000,
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiClient.adminGetStats(),
    staleTime: 60_000,
  });
}

export function useAdminTenantOverview(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-overview', tenantId],
    queryFn: () => apiClient.adminGetTenantOverview(tenantId!),
    enabled: !!tenantId,
    staleTime: 30_000,
  });
}

export function useAdminTenantRoles(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-roles', tenantId],
    queryFn: () => apiClient.adminGetTenantRoles(tenantId!),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}

export function useAdminTenantPermissions(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-permissions', tenantId],
    queryFn: () => apiClient.adminGetTenantPermissions(tenantId!),
    enabled: !!tenantId,
    staleTime: 60_000,
  });
}

// ─── Helpers ─────────────────────────────────────────────

/** Invalidate all queries related to a specific tenant */
function invalidateTenantQueries(qc: ReturnType<typeof useQueryClient>, tenantId?: string) {
  void qc.invalidateQueries({ queryKey: ['admin-tenants'] });
  void qc.invalidateQueries({ queryKey: ['admin-stats'] });
  if (tenantId) {
    void qc.invalidateQueries({ queryKey: ['admin-tenant', tenantId] });
    void qc.invalidateQueries({ queryKey: ['admin-tenant-users', tenantId] });
    void qc.invalidateQueries({ queryKey: ['admin-tenant-overview', tenantId] });
    void qc.invalidateQueries({ queryKey: ['admin-tenant-roles', tenantId] });
    void qc.invalidateQueries({ queryKey: ['admin-tenant-permissions', tenantId] });
  }
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
    onSuccess: () => invalidateTenantQueries(qc),
  });
}

export function useAdminUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiClient.adminUpdateTenant(id, data),
    onSuccess: (_d, vars) => invalidateTenantQueries(qc, vars.id),
  });
}

export function useAdminSuspendTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.adminSuspendTenant(id),
    onSuccess: (_d, id) => invalidateTenantQueries(qc, id),
  });
}

export function useAdminActivateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.adminActivateTenant(id),
    onSuccess: (_d, id) => invalidateTenantQueries(qc, id),
  });
}

export function useAdminDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.adminDeleteTenant(id),
    onSuccess: (_d, id) => {
      // Remove all cached data for this tenant immediately
      qc.removeQueries({ queryKey: ['admin-tenant', id] });
      qc.removeQueries({ queryKey: ['admin-tenant-users', id] });
      qc.removeQueries({ queryKey: ['admin-tenant-overview', id] });
      qc.removeQueries({ queryKey: ['admin-tenant-roles', id] });
      qc.removeQueries({ queryKey: ['admin-tenant-permissions', id] });
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
    onSuccess: (_d, vars) => invalidateTenantQueries(qc, vars.tenantId),
  });
}

export function useAdminRemoveTenantUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, userId }: { tenantId: string; userId: string }) =>
      apiClient.adminRemoveTenantUser(tenantId, userId),
    onSuccess: (_d, vars) => invalidateTenantQueries(qc, vars.tenantId),
  });
}

export function useCompportTenants() {
  return useQuery({
    queryKey: ['compport-tenants'],
    queryFn: () => apiClient.adminListCompportTenants(),
    staleTime: 5 * 60_000, // 5 minutes — rarely changes
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
      adminPassword?: string;
      adminRole?: string;
      enabledFeatures?: string[];
    }) => apiClient.adminOnboard(data),
    onSuccess: () => {
      invalidateTenantQueries(qc);
      void qc.invalidateQueries({ queryKey: ['compport-tenants'] });
    },
  });
}

export function useAdminSyncTenantRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => apiClient.adminSyncTenantRoles(tenantId),
    onSuccess: (_d, tenantId) => invalidateTenantQueries(qc, tenantId),
  });
}

export function useAdminSyncTenantFull() {
  // Starts the sync, returns { jobId, status: 'RUNNING' } immediately.
  // The actual sync runs in the background; UI polls useAdminSyncJob(jobId).
  return useMutation({
    mutationFn: (tenantId: string) => apiClient.adminSyncTenantFull(tenantId),
  });
}

export function useAdminSyncJob(
  tenantId: string | null,
  jobId: string | null,
  enabled: boolean = true,
) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['admin-sync-job', tenantId, jobId],
    queryFn: () => apiClient.adminGetSyncJob(tenantId!, jobId!),
    enabled: !!tenantId && !!jobId && enabled,
    // Poll every 3 seconds while the job is running
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
        // Stop polling — and refresh tenant data so counts update
        if (tenantId) invalidateTenantQueries(qc, tenantId);
        return false;
      }
      return 3000;
    },
    refetchIntervalInBackground: true,
  });
}

export function useAdminTestTenantConnection() {
  return useMutation({
    mutationFn: (tenantId: string) => apiClient.adminTestTenantConnection(tenantId),
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
    queryKey: ['bridge-query', schemaName, tableName, params?.limit, params?.offset],
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
    queryKey: ['my-data-query', tableName, params?.limit, params?.offset],
    queryFn: () => apiClient.bridgeMyDataQuery(tableName!, params),
    enabled: !!tableName,
  });
}

// ─── Sync Health Hooks ──────────────────────────────────

export function useSyncHealth() {
  return useQuery({
    queryKey: ['sync-health'],
    queryFn: () => apiClient.bridgeSyncHealth(),
    refetchInterval: 60_000, // 60s — not a real-time dashboard
  });
}

export function usePauseSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => apiClient.bridgePauseSync(tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-health'] });
    },
  });
}

export function useResumeSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => apiClient.bridgeResumeSync(tenantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-health'] });
    },
  });
}
