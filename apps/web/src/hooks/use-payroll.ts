"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

export type PayrollStatus =
  | "DRAFT"
  | "PROCESSING"
  | "REVIEW"
  | "APPROVED"
  | "FINALIZED"
  | "ERROR";

export type AnomalyType =
  | "NEGATIVE_NET"
  | "SPIKE"
  | "DROP"
  | "UNUSUAL_DEDUCTION"
  | "MISSING_COMPONENT"
  | "DUPLICATE"
  | "CUSTOM";

export type AnomalySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PayrollRun {
  id: string;
  tenantId: string;
  period: string;
  status: PayrollStatus;
  totalGross: number;
  totalNet: number;
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
  _count?: { anomalies: number; lineItems: number };
}

export interface PayrollAnomaly {
  id: string;
  payrollRunId: string;
  employeeId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  details: Record<string, unknown>;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface TraceStep {
  order: number;
  type: "DATA_CHANGE" | "RULE_APPLIED" | "RECOMMENDATION" | "APPROVAL" | "PAYROLL_IMPACT";
  timestamp: string;
  actor: string | null;
  action: string;
  details: Record<string, unknown>;
  beforeValue: string | null;
  afterValue: string | null;
  explanation: string;
}

export interface TraceReport {
  payrollRunId: string;
  employeeId: string;
  employeeName: string;
  period: string;
  component: string | null;
  generatedAt: string;
  steps: TraceStep[];
  summary: string;
  isComplete: boolean;
  warnings: string[];
}

export interface ReconciliationSummary {
  payrollRunId: string;
  period: string;
  status: string;
  totalEmployees: number;
  totalLineItems: number;
  totalGross: number;
  totalNet: number;
  totalAnomalies: number;
  anomaliesBySeverity: Record<string, number>;
  anomaliesByType: Record<string, number>;
  resolvedCount: number;
  unresolvedCount: number;
  totalAmountAtRisk: number;
  hasBlockers: boolean;
}

export interface ReconciliationReport {
  summary: ReconciliationSummary;
  anomalies: PayrollAnomaly[];
  traces: TraceReport[];
  generatedAt: string;
}

export interface PayrollListResponse {
  data: PayrollRun[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface AnomalyListResponse {
  data: PayrollAnomaly[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// ─── Download / Export helper ────────────────────────────

const API_BASE_URL = process.env["NEXT_PUBLIC_API_URL"] || "http://localhost:4000";

export function triggerExport(runId: string, format: "csv" | "pdf") {
  const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
  const url = `${API_BASE_URL}/api/v1/payroll/${runId}/export?format=${format}`;

  fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((res) => {
      if (!res.ok) throw new Error("Export failed");
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `reconciliation-${runId}.${format === "pdf" ? "txt" : "csv"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    })
    .catch(console.error);
}

// ─── TanStack Query Hooks ───────────────────────────────

export function usePayrollRuns(page: number, limit: number, status?: string) {
  return useQuery<PayrollListResponse>({
    queryKey: ["payroll-runs", page, limit, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      return apiClient.fetch<PayrollListResponse>(`/api/v1/payroll?${params}`);
    },
  });
}

export function useReconciliationReport(runId: string | null) {
  return useQuery<ReconciliationReport>({
    queryKey: ["payroll-report", runId],
    queryFn: () => apiClient.fetch<ReconciliationReport>(`/api/v1/payroll/${runId}/report`),
    enabled: !!runId,
  });
}

export function useAnomalies(
  runId: string | null,
  page: number,
  limit: number,
  filters?: { anomalyType?: string; severity?: string; resolved?: string },
) {
  return useQuery<AnomalyListResponse>({
    queryKey: ["payroll-anomalies", runId, page, limit, filters],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters?.anomalyType) params.set("anomalyType", filters.anomalyType);
      if (filters?.severity) params.set("severity", filters.severity);
      if (filters?.resolved) params.set("resolved", filters.resolved);
      return apiClient.fetch<AnomalyListResponse>(`/api/v1/payroll/${runId}/anomalies?${params}`);
    },
    enabled: !!runId,
  });
}

export function useCreatePayrollRun() {
  const qc = useQueryClient();
  return useMutation<PayrollRun, Error, { period: string; lineItems: { employeeId: string; component: string; amount: number; previousAmount?: number }[] }>({
    mutationFn: (data) =>
      apiClient.fetch<PayrollRun>("/api/v1/payroll", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
  });
}

export function useRunCheck() {
  const qc = useQueryClient();
  return useMutation<{ payrollRunId: string; status: string; anomalyReport?: unknown }, Error, string>({
    mutationFn: (runId) =>
      apiClient.fetch(`/api/v1/payroll/${runId}/check`, { method: "POST" }),
    onSuccess: (_data, runId) => {
      void qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      void qc.invalidateQueries({ queryKey: ["payroll-report", runId] });
      void qc.invalidateQueries({ queryKey: ["payroll-anomalies"] });
    },
  });
}

export function useResolveAnomaly(runId: string) {
  const qc = useQueryClient();
  return useMutation<PayrollAnomaly, Error, { anomalyId: string; resolutionNotes: string }>({
    mutationFn: ({ anomalyId, resolutionNotes }) =>
      apiClient.fetch<PayrollAnomaly>(`/api/v1/payroll/${runId}/anomalies/${anomalyId}`, {
        method: "PATCH",
        body: JSON.stringify({ resolutionNotes }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll-anomalies"] });
      void qc.invalidateQueries({ queryKey: ["payroll-report", runId] });
    },
  });
}

// ─── AI Anomaly Explanation Hooks ────────────────────────

export interface AnomalyExplanation {
  id: string;
  anomalyId: string;
  explanation: string;
  rootCause: string;
  contributingFactors: string[];
  recommendedAction: string;
  confidence: number;
  reasoning: string;
  createdAt: string;
}

export function useAnomalyExplanation(runId: string | null, anomalyId: string | null) {
  return useQuery<AnomalyExplanation | null>({
    queryKey: ["anomaly-explanation", runId, anomalyId],
    queryFn: () =>
      apiClient.fetch<AnomalyExplanation | null>(
        `/api/v1/payroll/${runId}/anomalies/${anomalyId}/explanation`,
      ),
    enabled: !!runId && !!anomalyId,
  });
}

export function useExplainAnomaly(runId: string) {
  const qc = useQueryClient();
  return useMutation<AnomalyExplanation, Error, string>({
    mutationFn: (anomalyId: string) =>
      apiClient.fetch<AnomalyExplanation>(
        `/api/v1/payroll/${runId}/anomalies/${anomalyId}/explain`,
        { method: "POST" },
      ),
    onSuccess: (_data, anomalyId) => {
      void qc.invalidateQueries({ queryKey: ["anomaly-explanation", runId, anomalyId] });
    },
  });
}

export function useBatchExplain(runId: string) {
  const qc = useQueryClient();
  return useMutation<AnomalyExplanation[], Error, string[]>({
    mutationFn: (anomalyIds: string[]) =>
      apiClient.fetch<AnomalyExplanation[]>(
        `/api/v1/payroll/${runId}/anomalies/explain-batch`,
        { method: "POST", body: JSON.stringify({ anomalyIds }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["anomaly-explanation"] });
    },
  });
}

