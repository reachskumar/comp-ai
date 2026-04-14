'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface CompportDataResponse<T = Record<string, unknown>> {
  data: T[];
  total: number;
}

export interface CompportTableCount {
  tableName: string;
  count: number;
}

// ─── Generic hook for any compport-data endpoint ─────────

function useCompportData<T = Record<string, unknown>>(
  endpoint: string,
  params?: { limit?: number },
  enabled = true,
) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  const path = `/api/v1/compport-data/${endpoint}${q ? `?${q}` : ''}`;

  return useQuery<CompportDataResponse<T>>({
    queryKey: ['compport-data', endpoint, params],
    queryFn: () => apiClient.fetch<CompportDataResponse<T>>(path),
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min — matches Redis cache TTL
  });
}

// ─── Compensation Cycles ────────────────────────────────

export function useCompportCycles(limit = 50) {
  return useCompportData('cycles', { limit });
}

// ─── Salary Rules ───────────────────────────────────────

export function useCompportSalaryRules(limit = 100) {
  return useCompportData('salary-rules', { limit });
}

export function useCompportBonusRules(limit = 100) {
  return useCompportData('bonus-rules', { limit });
}

export function useCompportLtiRules(limit = 100) {
  return useCompportData('lti-rules', { limit });
}

// ─── Employee Compensation ──────────────────────────────

export function useCompportSalaryDetails(limit = 50) {
  return useCompportData('salary-details', { limit });
}

export function useCompportBonusDetails(limit = 50) {
  return useCompportData('bonus-details', { limit });
}

export function useCompportLtiDetails(limit = 50) {
  return useCompportData('lti-details', { limit });
}

// ─── Letters ────────────────────────────────────────────

export function useCompportLetters(limit = 50) {
  return useCompportData('letters', { limit });
}

// ─── Market Data ────────────────────────────────────────

export function useCompportMarketData(limit = 200) {
  return useCompportData('market-data', { limit });
}

export function useCompportPayRanges(limit = 200) {
  return useCompportData('pay-ranges', { limit });
}

// ─── Grade / Band / Level Structure ─────────────────────

export function useCompportGradeBands(limit = 200) {
  return useCompportData('grade-bands', { limit });
}

export function useCompportPayGrades(limit = 200) {
  return useCompportData('pay-grades', { limit });
}

export function useCompportSalaryBands(limit = 200) {
  return useCompportData('salary-bands', { limit });
}

export function useCompportManageBands(limit = 200) {
  return useCompportData('manage-bands', { limit });
}

export function useCompportManageGrades(limit = 200) {
  return useCompportData('manage-grades', { limit });
}

export function useCompportManageLevels(limit = 200) {
  return useCompportData('manage-levels', { limit });
}

export function useCompportManageDesignations(limit = 200) {
  return useCompportData('manage-designations', { limit });
}

export function useCompportManageFunctions(limit = 200) {
  return useCompportData('manage-functions', { limit });
}

// ─── Proration ──────────────────────────────────────────

export function useCompportProrationRules(limit = 100) {
  return useCompportData('proration-rules', { limit });
}

// ─── Employee History ───────────────────────────────────

export function useCompportEmployeeHistory(limit = 50) {
  return useCompportData('employee-history', { limit });
}

// ─── Minimum Wage ───────────────────────────────────────

export function useCompportMinimumWage(limit = 200) {
  return useCompportData('minimum-wage', { limit });
}

// ─── Generic Table Query ────────────────────────────────

export function useCompportTable(tableName: string, limit = 50, enabled = true) {
  const qs = new URLSearchParams();
  if (limit) qs.set('limit', String(limit));
  const q = qs.toString();
  const path = `/api/v1/compport-data/table/${tableName}${q ? `?${q}` : ''}`;

  return useQuery<CompportDataResponse>({
    queryKey: ['compport-data', 'table', tableName, limit],
    queryFn: () => apiClient.fetch<CompportDataResponse>(path),
    enabled: enabled && !!tableName,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCompportTableCount(tableName: string, enabled = true) {
  return useQuery<CompportTableCount>({
    queryKey: ['compport-data', 'table-count', tableName],
    queryFn: () =>
      apiClient.fetch<CompportTableCount>(`/api/v1/compport-data/table/${tableName}/count`),
    enabled: enabled && !!tableName,
    staleTime: 5 * 60 * 1000,
  });
}
