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

// ─── Phase 1: Diagnose ──────────────────────────────────────────────

export interface TrendPoint {
  runId: string;
  at: string;
  methodology: string;
  worstGapPercent: number;
  worstCohort: string | null;
  significantCount: number;
  totalEmployees: number;
  methodologyVersion: string;
}

export interface TrendResponse {
  series: TrendPoint[];
  methodologyShifts: number[];
  dimension: string | null;
}

export function usePayEquityTrend(dimension?: string, limit = 12) {
  const params = new URLSearchParams();
  if (dimension) params.set('dimension', dimension);
  params.set('limit', String(limit));
  return useQuery<TrendResponse>({
    queryKey: ['pay-equity-trend', dimension, limit],
    queryFn: () => apiClient.fetch(`/api/v1/pay-equity/trend?${params}`),
  });
}

export interface CohortCell {
  dimension: string;
  group: string;
  referenceGroup: string;
  gapPercent: number;
  pValue: number;
  significance: string;
  sampleSize: number;
  riskLevel: string;
  avgCompaRatio: number | null;
  medianCompaRatio: number | null;
  suppressed: boolean;
  severityScore: number;
}

export interface CohortsResponse {
  runId: string;
  runAt: string;
  dimensions: string[];
  cells: CohortCell[];
  warnings: PayEquityWarning[];
  methodology: string;
}

export function usePayEquityCohorts(runId: string | null) {
  return useQuery<CohortsResponse>({
    queryKey: ['pay-equity-cohorts', runId],
    queryFn: () => apiClient.fetch(`/api/v1/pay-equity/runs/${runId}/cohorts`),
    enabled: !!runId,
  });
}

export interface CohortDetailRow {
  id: string;
  employeeCode: string;
  name: string;
  department: string;
  level: string;
  location: string | null;
  hireDate: string;
  baseSalary: number;
  currency: string;
  performanceRating: number | null;
  compaRatio: number | null;
}

export interface CohortDetailResponse {
  runId: string;
  dimension: string;
  group: string;
  suppressed: boolean;
  suppressionReason?: string;
  statisticalTest: {
    coefficient: number;
    standardError: number;
    pValue: number;
    confidenceInterval: [number, number];
    sampleSize: number;
    gapPercent: number;
    significance: string;
  };
  rows: CohortDetailRow[];
  truncated: boolean;
}

export function usePayEquityCohortDetail(
  runId: string | null,
  dimension: string | null,
  group: string | null,
) {
  return useQuery<CohortDetailResponse>({
    queryKey: ['pay-equity-cohort-detail', runId, dimension, group],
    queryFn: () =>
      apiClient.fetch(
        `/api/v1/pay-equity/runs/${runId}/cohorts/${encodeURIComponent(
          dimension!,
        )}/${encodeURIComponent(group!)}`,
      ),
    enabled: !!runId && !!dimension && !!group,
  });
}

export interface OutlierRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  level: string;
  compaRatio: number;
  baseSalary: number;
  currency: string;
  cohort: { dimension: string; group: string };
  gapPercent: number;
  explanation: string;
}

export interface OutliersResponse {
  runId: string;
  outliers: OutlierRow[];
  total?: number;
  reason?: string;
}

export function usePayEquityOutliers(runId: string | null, dimension?: string, limit = 10) {
  const params = new URLSearchParams();
  if (dimension) params.set('dimension', dimension);
  params.set('limit', String(limit));
  return useQuery<OutliersResponse>({
    queryKey: ['pay-equity-outliers', runId, dimension, limit],
    queryFn: () => apiClient.fetch(`/api/v1/pay-equity/runs/${runId}/outliers?${params}`),
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
