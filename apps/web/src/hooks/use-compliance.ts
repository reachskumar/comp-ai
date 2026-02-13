"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { ComplianceFindingItem, ScoreHistoryPoint } from "@/components/compliance";

// ─── Types ───────────────────────────────────────────────

export interface ComplianceScan {
  id: string;
  tenantId: string;
  userId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  overallScore: number | null;
  riskSummary: Record<string, unknown> | null;
  aiReport: string | null;
  errorMsg: string | null;
  scanConfig: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  findings?: ComplianceFindingItem[];
  _count?: { findings: number };
}

export interface ScanListResponse {
  items: ComplianceScan[];
  total: number;
  page: number;
  limit: number;
}

export interface LatestScoreResponse {
  id?: string;
  overallScore: number | null;
  completedAt: string | null;
  riskSummary: Record<string, unknown>;
}

// ─── Hooks ───────────────────────────────────────────────

export function useComplianceScore() {
  return useQuery<LatestScoreResponse>({
    queryKey: ["compliance-score"],
    queryFn: () => apiClient.fetch<LatestScoreResponse>("/api/v1/compliance/score"),
  });
}

export function useComplianceScoreHistory(limit = 10) {
  return useQuery<ScoreHistoryPoint[]>({
    queryKey: ["compliance-score-history", limit],
    queryFn: () => apiClient.fetch<ScoreHistoryPoint[]>("/api/v1/compliance/score/history"),
  });
}

export function useComplianceScans(page = 1, limit = 10) {
  return useQuery<ScanListResponse>({
    queryKey: ["compliance-scans", page, limit],
    queryFn: () =>
      apiClient.fetch<ScanListResponse>(
        `/api/v1/compliance/scans?page=${page}&limit=${limit}`,
      ),
  });
}

export function useComplianceScan(scanId: string | null) {
  return useQuery<ComplianceScan>({
    queryKey: ["compliance-scan", scanId],
    queryFn: () => apiClient.fetch<ComplianceScan>(`/api/v1/compliance/scans/${scanId}`),
    enabled: !!scanId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll while scan is running
      if (data?.status === "PENDING" || data?.status === "RUNNING") return 3000;
      return false;
    },
  });
}

export function useRunComplianceScan() {
  const qc = useQueryClient();
  return useMutation<{ id: string; status: string; message: string }, Error, Record<string, unknown> | undefined>({
    mutationFn: (scanConfig) =>
      apiClient.fetch("/api/v1/compliance/scan", {
        method: "POST",
        body: JSON.stringify({ scanConfig }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["compliance-scans"] });
      void qc.invalidateQueries({ queryKey: ["compliance-score"] });
      void qc.invalidateQueries({ queryKey: ["compliance-score-history"] });
    },
  });
}

