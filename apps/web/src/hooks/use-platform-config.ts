'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export function useConfigCategories() {
  return useQuery({
    queryKey: ['platform-config-categories'],
    queryFn: () => apiClient.adminGetConfigCategories(),
  });
}

export function useConfig(category: string) {
  return useQuery({
    queryKey: ['platform-config', category],
    queryFn: () => apiClient.adminGetConfig(category),
    enabled: !!category,
  });
}

export function useSetConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { category: string; key: string; value: string; isSecret?: boolean; description?: string }) =>
      apiClient.adminSetConfig(params.category, params.key, params.value, params.isSecret, params.description),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['platform-config', variables.category] });
    },
  });
}

export function useDeleteConfigMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { category: string; key: string }) =>
      apiClient.adminDeleteConfig(params.category, params.key),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['platform-config', variables.category] });
    },
  });
}

export function useAIPresets() {
  return useQuery({
    queryKey: ['platform-config-presets-ai'],
    queryFn: () => apiClient.adminGetAIPresets(),
    staleTime: Infinity,
  });
}

export function useMarketDataPresets() {
  return useQuery({
    queryKey: ['platform-config-presets-market-data'],
    queryFn: () => apiClient.adminGetMarketDataPresets(),
    staleTime: Infinity,
  });
}

export function useFeaturePresets() {
  return useQuery({
    queryKey: ['platform-config-presets-features'],
    queryFn: () => apiClient.adminGetFeaturePresets(),
    staleTime: Infinity,
  });
}

export function useValidateAI() {
  return useQuery({
    queryKey: ['platform-config-validate-ai'],
    queryFn: () => apiClient.adminValidateAI(),
    enabled: false, // Only run on demand
  });
}

export function useIntegrationStats() {
  return useQuery({
    queryKey: ['integration-stats'],
    queryFn: () => apiClient.adminGetIntegrationStats(),
    refetchInterval: 120_000,
  });
}

export function useConnectionStatus() {
  return useQuery({
    queryKey: ['connection-status'],
    queryFn: () => apiClient.adminGetConnectionStatus(),
    refetchInterval: 60_000,
  });
}

export function useOnboardingStatus() {
  return useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => apiClient.adminGetOnboardingStatus(),
  });
}
