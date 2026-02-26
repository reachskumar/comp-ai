'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface DepartmentAllocation {
  department: string;
  currentBudget: number;
  suggestedBudget: number;
  reasoning: string;
  retentionImpact: string;
  equityImpact: string;
}

export interface ScenarioAllocation {
  department: string;
  amount: number;
  percentOfTotal: number;
}

export interface OptimizationScenario {
  name: string;
  description: string;
  allocations: ScenarioAllocation[];
  tradeoffs: string;
}

export interface ImpactSummary {
  retentionRiskReduction: string;
  equityGapsClosed: string;
  keyInsights: string[];
}

export interface BudgetOptimizationResult {
  cycleId: string;
  totalBudget: number;
  raw: string;
  summary?: string;
  allocations?: DepartmentAllocation[];
  scenarios?: OptimizationScenario[];
  impactSummary?: ImpactSummary;
}

export interface BudgetOptimizeInput {
  cycleId: string;
  totalBudget: number;
  constraints?: {
    minPerDept?: number;
    maxPerDept?: number;
    priorityDepartments?: string[];
  };
}

export interface ApplyAllocationInput {
  cycleId: string;
  allocations: Array<{ department: string; amount: number }>;
}

// ─── Hooks ───────────────────────────────────────────────

export function useBudgetOptimizeMutation() {
  return useMutation<BudgetOptimizationResult, Error, BudgetOptimizeInput>({
    mutationFn: ({ cycleId, ...body }) =>
      apiClient.fetch<BudgetOptimizationResult>(`/api/v1/cycles/${cycleId}/budget-optimize`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

export function useApplyBudgetAllocationMutation() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, ApplyAllocationInput>({
    mutationFn: ({ cycleId, allocations }) =>
      apiClient.fetch(`/api/v1/cycles/${cycleId}/budget-optimize/apply`, {
        method: 'POST',
        body: JSON.stringify({ allocations }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['cycle', vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['cycle-summary', vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}
