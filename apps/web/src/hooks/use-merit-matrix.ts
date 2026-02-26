'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface MatrixCell {
  perfRating: number;
  compaRatioRange: string;
  increasePercent: number;
}

export interface MeritMatrix {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  matrix: MatrixCell[];
  createdAt: string;
  updatedAt: string;
  _count?: { cycles: number };
  cycles?: { id: string; name: string; status: string }[];
}

export interface SimulationEmployee {
  employeeId: string;
  name: string;
  department: string;
  level: string;
  currentSalary: number;
  performanceRating: number;
  compaRatio: number;
  increasePercent: number;
  projectedSalary: number;
  costDelta: number;
}

export interface SimulationResult {
  matrixId: string;
  totalEmployees: number;
  totalCurrentCost: number;
  totalProjectedCost: number;
  totalCostDelta: number;
  cellDistribution: Record<string, { count: number; employees: string[] }>;
  employees: SimulationEmployee[];
}

export interface ApplyToCycleResult {
  matrixId: string;
  cycleId: string;
  created: number;
  updated: number;
  total: number;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useMeritMatrixList() {
  return useQuery<MeritMatrix[]>({
    queryKey: ['merit-matrices'],
    queryFn: () => apiClient.fetch<MeritMatrix[]>('/api/v1/merit-matrix'),
  });
}

export function useMeritMatrixDetail(id: string | null) {
  return useQuery<MeritMatrix>({
    queryKey: ['merit-matrix', id],
    queryFn: () => apiClient.fetch<MeritMatrix>(`/api/v1/merit-matrix/${id}`),
    enabled: !!id,
  });
}

export function useCreateMeritMatrixMutation() {
  const qc = useQueryClient();
  return useMutation<
    MeritMatrix,
    Error,
    { name: string; isDefault?: boolean; matrix: MatrixCell[] }
  >({
    mutationFn: (body) =>
      apiClient.fetch<MeritMatrix>('/api/v1/merit-matrix', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['merit-matrices'] });
    },
  });
}

export function useUpdateMeritMatrixMutation() {
  const qc = useQueryClient();
  return useMutation<
    MeritMatrix,
    Error,
    { id: string; name?: string; isDefault?: boolean; matrix?: MatrixCell[] }
  >({
    mutationFn: ({ id, ...body }) =>
      apiClient.fetch<MeritMatrix>(`/api/v1/merit-matrix/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['merit-matrix', vars.id] });
      void qc.invalidateQueries({ queryKey: ['merit-matrices'] });
    },
  });
}

export function useDeleteMeritMatrixMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<void>(`/api/v1/merit-matrix/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['merit-matrices'] });
    },
  });
}

export function useSimulateMeritMatrixMutation() {
  return useMutation<SimulationResult, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<SimulationResult>(`/api/v1/merit-matrix/${id}/simulate`, {
        method: 'POST',
      }),
  });
}

export function useApplyToCycleMutation() {
  const qc = useQueryClient();
  return useMutation<ApplyToCycleResult, Error, { matrixId: string; cycleId: string }>({
    mutationFn: ({ matrixId, cycleId }) =>
      apiClient.fetch<ApplyToCycleResult>(
        `/api/v1/merit-matrix/${matrixId}/apply-to-cycle/${cycleId}`,
        { method: 'POST' },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['merit-matrix', vars.matrixId] });
      void qc.invalidateQueries({ queryKey: ['merit-matrices'] });
      void qc.invalidateQueries({ queryKey: ['recommendations'] });
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}
