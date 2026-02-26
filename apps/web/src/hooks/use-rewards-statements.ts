'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export type StatementStatus = 'DRAFT' | 'GENERATED' | 'SENT' | 'FAILED';

export interface RewardsStatement {
  id: string;
  tenantId: string;
  employeeId: string;
  year: number;
  generatedAt: string;
  pdfUrl: string | null;
  emailSentAt: string | null;
  emailTo: string | null;
  status: StatementStatus;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  employee?: {
    firstName: string;
    lastName: string;
    department: string;
    email: string;
  };
}

export interface StatementListResponse {
  data: RewardsStatement[];
  total: number;
  page: number;
  limit: number;
}

export interface BulkGenerateResult {
  total: number;
  generated: number;
  results: Array<{
    employeeId: string;
    status: string;
    statementId?: string;
    error?: string;
  }>;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useStatementList(filters?: {
  status?: string;
  employeeId?: string;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.employeeId) params.set('employeeId', filters.employeeId);
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 20));

  return useQuery<StatementListResponse>({
    queryKey: ['rewards-statements', filters],
    queryFn: () => apiClient.fetch<StatementListResponse>(`/api/v1/rewards-statements?${params}`),
  });
}

export function useMyStatements() {
  return useQuery<RewardsStatement[]>({
    queryKey: ['my-rewards-statements'],
    queryFn: () => apiClient.fetch<RewardsStatement[]>('/api/v1/rewards-statements/my'),
  });
}

export function useGenerateStatementMutation() {
  const qc = useQueryClient();
  return useMutation<RewardsStatement, Error, { employeeId: string; year?: number }>({
    mutationFn: (body) =>
      apiClient.fetch<RewardsStatement>('/api/v1/rewards-statements/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rewards-statements'] });
      void qc.invalidateQueries({ queryKey: ['my-rewards-statements'] });
    },
  });
}

export function useBulkGenerateMutation() {
  const qc = useQueryClient();
  return useMutation<BulkGenerateResult, Error, { department?: string; year?: number }>({
    mutationFn: (body) =>
      apiClient.fetch<BulkGenerateResult>('/api/v1/rewards-statements/generate-bulk', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rewards-statements'] });
    },
  });
}

export function useSendStatementEmailMutation() {
  const qc = useQueryClient();
  return useMutation<RewardsStatement, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<RewardsStatement>(`/api/v1/rewards-statements/${id}/send`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rewards-statements'] });
    },
  });
}

export function getStatementDownloadUrl(id: string): string {
  const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';
  return `${API_BASE_URL}/api/v1/rewards-statements/${id}/download`;
}
