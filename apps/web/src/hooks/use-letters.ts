'use client';

import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export type LetterType = 'offer' | 'raise' | 'promotion' | 'bonus' | 'total_comp_summary';
export type LetterStatus = 'DRAFT' | 'GENERATING' | 'REVIEW' | 'APPROVED' | 'SENT' | 'FAILED';

export interface GenerateLetterInput {
  employeeId: string;
  letterType: LetterType;
  newSalary?: number;
  salaryIncrease?: number;
  salaryIncreasePercent?: number;
  bonusAmount?: number;
  newTitle?: string;
  newLevel?: string;
  effectiveDate?: string;
  totalComp?: number;
  benefits?: string[];
  additionalNotes?: string;
  tone?: string;
  language?: string;
  customInstructions?: string;
}

export interface GenerateBatchInput {
  employeeIds: string[];
  letterType: LetterType;
  salaryIncreasePercent?: number;
  bonusAmount?: number;
  effectiveDate?: string;
  tone?: string;
  language?: string;
  additionalNotes?: string;
}

export interface LetterEmployee {
  firstName: string;
  lastName: string;
  department: string;
  email: string;
}

export interface CompensationLetter {
  id: string;
  tenantId: string;
  userId: string;
  employeeId: string;
  letterType: string;
  status: LetterStatus;
  subject: string;
  content: string;
  compData: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tone: string;
  language: string;
  pdfUrl: string | null;
  batchId: string | null;
  generatedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  employee: LetterEmployee;
}

export interface LetterListResponse {
  items: CompensationLetter[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BatchEnqueueResult {
  batchId: string;
  jobId: string | number | null;
  total: number;
  status: 'queued';
}

export interface BatchProgress {
  batchId: string;
  total: number;
  seen: number;
  succeeded: number;
  failed: number;
  inFlight: number;
  byStatus: Record<string, number>;
  jobState: string;
  progress: number;
  done: boolean;
}

export interface UpdateLetterInput {
  subject?: string;
  content?: string;
  status?: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'SENT';
}

export interface ApprovalChainStep {
  role: string;
  label: string;
}

export interface ApprovalDecision {
  stepIndex: number;
  role: string;
  decidedBy: string;
  decidedByName: string;
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
  decidedAt: string;
}

export interface ApprovalState {
  chain: ApprovalChainStep[];
  currentStep: number;
  decisions: ApprovalDecision[];
  rejected: boolean;
  submittedBy?: string;
  submittedAt?: string;
}

export function readApproval(letter: CompensationLetter): ApprovalState | null {
  const meta = (letter as { metadata?: unknown }).metadata;
  if (!meta || typeof meta !== 'object') return null;
  const approval = (meta as Record<string, unknown>)['approval'];
  if (!approval || typeof approval !== 'object') return null;
  return approval as ApprovalState;
}

// ─── Hook ────────────────────────────────────────────────

export function useLetters() {
  const [letters, setLetters] = useState<CompensationLetter[]>([]);
  const [currentLetter, setCurrentLetter] = useState<CompensationLetter | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });

  const generateLetter = useCallback(async (input: GenerateLetterInput) => {
    setIsGenerating(true);
    setError(null);
    try {
      const result = await apiClient.fetch<CompensationLetter>('/api/v1/letters/generate', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setCurrentLetter(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate letter';
      setError(msg);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const enqueueBatch = useCallback(async (input: GenerateBatchInput) => {
    setError(null);
    try {
      return await apiClient.fetch<BatchEnqueueResult>('/api/v1/letters/generate-batch', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to enqueue batch';
      setError(msg);
      throw err;
    }
  }, []);

  const fetchBatchProgress = useCallback(async (batchId: string) => {
    return apiClient.fetch<BatchProgress>(
      `/api/v1/letters/batches/${encodeURIComponent(batchId)}/progress`,
    );
  }, []);

  const fetchLetters = useCallback(
    async (params?: {
      letterType?: LetterType;
      status?: string;
      employeeId?: string;
      batchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    }) => {
      setIsLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (params?.letterType) query.set('letterType', params.letterType);
        if (params?.status) query.set('status', params.status);
        if (params?.employeeId) query.set('employeeId', params.employeeId);
        if (params?.batchId) query.set('batchId', params.batchId);
        if (params?.search) query.set('search', params.search);
        if (params?.page) query.set('page', String(params.page));
        if (params?.limit) query.set('limit', String(params.limit));
        const qs = query.toString();
        const result = await apiClient.fetch<LetterListResponse>(
          `/api/v1/letters${qs ? `?${qs}` : ''}`,
        );
        setLetters(result.items);
        setPagination({
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch letters';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const fetchLetter = useCallback(async (letterId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiClient.fetch<CompensationLetter>(`/api/v1/letters/${letterId}`);
      setCurrentLetter(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch letter';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateLetter = useCallback(async (letterId: string, input: UpdateLetterInput) => {
    setError(null);
    try {
      const result = await apiClient.fetch<CompensationLetter>(`/api/v1/letters/${letterId}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      setCurrentLetter(result);
      // Update in list too
      setLetters((prev) => prev.map((l) => (l.id === letterId ? result : l)));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update letter';
      setError(msg);
      throw err;
    }
  }, []);

  const submitForApproval = useCallback(async (letterId: string) => {
    setError(null);
    const result = await apiClient.fetch<CompensationLetter>(`/api/v1/letters/${letterId}/submit`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setCurrentLetter(result);
    setLetters((prev) => prev.map((l) => (l.id === letterId ? result : l)));
    return result;
  }, []);

  const approveCurrentStep = useCallback(async (letterId: string, comment?: string) => {
    setError(null);
    const result = await apiClient.fetch<CompensationLetter>(
      `/api/v1/letters/${letterId}/approve`,
      { method: 'POST', body: JSON.stringify({ comment }) },
    );
    setCurrentLetter(result);
    setLetters((prev) => prev.map((l) => (l.id === letterId ? result : l)));
    return result;
  }, []);

  const rejectCurrentStep = useCallback(async (letterId: string, reason?: string) => {
    setError(null);
    const result = await apiClient.fetch<CompensationLetter>(`/api/v1/letters/${letterId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setCurrentLetter(result);
    setLetters((prev) => prev.map((l) => (l.id === letterId ? result : l)));
    return result;
  }, []);

  const sendLetter = useCallback(async (letterId: string) => {
    setError(null);
    const result = await apiClient.fetch<CompensationLetter>(`/api/v1/letters/${letterId}/send`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setCurrentLetter(result);
    setLetters((prev) => prev.map((l) => (l.id === letterId ? result : l)));
    return result;
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const clearCurrentLetter = useCallback(() => setCurrentLetter(null), []);

  return {
    letters,
    currentLetter,
    isGenerating,
    isLoading,
    error,
    pagination,
    generateLetter,
    enqueueBatch,
    fetchBatchProgress,
    fetchLetters,
    fetchLetter,
    updateLetter,
    submitForApproval,
    approveCurrentStep,
    rejectCurrentStep,
    sendLetter,
    clearError,
    clearCurrentLetter,
  };
}

export function readEmailMeta(letter: CompensationLetter): {
  to: string;
  sentAt: string;
  acknowledgedAt?: string;
} | null {
  const meta = (letter as { metadata?: unknown }).metadata;
  if (!meta || typeof meta !== 'object') return null;
  const e = (meta as Record<string, unknown>)['email'];
  if (!e || typeof e !== 'object') return null;
  const obj = e as Record<string, unknown>;
  if (typeof obj['to'] !== 'string' || typeof obj['sentAt'] !== 'string') return null;
  return {
    to: obj['to'],
    sentAt: obj['sentAt'],
    acknowledgedAt: typeof obj['acknowledgedAt'] === 'string' ? obj['acknowledgedAt'] : undefined,
  };
}
