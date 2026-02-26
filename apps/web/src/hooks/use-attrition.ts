'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface AttritionScore {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  level: string;
  baseSalary: number;
  compaRatio: number | null;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors: Record<string, unknown>;
  recommendation: string | null;
  calculatedAt: string;
}

export interface AttritionEmployeeDetail extends AttritionScore {
  performanceRating: number | null;
  hireDate: string;
  employee: {
    firstName: string;
    lastName: string;
    department: string;
    level: string;
  };
}

export interface AttritionDashboard {
  totalEmployees: number;
  avgRiskScore: number;
  distribution: {
    LOW: number;
    MEDIUM: number;
    HIGH: number;
    CRITICAL: number;
  };
  departmentBreakdown: Array<{
    department: string;
    avgScore: number;
    total: number;
    high: number;
    critical: number;
  }>;
}

export interface AttritionRun {
  id: string;
  tenantId: string;
  triggeredBy: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalEmployees: number;
  highRiskCount: number;
  criticalCount: number;
  avgRiskScore: number;
  completedAt: string | null;
  createdAt: string;
}

export interface AnalyzeResult {
  runId: string;
  totalEmployees: number;
  highRiskCount: number;
  criticalCount: number;
  avgRiskScore: number;
}

// ─── Hooks ───────────────────────────────────────────────

export function useAttritionDashboard() {
  return useQuery<AttritionDashboard>({
    queryKey: ['attrition-dashboard'],
    queryFn: () => apiClient.fetch<AttritionDashboard>('/api/v1/attrition/dashboard'),
  });
}

export function useAttritionScores(filters?: { riskLevel?: string; department?: string }) {
  const params = new URLSearchParams();
  if (filters?.riskLevel) params.set('riskLevel', filters.riskLevel);
  if (filters?.department) params.set('department', filters.department);
  const qs = params.toString();

  return useQuery<AttritionScore[]>({
    queryKey: ['attrition-scores', filters],
    queryFn: () =>
      apiClient.fetch<AttritionScore[]>(`/api/v1/attrition/scores${qs ? `?${qs}` : ''}`),
  });
}

export function useAttritionEmployeeScore(employeeId: string | null) {
  return useQuery<AttritionEmployeeDetail>({
    queryKey: ['attrition-employee', employeeId],
    queryFn: () =>
      apiClient.fetch<AttritionEmployeeDetail>(`/api/v1/attrition/scores/${employeeId}`),
    enabled: !!employeeId,
  });
}

export function useAttritionRuns() {
  return useQuery<AttritionRun[]>({
    queryKey: ['attrition-runs'],
    queryFn: () => apiClient.fetch<AttritionRun[]>('/api/v1/attrition/runs'),
  });
}

export function useRunAttritionAnalysis() {
  const qc = useQueryClient();
  return useMutation<AnalyzeResult, Error>({
    mutationFn: () =>
      apiClient.fetch<AnalyzeResult>('/api/v1/attrition/analyze', {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attrition-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['attrition-scores'] });
      void qc.invalidateQueries({ queryKey: ['attrition-runs'] });
    },
  });
}
