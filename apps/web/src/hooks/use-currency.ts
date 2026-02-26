'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export interface ExchangeRate {
  id: string;
  tenantId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  source: 'MANUAL' | 'ECB' | 'OPENEXCHANGE';
  createdAt: string;
}

export interface TenantCurrencySettings {
  baseCurrency: string;
  supportedCurrencies: string[];
}

export interface ConversionResult {
  amount: number;
  from: string;
  to: string;
  convertedAmount: number;
  rate: number;
}

export interface FetchRatesResult {
  fetched: number;
  rates: Array<{ fromCurrency: string; toCurrency: string; rate: number }>;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useExchangeRates() {
  return useQuery<ExchangeRate[]>({
    queryKey: ['exchange-rates'],
    queryFn: () => apiClient.fetch<ExchangeRate[]>('/api/v1/currency/rates'),
  });
}

export function useSupportedCurrencies() {
  return useQuery<TenantCurrencySettings>({
    queryKey: ['supported-currencies'],
    queryFn: () => apiClient.fetch<TenantCurrencySettings>('/api/v1/currency/supported'),
  });
}

export function useConvertCurrency(amount: number, from: string, to: string, enabled = true) {
  return useQuery<ConversionResult>({
    queryKey: ['currency-convert', amount, from, to],
    queryFn: () =>
      apiClient.fetch<ConversionResult>(
        `/api/v1/currency/convert?amount=${amount}&from=${from}&to=${to}`,
      ),
    enabled: enabled && !!from && !!to && from !== to && amount > 0,
  });
}

export function useCreateExchangeRateMutation() {
  const qc = useQueryClient();
  return useMutation<
    ExchangeRate,
    Error,
    { fromCurrency: string; toCurrency: string; rate: number; source?: string }
  >({
    mutationFn: (body) =>
      apiClient.fetch<ExchangeRate>('/api/v1/currency/rates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

export function useFetchLatestRatesMutation() {
  const qc = useQueryClient();
  return useMutation<FetchRatesResult, Error>({
    mutationFn: () =>
      apiClient.fetch<FetchRatesResult>('/api/v1/currency/rates/fetch', {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}

export function useUpdateCurrencySettingsMutation() {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    {
      baseCurrency?: string;
      supportedCurrencies?: string[];
      displayFormat?: Record<string, unknown>;
    }
  >({
    mutationFn: (body) =>
      apiClient.fetch('/api/v1/currency/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['supported-currencies'] });
      void qc.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
  });
}
