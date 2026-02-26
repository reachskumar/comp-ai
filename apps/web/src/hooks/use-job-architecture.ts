'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface JobFamily {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { jobLevels: number };
  jobLevels?: JobLevel[];
}

export interface JobLevel {
  id: string;
  tenantId: string;
  jobFamilyId: string;
  name: string;
  code: string;
  grade: number;
  description: string | null;
  minSalary: number;
  midSalary: number;
  maxSalary: number;
  currency: string;
  competencies: string[];
  nextLevelId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  jobFamily?: { id: string; name: string; code: string };
  nextLevel?: { id: string; name: string; code: string; grade: number } | null;
  previousLevel?: { id: string; name: string; code: string; grade: number } | null;
  _count?: { employees: number };
  employees?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    department: string;
    email: string;
    baseSalary: number;
  }>;
}

export interface CareerLadder {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  tracks: Array<{ trackName: string; levels: string[] }>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobArchitectureSummary {
  families: number;
  levels: number;
  assignedEmployees: number;
  unassignedEmployees: number;
  totalEmployees: number;
}

interface ListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Hooks ───────────────────────────────────────────────

export function useJobArchitectureSummary() {
  return useQuery<JobArchitectureSummary>({
    queryKey: ['job-architecture', 'summary'],
    queryFn: () => apiClient.fetch<JobArchitectureSummary>('/api/v1/job-architecture/summary'),
  });
}

// ─── Job Families ────────────────────────────────────────

export function useJobFamilies(page = 1, limit = 50) {
  return useQuery<ListResponse<JobFamily>>({
    queryKey: ['job-families', page, limit],
    queryFn: () =>
      apiClient.fetch<ListResponse<JobFamily>>(
        `/api/v1/job-architecture/families?page=${page}&limit=${limit}`,
      ),
  });
}

export function useJobFamily(id: string | null) {
  return useQuery<JobFamily>({
    queryKey: ['job-family', id],
    queryFn: () => apiClient.fetch<JobFamily>(`/api/v1/job-architecture/families/${id}`),
    enabled: !!id,
  });
}

export function useCreateJobFamilyMutation() {
  const qc = useQueryClient();
  return useMutation<JobFamily, Error, { name: string; code: string; description?: string }>({
    mutationFn: (body) =>
      apiClient.fetch<JobFamily>('/api/v1/job-architecture/families', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-families'] });
      void qc.invalidateQueries({ queryKey: ['job-architecture', 'summary'] });
    },
  });
}

export function useDeleteJobFamilyMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<void>(`/api/v1/job-architecture/families/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-families'] });
      void qc.invalidateQueries({ queryKey: ['job-architecture', 'summary'] });
    },
  });
}

// ─── Job Levels ──────────────────────────────────────────

export function useJobLevels(filters?: { jobFamilyId?: string; page?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.jobFamilyId) params.set('jobFamilyId', filters.jobFamilyId);
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 100));

  return useQuery<ListResponse<JobLevel>>({
    queryKey: ['job-levels', filters],
    queryFn: () =>
      apiClient.fetch<ListResponse<JobLevel>>(`/api/v1/job-architecture/levels?${params}`),
  });
}

export function useJobLevel(id: string | null) {
  return useQuery<JobLevel>({
    queryKey: ['job-level', id],
    queryFn: () => apiClient.fetch<JobLevel>(`/api/v1/job-architecture/levels/${id}`),
    enabled: !!id,
  });
}

export function useCreateJobLevelMutation() {
  const qc = useQueryClient();
  return useMutation<
    JobLevel,
    Error,
    {
      familyId: string;
      name: string;
      code: string;
      grade: number;
      description?: string;
      minSalary: number;
      midSalary: number;
      maxSalary: number;
      currency?: string;
      competencies?: string[];
      nextLevelId?: string;
    }
  >({
    mutationFn: ({ familyId, ...body }) =>
      apiClient.fetch<JobLevel>(`/api/v1/job-architecture/families/${familyId}/levels`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-levels'] });
      void qc.invalidateQueries({ queryKey: ['job-families'] });
      void qc.invalidateQueries({ queryKey: ['job-architecture', 'summary'] });
    },
  });
}

export function useDeleteJobLevelMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<void>(`/api/v1/job-architecture/levels/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-levels'] });
      void qc.invalidateQueries({ queryKey: ['job-families'] });
      void qc.invalidateQueries({ queryKey: ['job-architecture', 'summary'] });
    },
  });
}

export function useAssignEmployeesMutation() {
  const qc = useQueryClient();
  return useMutation<
    { assigned: number; levelId: string },
    Error,
    { levelId: string; employeeIds: string[] }
  >({
    mutationFn: ({ levelId, employeeIds }) =>
      apiClient.fetch(`/api/v1/job-architecture/levels/${levelId}/assign-employees`, {
        method: 'POST',
        body: JSON.stringify({ employeeIds }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-levels'] });
      void qc.invalidateQueries({ queryKey: ['job-architecture', 'summary'] });
    },
  });
}

export function useAutoAssignMutation() {
  const qc = useQueryClient();
  return useMutation<{ assigned: number; totalLevels: number }, Error, void>({
    mutationFn: () => apiClient.fetch('/api/v1/job-architecture/auto-assign', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-levels'] });
      void qc.invalidateQueries({ queryKey: ['job-architecture', 'summary'] });
    },
  });
}

// ─── Career Ladders ──────────────────────────────────────

export function useCareerLadders(page = 1, limit = 20) {
  return useQuery<ListResponse<CareerLadder>>({
    queryKey: ['career-ladders', page, limit],
    queryFn: () =>
      apiClient.fetch<ListResponse<CareerLadder>>(
        `/api/v1/job-architecture/career-ladders?page=${page}&limit=${limit}`,
      ),
  });
}

export function useCareerLadder(id: string | null) {
  return useQuery<CareerLadder>({
    queryKey: ['career-ladder', id],
    queryFn: () => apiClient.fetch<CareerLadder>(`/api/v1/job-architecture/career-ladders/${id}`),
    enabled: !!id,
  });
}

export function useCreateCareerLadderMutation() {
  const qc = useQueryClient();
  return useMutation<
    CareerLadder,
    Error,
    { name: string; description?: string; tracks: Array<{ trackName: string; levels: string[] }> }
  >({
    mutationFn: (body) =>
      apiClient.fetch<CareerLadder>('/api/v1/job-architecture/career-ladders', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['career-ladders'] });
    },
  });
}

export function useDeleteCareerLadderMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<void>(`/api/v1/job-architecture/career-ladders/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['career-ladders'] });
    },
  });
}
