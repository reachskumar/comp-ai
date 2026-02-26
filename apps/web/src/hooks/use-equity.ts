'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface EquityPlan {
  id: string;
  tenantId: string;
  name: string;
  planType: 'RSU' | 'ISO' | 'NSO' | 'SAR' | 'PHANTOM';
  totalSharesAuthorized: number;
  sharesIssued: number;
  sharesAvailable: number;
  sharePrice: number;
  currency: string;
  effectiveDate: string;
  expirationDate: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { grants: number };
}

export interface EquityGrant {
  id: string;
  tenantId: string;
  employeeId: string;
  planId: string;
  grantType: 'RSU' | 'ISO' | 'NSO' | 'SAR' | 'PHANTOM';
  grantDate: string;
  totalShares: number;
  vestedShares: number;
  exercisedShares: number;
  grantPrice: number;
  currentPrice: number;
  vestingScheduleType: string;
  vestingStartDate: string;
  cliffMonths: number;
  vestingMonths: number;
  status: 'PENDING' | 'ACTIVE' | 'PARTIALLY_VESTED' | 'FULLY_VESTED' | 'CANCELLED' | 'EXPIRED';
  expirationDate: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    department: string;
    email?: string;
    level?: string;
  };
  plan?: { id: string; name: string; planType: string; sharePrice?: number };
  vestingEvents?: VestingEvent[];
  _count?: { vestingEvents: number };
}

export interface VestingEvent {
  id: string;
  grantId: string;
  vestDate: string;
  sharesVested: number;
  cumulativeVested: number;
  status: 'SCHEDULED' | 'VESTED' | 'CANCELLED';
  vestedAt: string | null;
}

export interface EquityPortfolio {
  grants: EquityGrant[];
  summary: {
    totalGrants: number;
    totalGrantedShares: number;
    totalVestedShares: number;
    totalUnvestedShares: number;
    totalCurrentValue: number;
    totalGrantValue: number;
    totalGain: number;
  };
}

export interface EquityDashboard {
  plans: number;
  totalSharesAuthorized: number;
  totalSharesIssued: number;
  dilutionPercent: number;
  totalGrants: number;
  totalGrantedShares: number;
  totalVestedShares: number;
  totalCurrentValue: number;
  upcomingVests: Array<{
    id: string;
    vestDate: string;
    sharesVested: number;
    estimatedValue: number;
    employeeName: string;
    grantId: string;
  }>;
}

interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useEquityPlans(filters?: {
  planType?: string;
  isActive?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.planType) params.set('planType', filters.planType);
  if (filters?.isActive !== undefined) params.set('isActive', filters.isActive);
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 50));

  return useQuery<ListResponse<EquityPlan>>({
    queryKey: ['equity-plans', filters],
    queryFn: () => apiClient.fetch(`/api/v1/equity/plans?${params}`),
  });
}

export function useEquityPlan(id: string | undefined) {
  return useQuery<EquityPlan & { grants: EquityGrant[] }>({
    queryKey: ['equity-plan', id],
    queryFn: () => apiClient.fetch(`/api/v1/equity/plans/${id}`),
    enabled: !!id,
  });
}

export function useCreateEquityPlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      planType: string;
      totalSharesAuthorized: number;
      sharePrice: number;
      effectiveDate: string;
      currency?: string;
      expirationDate?: string;
      description?: string;
    }) =>
      apiClient.fetch<EquityPlan>('/api/v1/equity/plans', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equity-plans'] });
      void qc.invalidateQueries({ queryKey: ['equity-dashboard'] });
    },
  });
}

export function useDeleteEquityPlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch<void>(`/api/v1/equity/plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equity-plans'] });
      void qc.invalidateQueries({ queryKey: ['equity-dashboard'] });
    },
  });
}

// ─── Grants ─────────────────────────────────────────────

export function useEquityGrants(filters?: {
  employeeId?: string;
  planId?: string;
  status?: string;
  grantType?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.employeeId) params.set('employeeId', filters.employeeId);
  if (filters?.planId) params.set('planId', filters.planId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.grantType) params.set('grantType', filters.grantType);
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 50));

  return useQuery<ListResponse<EquityGrant>>({
    queryKey: ['equity-grants', filters],
    queryFn: () => apiClient.fetch(`/api/v1/equity/grants?${params}`),
  });
}

export function useEquityGrant(id: string | undefined) {
  return useQuery<EquityGrant>({
    queryKey: ['equity-grant', id],
    queryFn: () => apiClient.fetch(`/api/v1/equity/grants/${id}`),
    enabled: !!id,
  });
}

export function useCreateEquityGrantMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      employeeId: string;
      planId: string;
      grantType: string;
      grantDate: string;
      totalShares: number;
      grantPrice: number;
      currentPrice?: number;
      vestingScheduleType: string;
      vestingStartDate?: string;
      cliffMonths?: number;
      vestingMonths?: number;
      expirationDate?: string;
    }) =>
      apiClient.fetch<EquityGrant>('/api/v1/equity/grants', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equity-grants'] });
      void qc.invalidateQueries({ queryKey: ['equity-plans'] });
      void qc.invalidateQueries({ queryKey: ['equity-dashboard'] });
    },
  });
}

export function useCancelEquityGrantMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch<void>(`/api/v1/equity/grants/${id}/cancel`, { method: 'PATCH' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['equity-grants'] });
      void qc.invalidateQueries({ queryKey: ['equity-plans'] });
      void qc.invalidateQueries({ queryKey: ['equity-dashboard'] });
    },
  });
}

// ─── Portfolio & Dashboard ──────────────────────────────

export function useEquityPortfolio(employeeId: string | undefined) {
  return useQuery<EquityPortfolio>({
    queryKey: ['equity-portfolio', employeeId],
    queryFn: () => apiClient.fetch(`/api/v1/equity/portfolio/${employeeId}`),
    enabled: !!employeeId,
  });
}

export function useEquityDashboard() {
  return useQuery<EquityDashboard>({
    queryKey: ['equity-dashboard'],
    queryFn: () => apiClient.fetch('/api/v1/equity/dashboard'),
  });
}
