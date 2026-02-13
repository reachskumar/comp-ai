"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

export type ImportStatus =
  | "PENDING"
  | "ANALYZING"
  | "REVIEW"
  | "CLEANING"
  | "APPROVED"
  | "COMPLETED";

export interface ImportJob {
  id: string;
  tenantId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  encoding: string | null;
  totalRows: number | null;
  cleanRows: number | null;
  rejectRows: number | null;
  settings: Record<string, unknown>;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportIssue {
  id: string;
  importJobId: string;
  row: number;
  column: number;
  fieldName: string;
  issueType: string;
  severity: "ERROR" | "WARNING" | "INFO";
  originalValue: string | null;
  cleanedValue: string | null;
  resolution: string | null;
  createdAt: string;
}

export interface UploadResponse {
  id: string;
  status: ImportStatus;
  fileName: string;
  totalRows: number;
  analysis?: AnalysisReport;
}

export interface AnalysisReport {
  fileInfo: {
    size: number;
    totalRows: number;
    totalColumns: number;
    headers: string[];
  };
  encoding: {
    encoding: string;
    confidence: number;
    hasBOM: boolean;
    bomType: string;
  };
  issues: AnalysisIssue[];
  summary: {
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  fieldReports: FieldReport[];
}

export interface AnalysisIssue {
  row: number;
  column: number;
  type: string;
  severity: "ERROR" | "WARNING" | "INFO";
  originalValue: string;
  suggestedFix: string;
  description: string;
}

export interface FieldReport {
  columnIndex: number;
  columnName: string;
  fieldType: string | null;
  totalValues: number;
  emptyValues: number;
  invalidValues: number;
  issues: AnalysisIssue[];
}

export interface AnalysisResponse {
  analysis: AnalysisReport;
  issues: ImportIssue[];
}

export interface CellDiff {
  row: number;
  column: number;
  columnName: string;
  originalValue: string;
  cleanedValue: string;
  operations: string[];
}

export interface CleaningSummary {
  totalRows: number;
  cleanedRows: number;
  rejectedRows: number;
  unchangedRows: number;
  totalCellsModified: number;
  operationCounts: Record<string, number>;
}

export interface CleanResponse {
  cleanedRows: number;
  rejectedRows: number;
  diffReport: CellDiff[];
  summary: CleaningSummary;
}

export interface ApproveResponse {
  imported: number;
  created: number;
  updated: number;
}

export interface ImportListResponse {
  data: ImportJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ImportDetailResponse extends ImportJob {
  issues: ImportIssue[];
}

// ─── API Base URL ────────────────────────────────────────

const API_BASE_URL = process.env["NEXT_PUBLIC_API_URL"] || "http://localhost:4000";

// ─── Download helper ────────────────────────────────────

export function downloadUrl(jobId: string, type: "cleaned" | "rejects"): string {
  return `${API_BASE_URL}/api/v1/imports/${jobId}/download/${type}`;
}

export function triggerDownload(jobId: string, type: "cleaned" | "rejects") {
  const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
  const url = downloadUrl(jobId, type);

  fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((res) => {
      if (!res.ok) throw new Error("Download failed");
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${type}-${jobId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    })
    .catch(console.error);
}

// ─── Upload helper (multipart) ──────────────────────────

export async function uploadFile(file: File): Promise<UploadResponse> {
  const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/v1/imports/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `Upload failed (${res.status})`);
  }

  return res.json() as Promise<UploadResponse>;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useImportList(page: number, limit: number, status?: string) {
  return useQuery<ImportListResponse>({
    queryKey: ["imports", page, limit, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      return apiClient.fetch<ImportListResponse>(`/api/v1/imports?${params}`);
    },
  });
}

export function useImportDetail(id: string | null) {
  return useQuery<ImportDetailResponse>({
    queryKey: ["import", id],
    queryFn: () => apiClient.fetch<ImportDetailResponse>(`/api/v1/imports/${id}`),
    enabled: !!id,
  });
}

export function useAnalysis(id: string | null) {
  return useQuery<AnalysisResponse>({
    queryKey: ["import-analysis", id],
    queryFn: () => apiClient.fetch<AnalysisResponse>(`/api/v1/imports/${id}/analyze`),
    enabled: !!id,
  });
}

export function useUploadMutation() {
  const qc = useQueryClient();
  return useMutation<UploadResponse, Error, File>({
    mutationFn: uploadFile,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}

export function useCleanMutation() {
  const qc = useQueryClient();
  return useMutation<CleanResponse, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<CleanResponse>(`/api/v1/imports/${id}/clean`, { method: "POST" }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["import", id] });
      void qc.invalidateQueries({ queryKey: ["import-analysis", id] });
    },
  });
}

export function useApproveMutation() {
  const qc = useQueryClient();
  return useMutation<ApproveResponse, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<ApproveResponse>(`/api/v1/imports/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ approve: true }),
      }),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["import", id] });
      void qc.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}



// ─── AI Data Quality Types ──────────────────────────────────

export interface AIIssueFixSuggestion {
  row: number;
  column: string;
  originalValue: string;
  suggestedValue: string;
  confidence: number;
  explanation: string;
}

export interface AIIssueGroup {
  groupName: string;
  issueType: string;
  severity: string;
  count: number;
  explanation: string;
  suggestedFixes: AIIssueFixSuggestion[];
}

export interface AIBulkFix {
  description: string;
  affectedRows: number;
  fixType: string;
}

export interface AIQualityReport {
  qualityScore: number;
  summary: string;
  issueGroups: AIIssueGroup[];
  bulkFixes: AIBulkFix[];
  recommendations: string[];
}

export interface AIAnalysisResponse {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  qualityScore?: number | null;
  summary?: string | null;
  report?: AIQualityReport | null;
  createdAt?: string;
  completedAt?: string | null;
  errorMsg?: string | null;
}

export interface AIFixResponse {
  applied: number;
  total: number;
  preview: Array<{ row: number; column: string; before: string; after: string }>;
}

// ─── AI Data Quality Hooks ──────────────────────────────────

export function useAIAnalyzeMutation() {
  const qc = useQueryClient();
  return useMutation<AIAnalysisResponse, Error, string>({
    mutationFn: (importJobId) =>
      apiClient.fetch<AIAnalysisResponse>(
        `/api/v1/imports/${importJobId}/ai-analyze`,
        { method: "POST" },
      ),
    onSuccess: (_data, importJobId) => {
      void qc.invalidateQueries({ queryKey: ["import-ai-report", importJobId] });
    },
  });
}

export function useAIReport(importJobId: string | undefined) {
  return useQuery<AIAnalysisResponse>({
    queryKey: ["import-ai-report", importJobId],
    queryFn: () =>
      apiClient.fetch<AIAnalysisResponse>(
        `/api/v1/imports/${importJobId}/ai-report`,
      ),
    enabled: !!importJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "RUNNING" || data?.status === "PENDING") return 3000;
      return false;
    },
  });
}

export function useAIFixMutation() {
  const qc = useQueryClient();
  return useMutation<
    AIFixResponse,
    Error,
    { importJobId: string; fixes: Array<{ row: number; column: string; suggestedValue: string }> }
  >({
    mutationFn: ({ importJobId, fixes }) =>
      apiClient.fetch<AIFixResponse>(
        `/api/v1/imports/${importJobId}/ai-fix`,
        { method: "POST", body: JSON.stringify({ fixes }) },
      ),
    onSuccess: (_data, { importJobId }) => {
      void qc.invalidateQueries({ queryKey: ["import", importJobId] });
      void qc.invalidateQueries({ queryKey: ["import-ai-report", importJobId] });
    },
  });
}
