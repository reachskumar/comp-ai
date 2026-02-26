'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface SalaryBand {
  id: string;
  tenantId: string;
  jobFamily: string;
  level: string;
  location: string | null;
  currency: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  source: string | null;
  effectiveDate: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryBandListResponse {
  data: SalaryBand[];
  total: number;
  page: number;
  limit: number;
}

export interface MarketDataSource {
  id: string;
  tenantId: string;
  name: string;
  provider: 'MANUAL' | 'SURVEY' | 'API';
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR';
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeAnalysis {
  employeeId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  department: string;
  level: string;
  jobFamily: string | null;
  baseSalary: number;
  currency: string;
  compaRatio: number | null;
  bandId: string | null;
  bandP25: number | null;
  bandP50: number | null;
  bandP75: number | null;
  positioning: 'below' | 'within' | 'above' | 'unmatched';
}

export interface AnalysisSummary {
  totalEmployees: number;
  matchedToBands: number;
  unmatched: number;
  belowRange: number;
  withinRange: number;
  aboveRange: number;
  avgCompaRatio: number | null;
}

export interface AnalysisResponse {
  employees: EmployeeAnalysis[];
  summary: AnalysisSummary;
  totalBands: number;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useSalaryBands(filters?: {
  jobFamily?: string;
  level?: string;
  location?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.jobFamily) params.set('jobFamily', filters.jobFamily);
  if (filters?.level) params.set('level', filters.level);
  if (filters?.location) params.set('location', filters.location);
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 50));

  return useQuery<SalaryBandListResponse>({
    queryKey: ['salary-bands', filters],
    queryFn: () => apiClient.fetch<SalaryBandListResponse>(`/api/v1/benchmarking/bands?${params}`),
  });
}

export function useCreateSalaryBandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<SalaryBand, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>) =>
      apiClient.fetch<SalaryBand>('/api/v1/benchmarking/bands', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['salary-bands'] });
    },
  });
}

export function useUpdateSalaryBandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<SalaryBand>) =>
      apiClient.fetch<SalaryBand>(`/api/v1/benchmarking/bands/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['salary-bands'] });
    },
  });
}

export function useDeleteSalaryBandMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.fetch<void>(`/api/v1/benchmarking/bands/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['salary-bands'] });
    },
  });
}

export function useBulkImportBandsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bands: Array<Omit<SalaryBand, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>) =>
      apiClient.fetch<{ imported: number; bands: SalaryBand[] }>(
        '/api/v1/benchmarking/bands/import',
        { method: 'POST', body: JSON.stringify({ bands }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['salary-bands'] });
      void qc.invalidateQueries({ queryKey: ['benchmarking-analysis'] });
    },
  });
}

export function useBenchmarkingAnalysis() {
  return useQuery<AnalysisResponse>({
    queryKey: ['benchmarking-analysis'],
    queryFn: () => apiClient.fetch<AnalysisResponse>('/api/v1/benchmarking/analysis'),
  });
}

export function useMarketDataSources() {
  return useQuery<MarketDataSource[]>({
    queryKey: ['market-data-sources'],
    queryFn: () => apiClient.fetch<MarketDataSource[]>('/api/v1/benchmarking/sources'),
  });
}

export function useCreateMarketDataSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; provider: string; config?: Record<string, unknown> }) =>
      apiClient.fetch<MarketDataSource>('/api/v1/benchmarking/sources', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market-data-sources'] });
    },
  });
}
