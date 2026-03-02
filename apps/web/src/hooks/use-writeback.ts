'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export type WriteBackBatchStatus =
  | 'PENDING_REVIEW'
  | 'PREVIEWED'
  | 'DRY_RUN_OK'
  | 'DRY_RUN_FAILED'
  | 'APPLYING'
  | 'APPLIED'
  | 'PARTIALLY_APPLIED'
  | 'FAILED';

export type WriteBackRecordStatus =
  | 'PENDING'
  | 'VALIDATED'
  | 'VALIDATION_FAILED'
  | 'APPLIED'
  | 'FAILED'
  | 'SKIPPED';

export interface WriteBackRecord {
  id: string;
  batchId: string;
  recommendationId: string;
  employeeId: string;
  fieldName: string;
  previousValue: string;
  newValue: string;
  status: WriteBackRecordStatus;
  errorMessage: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface WriteBackBatch {
  id: string;
  tenantId: string;
  cycleId: string | null;
  connectorId: string;
  status: WriteBackBatchStatus;
  totalRecords: number;
  appliedRecords: number;
  failedRecords: number;
  idempotencyKey: string;
  createdBy: string;
  appliedBy: string | null;
  appliedAt: string | null;
  rollbackSql: string | null;
  createdAt: string;
  updatedAt: string;
  records?: WriteBackRecord[];
}

export interface PreviewResult {
  batchId: string;
  statements: { recordId: string; sql: string; params: unknown[] }[];
}

export interface DryRunResult {
  batchId: string;
  success: boolean;
  results: {
    recordId: string;
    employeeId: string;
    fieldName: string;
    valid: boolean;
    error?: string;
  }[];
}

export interface ApplyResult {
  jobId: string;
  batchId: string;
  status: 'QUEUED';
  message: string;
}

// ─── TanStack Query Hooks ───────────────────────────────

const BASE = '/api/v1/compport-bridge/write-back';

export function useBatchList(cycleId?: string) {
  const params = cycleId ? `?cycleId=${cycleId}` : '';
  return useQuery<WriteBackBatch[]>({
    queryKey: ['write-back-batches', cycleId],
    queryFn: () => apiClient.fetch<WriteBackBatch[]>(`${BASE}/batches${params}`),
  });
}

export function useBatchDetail(batchId: string | null) {
  return useQuery<WriteBackBatch>({
    queryKey: ['write-back-batch', batchId],
    queryFn: () => apiClient.fetch<WriteBackBatch>(`${BASE}/batches/${batchId}`),
    enabled: !!batchId,
  });
}

export function usePreviewMutation() {
  const qc = useQueryClient();
  return useMutation<PreviewResult, Error, string>({
    mutationFn: (batchId) =>
      apiClient.fetch<PreviewResult>(`${BASE}/batches/${batchId}/preview`, {
        method: 'POST',
      }),
    onSuccess: (_data, batchId) => {
      void qc.invalidateQueries({ queryKey: ['write-back-batch', batchId] });
    },
  });
}

export function useDryRunMutation() {
  const qc = useQueryClient();
  return useMutation<DryRunResult, Error, string>({
    mutationFn: (batchId) =>
      apiClient.fetch<DryRunResult>(`${BASE}/batches/${batchId}/dry-run`, {
        method: 'POST',
      }),
    onSuccess: (_data, batchId) => {
      void qc.invalidateQueries({ queryKey: ['write-back-batch', batchId] });
    },
  });
}

export function useApplyMutation() {
  const qc = useQueryClient();
  return useMutation<
    ApplyResult,
    Error,
    { batchId: string; confirmPhrase: string; selectedRecordIds?: string[] }
  >({
    mutationFn: ({ batchId, ...body }) =>
      apiClient.fetch<ApplyResult>(`${BASE}/batches/${batchId}/apply`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['write-back-batch', vars.batchId] });
      void qc.invalidateQueries({ queryKey: ['write-back-batches'] });
    },
  });
}
