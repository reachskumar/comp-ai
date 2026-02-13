"use client";

import { useCallback, useState } from "react";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

export type LetterType = "offer" | "raise" | "promotion" | "bonus" | "total_comp_summary";
export type LetterStatus = "DRAFT" | "GENERATING" | "REVIEW" | "APPROVED" | "SENT" | "FAILED";

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

export interface BatchResult {
  batchId: string;
  total: number;
  results: Array<{ employeeId: string; letterId?: string; status: string; error?: string }>;
}

export interface UpdateLetterInput {
  subject?: string;
  content?: string;
  status?: "DRAFT" | "REVIEW" | "APPROVED" | "SENT";
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
      const result = await apiClient.fetch<CompensationLetter>("/api/v1/letters/generate", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setCurrentLetter(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate letter";
      setError(msg);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const generateBatch = useCallback(async (input: GenerateBatchInput) => {
    setIsGenerating(true);
    setError(null);
    try {
      const result = await apiClient.fetch<BatchResult>("/api/v1/letters/generate-batch", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate batch";
      setError(msg);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const fetchLetters = useCallback(async (params?: {
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
      if (params?.letterType) query.set("letterType", params.letterType);
      if (params?.status) query.set("status", params.status);
      if (params?.employeeId) query.set("employeeId", params.employeeId);
      if (params?.batchId) query.set("batchId", params.batchId);
      if (params?.search) query.set("search", params.search);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      const result = await apiClient.fetch<LetterListResponse>(`/api/v1/letters${qs ? `?${qs}` : ""}`);
      setLetters(result.items);
      setPagination({ total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch letters";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchLetter = useCallback(async (letterId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiClient.fetch<CompensationLetter>(`/api/v1/letters/${letterId}`);
      setCurrentLetter(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to fetch letter";
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
        method: "PUT",
        body: JSON.stringify(input),
      });
      setCurrentLetter(result);
      // Update in list too
      setLetters((prev) => prev.map((l) => (l.id === letterId ? result : l)));
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update letter";
      setError(msg);
      throw err;
    }
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
    generateBatch,
    fetchLetters,
    fetchLetter,
    updateLetter,
    clearError,
    clearCurrentLetter,
  };
}

