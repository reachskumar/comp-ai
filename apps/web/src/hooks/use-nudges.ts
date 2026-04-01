import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface NudgeEmployee {
  id: string;
  name: string;
  department: string;
  level: string;
  salary: number;
  compaRatio: number | null;
  performanceRating: number | null;
}

export interface Nudge {
  id: string;
  type:
    | 'pay_below_range'
    | 'pay_above_range'
    | 'performance_mismatch'
    | 'gender_gap_risk'
    | 'compa_ratio_outlier';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  employeeCount: number;
  employees: NudgeEmployee[];
  suggestedAction: string;
  copilotPrompt: string;
}

export function useNudges() {
  return useQuery<Nudge[]>({
    queryKey: ['nudges'],
    queryFn: () => apiClient.fetch<Nudge[]>('/api/v1/nudges'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
