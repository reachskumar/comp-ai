'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface EmployeeProfile {
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    department: string;
    level: string;
    jobFamily: string | null;
    hireDate: string;
    performanceRating: number | null;
    compaRatio: number | null;
    currency: string;
  };
  compensation: {
    baseSalary: number;
    bonus: number;
    benefitsValue: number;
    equityValue: number;
    totalComp: number;
  };
  bandPosition: {
    bandId: string;
    jobFamily: string;
    level: string;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    currentSalary: number;
  } | null;
}

export interface CompHistoryEntry {
  id: string;
  date: string;
  type: 'cycle' | 'adhoc';
  label: string;
  previousValue: number;
  newValue: number;
  changePercent: number;
}

export interface EquityGrantPortal {
  id: string;
  planName: string;
  grantType: string;
  grantDate: string;
  totalShares: number;
  vestedShares: number;
  unvestedShares: number;
  grantPrice: number;
  currentPrice: number;
  currentValue: number;
  gain: number;
  status: string;
  vestingEvents: Array<{
    id: string;
    vestDate: string;
    sharesVested: number;
    cumulativeVested: number;
    status: string;
  }>;
}

export interface EquityPortalData {
  grants: EquityGrantPortal[];
  summary: {
    totalGrants: number;
    totalVested: number;
    totalUnvested: number;
    totalValue: number;
    totalGain: number;
  };
}

export interface BenefitEnrollmentPortal {
  id: string;
  planName: string;
  planType: string;
  carrier: string;
  tier: string;
  employeePremium: number;
  employerPremium: number;
  effectiveDate: string;
  coverageDetails: Record<string, unknown>;
  deductibles: Record<string, number>;
  copays: Record<string, number>;
}

export interface CareerPathData {
  currentLevel: string;
  jobFamily: string | null;
  performanceRating: number | null;
  compaRatio: number | null;
  hireDate: string;
  careerLadder: Array<{ level: string; p50: number; isCurrent: boolean }>;
  nextLevel: { level: string; p50Midpoint: number } | null;
}

export interface PortalDocuments {
  letters: Array<{
    id: string;
    type: 'letter';
    letterType: string;
    subject: string;
    status: string;
    pdfUrl: string | null;
    date: string;
  }>;
  statements: Array<{
    id: string;
    type: 'statement';
    year: number;
    status: string;
    pdfUrl: string | null;
    date: string;
  }>;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useEmployeeProfile() {
  return useQuery<EmployeeProfile>({
    queryKey: ['employee-portal', 'me'],
    queryFn: () => apiClient.fetch('/api/v1/employee-portal/me'),
  });
}

export function useCompHistory() {
  return useQuery<CompHistoryEntry[]>({
    queryKey: ['employee-portal', 'comp-history'],
    queryFn: () => apiClient.fetch('/api/v1/employee-portal/me/comp-history'),
  });
}

export function usePortalEquity() {
  return useQuery<EquityPortalData>({
    queryKey: ['employee-portal', 'equity'],
    queryFn: () => apiClient.fetch('/api/v1/employee-portal/me/equity'),
  });
}

export function usePortalBenefits() {
  return useQuery<BenefitEnrollmentPortal[]>({
    queryKey: ['employee-portal', 'benefits'],
    queryFn: () => apiClient.fetch('/api/v1/employee-portal/me/benefits'),
  });
}

export function useCareerPath() {
  return useQuery<CareerPathData>({
    queryKey: ['employee-portal', 'career-path'],
    queryFn: () => apiClient.fetch('/api/v1/employee-portal/me/career-path'),
  });
}

export function usePortalDocuments() {
  return useQuery<PortalDocuments>({
    queryKey: ['employee-portal', 'documents'],
    queryFn: () => apiClient.fetch('/api/v1/employee-portal/me/documents'),
  });
}
