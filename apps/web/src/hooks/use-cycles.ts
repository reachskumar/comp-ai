'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export type CycleType = 'MERIT' | 'BONUS' | 'LTI' | 'COMBINED';

export type CycleStatus =
  | 'DRAFT'
  | 'PLANNING'
  | 'ACTIVE'
  | 'CALIBRATION'
  | 'APPROVAL'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Cycle {
  id: string;
  tenantId: string;
  name: string;
  cycleType: CycleType;
  description?: string;
  status: CycleStatus;
  startDate: string;
  endDate: string;
  budgetTotal: number;
  budgetAllocated: number;
  budgetCommitted: number;
  budgetRemaining: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface CycleListResponse {
  data: Cycle[];
  total: number;
  page: number;
  limit: number;
}

export interface CycleSummary {
  totalEmployees: number;
  completedRecommendations: number;
  pendingApprovals: number;
  budgetUtilization: number;
  departments: DepartmentProgress[];
  alerts: CycleAlert[];
}

export interface DepartmentProgress {
  department: string;
  totalEmployees: number;
  completed: number;
  pending: number;
  budgetAllocated: number;
  budgetUsed: number;
}

export interface CycleAlert {
  id: string;
  type: 'BUDGET_DRIFT' | 'POLICY_VIOLATION' | 'OUTLIER' | 'DEADLINE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  department?: string;
  createdAt: string;
}

export type RecommendationStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ESCALATED';

export interface Recommendation {
  id: string;
  cycleId: string;
  employeeId: string;
  employeeName: string;
  department: string;
  level: string;
  currentSalary: number;
  proposedSalary: number;
  changePercent: number;
  status: RecommendationStatus;
  isOutlier: boolean;
  reason?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationListResponse {
  data: Recommendation[];
  total: number;
  page: number;
  limit: number;
}

export interface CalibrationSession {
  id: string;
  cycleId: string;
  name: string;
  department?: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
  participants: number;
  recommendations: number;
  createdAt: string;
  updatedAt: string;
}

export interface PendingApproval {
  id: string;
  recommendationId: string;
  employeeName: string;
  department: string;
  proposedChange: number;
  changePercent: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface MonitorSummary {
  cycleId: string;
  totalMonitors: number;
  passing: number;
  failing: number;
  lastRunAt: string;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useCycleList(page = 1, limit = 20) {
  return useQuery<CycleListResponse>({
    queryKey: ['cycles', page, limit],
    queryFn: () => apiClient.fetch<CycleListResponse>(`/api/v1/cycles?page=${page}&limit=${limit}`),
  });
}

export function useCycleDetail(id: string | null) {
  return useQuery<Cycle>({
    queryKey: ['cycle', id],
    queryFn: () => apiClient.fetch<Cycle>(`/api/v1/cycles/${id}`),
    enabled: !!id,
  });
}

export function useCycleSummary(id: string | null) {
  return useQuery<CycleSummary>({
    queryKey: ['cycle-summary', id],
    queryFn: () => apiClient.fetch<CycleSummary>(`/api/v1/cycles/${id}/summary`),
    enabled: !!id,
  });
}

export function useCycleAlerts(id: string | null) {
  return useQuery<CycleAlert[]>({
    queryKey: ['cycle-alerts', id],
    queryFn: () => apiClient.fetch<CycleAlert[]>(`/api/v1/cycles/${id}/monitors/alerts`),
    enabled: !!id,
  });
}

export function useRecommendations(
  cycleId: string | null,
  filters?: {
    department?: string;
    level?: string;
    status?: string;
    outlier?: boolean;
    page?: number;
    limit?: number;
  },
) {
  const params = new URLSearchParams();
  if (filters?.department) params.set('department', filters.department);
  if (filters?.level) params.set('level', filters.level);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.outlier !== undefined) params.set('outlier', String(filters.outlier));
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 50));

  return useQuery<RecommendationListResponse>({
    queryKey: ['recommendations', cycleId, filters],
    queryFn: () =>
      apiClient.fetch<RecommendationListResponse>(
        `/api/v1/cycles/${cycleId}/recommendations?${params}`,
      ),
    enabled: !!cycleId,
  });
}

export function usePendingApprovals(cycleId: string | null) {
  return useQuery<PendingApproval[]>({
    queryKey: ['pending-approvals', cycleId],
    queryFn: () =>
      apiClient.fetch<PendingApproval[]>(`/api/v1/cycles/${cycleId}/approvals/pending`),
    enabled: !!cycleId,
  });
}

export function useMonitorSummary(cycleId: string | null) {
  return useQuery<MonitorSummary>({
    queryKey: ['monitor-summary', cycleId],
    queryFn: () => apiClient.fetch<MonitorSummary>(`/api/v1/cycles/${cycleId}/monitors/summary`),
    enabled: !!cycleId,
  });
}

export function useCreateCycleMutation() {
  const qc = useQueryClient();
  return useMutation<
    Cycle,
    Error,
    {
      name: string;
      cycleType: CycleType;
      startDate: string;
      endDate: string;
      budgetTotal?: number;
      currency?: string;
      settings?: Record<string, unknown>;
    }
  >({
    mutationFn: (body) =>
      apiClient.fetch<Cycle>('/api/v1/cycles', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}

export interface TransitionResult extends Cycle {
  closure?: { applied: number; skipped: number; total: number; appliedEmployeeIds: string[] };
  letters?: {
    requested: number;
    enqueued: number;
    batches: Array<{ batchId: string; letterType: string; total: number }>;
    error?: string;
  };
}

export function useTransitionCycleMutation() {
  const qc = useQueryClient();
  return useMutation<
    TransitionResult,
    Error,
    {
      cycleId: string;
      targetStatus: CycleStatus;
      reason?: string;
      generateLetters?: boolean;
    }
  >({
    mutationFn: ({ cycleId, ...body }) =>
      apiClient.fetch<TransitionResult>(`/api/v1/cycles/${cycleId}/transition`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['cycle', vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
}

export function useUpdateRecommendationStatusMutation() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { cycleId: string; recommendationId: string; status: RecommendationStatus }
  >({
    mutationFn: ({ cycleId, recommendationId, status }) =>
      apiClient.fetch<void>(
        `/api/v1/cycles/${cycleId}/recommendations/${recommendationId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['recommendations', vars.cycleId],
      });
    },
  });
}

export function useBulkApprovalMutation() {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    {
      cycleId: string;
      actions: { recommendationId: string; action: 'approve' | 'reject' }[];
    }
  >({
    mutationFn: ({ cycleId, actions }) =>
      apiClient.fetch<void>(`/api/v1/cycles/${cycleId}/approvals/bulk`, {
        method: 'POST',
        body: JSON.stringify({ actions }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['recommendations', vars.cycleId],
      });
      void qc.invalidateQueries({
        queryKey: ['pending-approvals', vars.cycleId],
      });
      void qc.invalidateQueries({
        queryKey: ['cycle-summary', vars.cycleId],
      });
    },
  });
}

export function useCreateCalibrationMutation() {
  const qc = useQueryClient();
  return useMutation<
    CalibrationSession,
    Error,
    { cycleId: string; name: string; department?: string }
  >({
    mutationFn: ({ cycleId, ...body }) =>
      apiClient.fetch<CalibrationSession>(`/api/v1/cycles/${cycleId}/calibration`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['calibration-sessions', vars.cycleId],
      });
    },
  });
}

export function useCalibrationSessions(cycleId: string | null) {
  return useQuery<CalibrationSession[]>({
    queryKey: ['calibration-sessions', cycleId],
    queryFn: () => apiClient.fetch<CalibrationSession[]>(`/api/v1/cycles/${cycleId}/calibration`),
    enabled: !!cycleId,
  });
}

// ─── AI Calibration Suggestions ─────────────────────────────────────

export interface AiCalibrationSuggestion {
  recommendationId: string;
  employeeName: string;
  currentProposed: number;
  suggestedValue: number;
  changePercent: number;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AiCalibrationResponse {
  tenantId: string;
  userId: string;
  suggestions: AiCalibrationSuggestion[];
  response: string;
}

export function useAiCalibrationSuggestMutation() {
  return useMutation<AiCalibrationResponse, Error, { cycleId: string; sessionId: string }>({
    mutationFn: ({ cycleId, sessionId }) =>
      apiClient.fetch<AiCalibrationResponse>(
        `/api/v1/cycles/${cycleId}/calibration/${sessionId}/ai-suggest`,
        { method: 'POST' },
      ),
  });
}

export function useApplyAiSuggestionsMutation() {
  const qc = useQueryClient();
  return useMutation<
    { applied: number },
    Error,
    {
      cycleId: string;
      sessionId: string;
      suggestions: Array<{ recommendationId: string; suggestedValue: number }>;
    }
  >({
    mutationFn: ({ cycleId, sessionId, suggestions }) =>
      apiClient.fetch<{ applied: number }>(
        `/api/v1/cycles/${cycleId}/calibration/${sessionId}/ai-suggest/apply`,
        { method: 'POST', body: JSON.stringify({ suggestions }) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ['recommendations', vars.cycleId],
      });
      void qc.invalidateQueries({
        queryKey: ['calibration-sessions', vars.cycleId],
      });
    },
  });
}

export function useRunMonitorsMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (cycleId) =>
      apiClient.fetch<void>(`/api/v1/cycles/${cycleId}/monitors/run`, {
        method: 'POST',
      }),
    onSuccess: (_data, cycleId) => {
      void qc.invalidateQueries({ queryKey: ['cycle-alerts', cycleId] });
      void qc.invalidateQueries({ queryKey: ['cycle-summary', cycleId] });
    },
  });
}

export function useNudgeMutation() {
  return useMutation<void, Error, { cycleId: string; message?: string }>({
    mutationFn: ({ cycleId, message }) =>
      apiClient.fetch<void>(`/api/v1/cycles/${cycleId}/nudge`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
  });
}

// ─── Manager workspace ──────────────────────────────────

export interface MyTeamEmployee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  level: string;
  location: string | null;
  jobFamily: string | null;
  hireDate: string;
  currentSalary: number;
  currency: string;
  performanceRating: number | null;
  compaRatio: number | null;
}

export interface MyTeamRecommendation {
  id: string;
  recType: string;
  currentValue: number;
  proposedValue: number;
  justification: string | null;
  status: string;
  approvedAt: string | null;
}

export interface MyTeamMember {
  employee: MyTeamEmployee;
  recommendation: MyTeamRecommendation | null;
  allRecommendations: Array<{
    id: string;
    recType: string;
    currentValue: number;
    proposedValue: number;
    status: string;
  }>;
}

export interface MyTeamResponse {
  cycle: { id: string; name: string; status: CycleStatus; currency: string };
  managerEmployeeId: string;
  managerName: string;
  budget: {
    department: string;
    allocated: number;
    spent: number;
    remaining: number;
  } | null;
  teamSize: number;
  members: MyTeamMember[];
}

export function useMyTeam(cycleId: string | null) {
  return useQuery<MyTeamResponse>({
    queryKey: ['cycle-my-team', cycleId],
    queryFn: () => apiClient.fetch<MyTeamResponse>(`/api/v1/cycles/${cycleId}/my-team`),
    enabled: !!cycleId,
  });
}

export interface SaveTeamRecommendationsInput {
  cycleId: string;
  recommendations: Array<{
    employeeId: string;
    recType: 'MERIT_INCREASE';
    currentValue: number;
    proposedValue: number;
    justification?: string | null;
  }>;
}

export function useSaveTeamRecommendationsMutation() {
  const qc = useQueryClient();
  return useMutation<
    { cycleId: string; created: number; updated: number; total: number },
    Error,
    SaveTeamRecommendationsInput
  >({
    mutationFn: ({ cycleId, recommendations }) =>
      apiClient.fetch(`/api/v1/cycles/${cycleId}/recommendations`, {
        method: 'POST',
        body: JSON.stringify({ recommendations }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['cycle-my-team', vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['recommendations', vars.cycleId] });
    },
  });
}

// ─── Eligibility ─────────────────────────────────────────

export interface EligibilityRules {
  minTenureDays?: number;
  minPerformanceRating?: number;
  departments?: string[];
  locations?: string[];
  levels?: string[];
  excludeTerminated?: boolean;
  notes?: string;
}

export interface EligibilitySampleRow {
  id: string;
  employeeCode: string;
  name: string;
  department: string;
  level: string;
  location: string | null;
  hireDate: string;
  performanceRating: number | null;
  baseSalary: number;
  currency: string;
}

export interface EligibilityPreview {
  cycleId: string;
  rules: Required<Pick<EligibilityRules, 'departments' | 'locations' | 'levels'>> & {
    minTenureDays?: number;
    minPerformanceRating?: number;
    excludeTerminated: boolean;
    notes?: string;
  };
  eligibleCount: number;
  totalCount: number;
  coveragePct: number;
  sample: EligibilitySampleRow[];
}

export function useEligibilityPreview(cycleId: string | null, enabled = true) {
  return useQuery<EligibilityPreview>({
    queryKey: ['cycle-eligibility-preview', cycleId],
    queryFn: () =>
      apiClient.fetch<EligibilityPreview>(`/api/v1/cycles/${cycleId}/eligibility-preview`),
    enabled: !!cycleId && enabled,
  });
}

export function useUpdateEligibilityMutation() {
  const qc = useQueryClient();
  return useMutation<
    { cycleId: string; eligibility: EligibilityRules; status: string },
    Error,
    { cycleId: string; rules: EligibilityRules }
  >({
    mutationFn: ({ cycleId, rules }) =>
      apiClient.fetch<{ cycleId: string; eligibility: EligibilityRules; status: string }>(
        `/api/v1/cycles/${cycleId}/eligibility`,
        { method: 'PUT', body: JSON.stringify(rules) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['cycle-eligibility-preview', vars.cycleId] });
      void qc.invalidateQueries({ queryKey: ['cycle', vars.cycleId] });
    },
  });
}
