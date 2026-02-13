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

// ─── Hook ────────────────────────────────────────────────

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () =>
      apiClient.fetch<DashboardSummary>("/api/v1/dashboard/summary"),
  });
}

