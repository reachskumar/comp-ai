'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export type AdHocType =
  | 'SPOT_BONUS'
  | 'RETENTION_BONUS'
  | 'MARKET_ADJUSTMENT'
  | 'PROMOTION'
  | 'EQUITY_ADJUSTMENT'
  | 'OTHER';

export type AdHocStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'APPLIED';

export interface AdHocEmployee {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  level: string;
  baseSalary: number;
  totalComp: number;
}

export interface AdHocUser {
  id: string;
  name: string;
  email: string;
}

export interface AdHocIncrease {
  id: string;
  tenantId: string;
  employeeId: string;
  requestedById: string;
  type: AdHocType;
  reason: string;
  currentValue: number;
  proposedValue: number;
  currency: string;
  effectiveDate: string;
  status: AdHocStatus;
  approverUserId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  appliedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  employee: AdHocEmployee;
  requestedBy: AdHocUser;
  approver: AdHocUser | null;
}

export interface AdHocListResponse {
  data: AdHocIncrease[];
  total: number;
  page: number;
  limit: number;
}

export interface AdHocStats {
  pendingCount: number;
  approvedThisMonth: number;
  totalApprovedAmount: number;
  byType: { type: AdHocType; count: number }[];
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useAdHocList(filters?: {
  status?: string;
  type?: string;
  department?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.department) params.set('department', filters.department);
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 20));

  return useQuery<AdHocListResponse>({
    queryKey: ['adhoc', filters],
    queryFn: () => apiClient.fetch<AdHocListResponse>(`/api/v1/adhoc?${params}`),
  });
}

export function useAdHocDetail(id: string | null) {
  return useQuery<AdHocIncrease>({
    queryKey: ['adhoc', id],
    queryFn: () => apiClient.fetch<AdHocIncrease>(`/api/v1/adhoc/${id}`),
    enabled: !!id,
  });
}

export function useAdHocStats() {
  return useQuery<AdHocStats>({
    queryKey: ['adhoc-stats'],
    queryFn: () => apiClient.fetch<AdHocStats>('/api/v1/adhoc/stats'),
  });
}

export function useCreateAdHocMutation() {
  const qc = useQueryClient();
  return useMutation<
    AdHocIncrease,
    Error,
    {
      employeeId: string;
      type: AdHocType;
      reason: string;
      currentValue: number;
      proposedValue: number;
      currency?: string;
      effectiveDate: string;
    }
  >({
    mutationFn: (body) =>
      apiClient.fetch<AdHocIncrease>('/api/v1/adhoc', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adhoc'] });
      void qc.invalidateQueries({ queryKey: ['adhoc-stats'] });
    },
  });
}

export function useUpdateAdHocMutation() {
  const qc = useQueryClient();
  return useMutation<
    AdHocIncrease,
    Error,
    {
      id: string;
      data: Partial<{
        employeeId: string;
        type: AdHocType;
        reason: string;
        currentValue: number;
        proposedValue: number;
        effectiveDate: string;
      }>;
    }
  >({
    mutationFn: ({ id, data }) =>
      apiClient.fetch<AdHocIncrease>(`/api/v1/adhoc/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adhoc'] });
    },
  });
}

export function useSubmitAdHocMutation() {
  const qc = useQueryClient();
  return useMutation<AdHocIncrease, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<AdHocIncrease>(`/api/v1/adhoc/${id}/submit`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adhoc'] });
      void qc.invalidateQueries({ queryKey: ['adhoc-stats'] });
    },
  });
}

export function useApproveAdHocMutation() {
  const qc = useQueryClient();
  return useMutation<AdHocIncrease, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<AdHocIncrease>(`/api/v1/adhoc/${id}/approve`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adhoc'] });
      void qc.invalidateQueries({ queryKey: ['adhoc-stats'] });
    },
  });
}

export function useRejectAdHocMutation() {
  const qc = useQueryClient();
  return useMutation<AdHocIncrease, Error, { id: string; reason?: string }>({
    mutationFn: ({ id, reason }) =>
      apiClient.fetch<AdHocIncrease>(`/api/v1/adhoc/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adhoc'] });
      void qc.invalidateQueries({ queryKey: ['adhoc-stats'] });
    },
  });
}

export function useApplyAdHocMutation() {
  const qc = useQueryClient();
  return useMutation<AdHocIncrease, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<AdHocIncrease>(`/api/v1/adhoc/${id}/apply`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['adhoc'] });
      void qc.invalidateQueries({ queryKey: ['adhoc-stats'] });
    },
  });
}
