'use client';

import { useState } from 'react';
import { Bell, CheckCheck, Trash2, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  useNotifications,
  useUnreadCount,
  useMarkAsReadMutation,
  useMarkAllAsReadMutation,
  useDismissNotificationMutation,
  type NotificationType,
} from '@/hooks/use-notifications';
import { cn } from '@/lib/utils';

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  CYCLE_UPDATE: 'Cycle Update',
  APPROVAL_NEEDED: 'Approval Needed',
  APPROVAL_DECIDED: 'Approval Decided',
  ANOMALY_DETECTED: 'Anomaly Detected',
  RISK_ALERT: 'Risk Alert',
  AD_HOC_REQUEST: 'Ad Hoc Request',
  SYSTEM: 'System',
};

const NOTIFICATION_TYPE_COLORS: Record<NotificationType, string> = {
  CYCLE_UPDATE: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  APPROVAL_NEEDED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  APPROVAL_DECIDED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ANOMALY_DETECTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  RISK_ALERT: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  AD_HOC_REQUEST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  SYSTEM: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [readFilter, setReadFilter] = useState<string>('all');

  const filters = {
    page,
    limit: 20,
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
    ...(readFilter !== 'all' ? { read: readFilter === 'read' } : {}),
  };

  const { data, isLoading } = useNotifications(filters);
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsReadMutation();
  const markAllAsRead = useMarkAllAsReadMutation();
  const dismiss = useDismissNotificationMutation();

  const notifications = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;
  const unreadCount = unreadData?.count ?? 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up!'}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllAsRead.mutate()}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all as read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All types' },
            ...Object.entries(NOTIFICATION_TYPE_LABELS).map(([key, label]) => ({
              value: key,
              label,
            })),
          ]}
          className="w-44 h-8"
        />
        <Select
          value={readFilter}
          onChange={(e) => {
            setReadFilter(e.target.value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread' },
            { value: 'read', label: 'Read' },
          ]}
          className="w-36 h-8"
        />
      </div>

      {/* Notification list */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No notifications found</div>
        ) : (
          notifications.map((notif) => (
            <Card
              key={notif.id}
              className={cn(
                'flex items-start gap-4 p-4 transition-colors cursor-pointer hover:bg-muted/50',
                !notif.read && 'border-l-2 border-l-primary bg-primary/5',
              )}
              onClick={() => {
                if (!notif.read) markAsRead.mutate(notif.id);
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] px-1.5 py-0',
                      NOTIFICATION_TYPE_COLORS[notif.type as NotificationType] ?? '',
                    )}
                  >
                    {NOTIFICATION_TYPE_LABELS[notif.type as NotificationType] ?? notif.type}
                  </Badge>
                  {!notif.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <h3 className="text-sm font-medium">{notif.title}</h3>
                {notif.body && <p className="text-sm text-muted-foreground mt-0.5">{notif.body}</p>}
                <p className="text-xs text-muted-foreground mt-1">{formatDate(notif.createdAt)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss.mutate(notif.id);
                }}
                aria-label="Dismiss notification"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
