"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

// ─── Types ───────────────────────────────────────────────

export type BenefitPlanType =
  | "MEDICAL"
  | "DENTAL"
  | "VISION"
  | "LIFE"
  | "DISABILITY";

export type BenefitTier =
  | "EMPLOYEE"
  | "EMPLOYEE_SPOUSE"
  | "EMPLOYEE_CHILDREN"
  | "FAMILY";

export type EnrollmentStatus = "ACTIVE" | "PENDING" | "TERMINATED" | "WAIVED";

export type DependentRelationship = "SPOUSE" | "CHILD" | "DOMESTIC_PARTNER";

export type LifeEventType =
  | "MARRIAGE"
  | "BIRTH"
  | "ADOPTION"
  | "DIVORCE"
  | "LOSS_OF_COVERAGE"
  | "ADDRESS_CHANGE";

export type EnrollmentWindowStatus = "UPCOMING" | "OPEN" | "CLOSED";

export interface BenefitPlan {
  id: string;
  tenantId: string;
  planType: BenefitPlanType;
  name: string;
  carrier: string;
  description?: string;
  network?: string;
  premiums: Record<string, number>;
  deductibles: Record<string, number>;
  outOfPocketMax: Record<string, number>;
  copays: Record<string, number>;
  coverageDetails: Record<string, unknown>;
  effectiveDate: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  premiumBreakdown?: PremiumBreakdown[];
}

export interface PremiumBreakdown {
  tier: string;
  totalPremium: number;
  employeePremium: number;
  employerPremium: number;
  employerContributionPct: number;
}

export interface BenefitEnrollment {
  id: string;
  tenantId: string;
  employeeId: string;
  planId: string;
  tier: BenefitTier;
  status: EnrollmentStatus;
  effectiveDate: string;
  endDate?: string;
  employeePremium: number;
  employerPremium: number;
  electedAt: string;
  plan?: BenefitPlan;
  dependents?: BenefitDependent[];
  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentListResponse {
  data: BenefitEnrollment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BenefitDependent {
  id: string;
  employeeId: string;
  enrollmentId?: string;
  firstName: string;
  lastName: string;
  relationship: DependentRelationship;
  dateOfBirth: string;
  ssnMasked?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LifeEvent {
  id: string;
  tenantId: string;
  employeeId: string;
  eventType: LifeEventType;
  eventDate: string;
  qualifyingDate: string;
  description?: string;
  status: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface EnrollmentWindow {
  id: string;
  tenantId: string;
  name: string;
  planYear: number;
  startDate: string;
  endDate: string;
  status: EnrollmentWindowStatus;
  createdAt: string;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useBenefitPlans(planType?: BenefitPlanType) {
  const params = new URLSearchParams();
  if (planType) params.set("planType", planType);
  params.set("isActive", "true");

  return useQuery<BenefitPlan[]>({
    queryKey: ["benefit-plans", planType],
    queryFn: () =>
      apiClient.fetch<BenefitPlan[]>(
        `/api/v1/benefits/plans?${params}`
      ),
  });
}

export function usePlanDetail(planId: string | null) {
  return useQuery<BenefitPlan>({
    queryKey: ["benefit-plan", planId],
    queryFn: () =>
      apiClient.fetch<BenefitPlan>(`/api/v1/benefits/plans/${planId}`),
    enabled: !!planId,
  });
}

export function useEnrollments(
  filters?: { employeeId?: string; status?: EnrollmentStatus; page?: number; limit?: number }
) {
  const params = new URLSearchParams();
  if (filters?.employeeId) params.set("employeeId", filters.employeeId);
  if (filters?.status) params.set("status", filters.status);
  params.set("page", String(filters?.page ?? 1));
  params.set("limit", String(filters?.limit ?? 20));

  return useQuery<EnrollmentListResponse>({
    queryKey: ["benefit-enrollments", filters],
    queryFn: () =>
      apiClient.fetch<EnrollmentListResponse>(
        `/api/v1/benefits/enrollments?${params}`
      ),
  });
}

export function useDependents(employeeId: string | null) {
  return useQuery<BenefitDependent[]>({
    queryKey: ["benefit-dependents", employeeId],
    queryFn: () =>
      apiClient.fetch<BenefitDependent[]>(
        `/api/v1/benefits/employees/${employeeId}/dependents`
      ),
    enabled: !!employeeId,
  });
}

export function useLifeEvents(employeeId?: string) {
  const params = employeeId ? `?employeeId=${employeeId}` : "";
  return useQuery<LifeEvent[]>({
    queryKey: ["life-events", employeeId],
    queryFn: () =>
      apiClient.fetch<LifeEvent[]>(`/api/v1/benefits/life-events${params}`),
  });
}

export function useEnrollmentWindows() {
  return useQuery<EnrollmentWindow[]>({
    queryKey: ["enrollment-windows"],
    queryFn: () =>
      apiClient.fetch<EnrollmentWindow[]>(
        `/api/v1/benefits/enrollment-windows`
      ),
  });
}

// ─── Mutations ──────────────────────────────────────────

export function useCreateEnrollmentMutation() {
  const qc = useQueryClient();
  return useMutation<
    BenefitEnrollment,
    Error,
    {
      employeeId: string;
      planId: string;
      tier: BenefitTier;
      effectiveDate: string;
      endDate?: string;
      dependentIds?: string[];
    }
  >({
    mutationFn: (body) =>
      apiClient.fetch<BenefitEnrollment>("/api/v1/benefits/enrollments", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["benefit-enrollments"] });
    },
  });
}

export function useCreateDependentMutation() {
  const qc = useQueryClient();
  return useMutation<
    BenefitDependent,
    Error,
    {
      employeeId: string;
      firstName: string;
      lastName: string;
      relationship: DependentRelationship;
      dateOfBirth: string;
      ssn?: string;
    }
  >({
    mutationFn: (body) =>
      apiClient.fetch<BenefitDependent>("/api/v1/benefits/dependents", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["benefit-dependents", vars.employeeId],
      });
    },
  });
}

export function useFileLifeEventMutation() {
  const qc = useQueryClient();
  return useMutation<
    LifeEvent,
    Error,
    {
      employeeId: string;
      eventType: LifeEventType;
      eventDate: string;
      qualifyingDate: string;
      description?: string;
    }
  >({
    mutationFn: (body) =>
      apiClient.fetch<LifeEvent>("/api/v1/benefits/life-events", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["life-events"] });
    },
  });
}

export function useUpdateEnrollmentStatusMutation() {
  const qc = useQueryClient();
  return useMutation<
    BenefitEnrollment,
    Error,
    { enrollmentId: string; status: EnrollmentStatus }
  >({
    mutationFn: ({ enrollmentId, status }) =>
      apiClient.fetch<BenefitEnrollment>(
        `/api/v1/benefits/enrollments/${enrollmentId}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["benefit-enrollments"] });
    },
  });
}

