'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types (mirror the PayEquityAgentResult contract) ──────────────────

export interface PayEquityCitation {
  type:
    | 'employee_row'
    | 'cohort_query'
    | 'regression_coefficient'
    | 'policy_line'
    | 'external_source'
    | 'prior_run';
  ref: string;
  excerpt?: string;
}

export interface PayEquityMethodology {
  name: string;
  version: string;
  controls: string[];
  dependentVariable: 'log_salary' | 'log_total_comp' | 'salary' | 'total_comp';
  sampleSize: number;
  confidenceInterval: number;
  complianceThreshold?: number;
  llmModel?: string;
  llmModelVersion?: string;
}

export interface PayEquityWarning {
  code: string;
  message: string;
}

export interface PayEquityRunSummary {
  id: string;
  agentType: string;
  methodologyName: string;
  methodologyVersion: string;
  sampleSize: number;
  status: string;
  summary: string | null;
  createdAt: string;
}

export interface PayEquityOverviewEmpty {
  hasData: false;
  message: string;
}

export interface PayEquityOverviewData {
  hasData: true;
  latestRunId: string;
  latestRunAt: string;
  methodology: string;
  worstGapPercent: number;
  worstCohort: string;
  worstPValue: number;
  significantCount: number;
  atRiskEmployees: number;
  totalEmployees: number;
  confidence: 'high' | 'medium' | 'low';
  warningCount: number;
  delta: { worstGapPercentDelta: number; significantCountDelta: number } | null;
  summary: string | null;
}

export type PayEquityOverview = PayEquityOverviewEmpty | PayEquityOverviewData;

export interface RunAnalysisInput {
  dimensions: string[];
  controlVariables?: string[];
  targetThreshold?: number;
  note?: string;
}

export interface RunAnalysisResult {
  runId: string;
  envelope: {
    output: unknown;
    citations: PayEquityCitation[];
    methodology: PayEquityMethodology;
    confidence: 'high' | 'medium' | 'low';
    warnings: PayEquityWarning[];
    runId: string;
    generatedAt: string;
  };
}

// ─── Hooks ───────────────────────────────────────────────────────────

export function usePayEquityOverview() {
  return useQuery<PayEquityOverview>({
    queryKey: ['pay-equity-overview'],
    queryFn: () => apiClient.fetch<PayEquityOverview>('/api/v1/pay-equity/overview'),
  });
}

export function usePayEquityRuns(page = 1, limit = 20) {
  return useQuery<{
    items: PayEquityRunSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>({
    queryKey: ['pay-equity-runs', page, limit],
    queryFn: () => apiClient.fetch(`/api/v1/pay-equity/runs?page=${page}&limit=${limit}`),
  });
}

export function usePayEquityRun(runId: string | null) {
  return useQuery({
    queryKey: ['pay-equity-run', runId],
    queryFn: () => apiClient.fetch(`/api/v1/pay-equity/runs/${runId}`),
    enabled: !!runId,
  });
}

export function useRunPayEquityAnalysisMutation() {
  const qc = useQueryClient();
  return useMutation<RunAnalysisResult, Error, RunAnalysisInput>({
    mutationFn: (input) =>
      apiClient.fetch<RunAnalysisResult>('/api/v1/pay-equity/runs', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pay-equity-overview'] });
      void qc.invalidateQueries({ queryKey: ['pay-equity-runs'] });
    },
  });
}
