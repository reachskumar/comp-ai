"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  totalEmployees: number;
  activeCycles: number;
  complianceScore: number | null;
  pendingAnomalies: number;
  recentImports: number;
  recentActivity: ActivityEntry[];
}

export interface CurrentSyncStatus {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  phase: string | null;
  processedRecords: number;
  totalRecords: number;
  failedRecords: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// ─── Hook ────────────────────────────────────────────────

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () =>
      apiClient.fetch<DashboardSummary>("/api/v1/dashboard/summary"),
  });
}

/**
 * Polls the tenant's most recent full-sync job so the UI can render a live
 * progress banner. Polls every 3s while a sync is RUNNING/PENDING; polls every
 * 60s otherwise (so we still catch a sync kicked off by the platform admin).
 */
export function useCurrentSyncStatus() {
  return useQuery<CurrentSyncStatus | null>({
    queryKey: ["dashboard-sync-status"],
    queryFn: () =>
      apiClient.fetch<CurrentSyncStatus | null>(
        "/api/v1/dashboard/sync-status/current",
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "RUNNING" || status === "PENDING") return 3000;
      return 60000;
    },
    refetchIntervalInBackground: true,
  });
}

