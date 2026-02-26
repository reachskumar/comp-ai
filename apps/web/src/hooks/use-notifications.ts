'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────

export type NotificationType =
  | 'CYCLE_UPDATE'
  | 'APPROVAL_NEEDED'
  | 'APPROVAL_DECIDED'
  | 'ANOMALY_DETECTED'
  | 'RISK_ALERT'
  | 'AD_HOC_REQUEST'
  | 'SYSTEM';

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  read: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationListResponse {
  data: Notification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UnreadCountResponse {
  count: number;
}

// ─── TanStack Query Hooks ───────────────────────────────

export function useNotifications(filters?: {
  type?: string;
  read?: boolean;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.read !== undefined) params.set('read', String(filters.read));
  params.set('page', String(filters?.page ?? 1));
  params.set('limit', String(filters?.limit ?? 20));

  return useQuery<NotificationListResponse>({
    queryKey: ['notifications', filters],
    queryFn: () => apiClient.fetch<NotificationListResponse>(`/api/v1/notifications?${params}`),
  });
}

export function useUnreadCount() {
  return useQuery<UnreadCountResponse>({
    queryKey: ['notifications-unread-count'],
    queryFn: () => apiClient.fetch<UnreadCountResponse>('/api/v1/notifications/unread-count'),
    refetchInterval: 30_000, // Poll every 30 seconds
  });
}

export function useMarkAsReadMutation() {
  const qc = useQueryClient();
  return useMutation<Notification, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<Notification>(`/api/v1/notifications/${id}/read`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}

export function useMarkAllAsReadMutation() {
  const qc = useQueryClient();
  return useMutation<{ count: number }, Error, void>({
    mutationFn: () =>
      apiClient.fetch<{ count: number }>('/api/v1/notifications/read-all', {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}

export function useDismissNotificationMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiClient.fetch<void>(`/api/v1/notifications/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });
}
