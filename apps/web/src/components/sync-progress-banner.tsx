'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useCurrentSyncStatus } from '@/hooks/use-dashboard';
import { useAuthStore } from '@/stores/auth-store';

/**
 * A small banner that appears at the top of the tenant dashboard while a
 * full-sync is running (kicked off from platform admin). Polls every 3s and
 * shows a live count + percentage. When the sync completes, flashes a
 * "Sync complete" state briefly, refreshes dashboard data, then dismisses.
 */
export function SyncProgressBanner() {
  // Only tenant users (not platform admins) hit the tenant-scoped endpoint.
  // Platform admins land on the same layout but have no tenantId in their JWT,
  // so we short-circuit to avoid 403s.
  const tenant = useAuthStore((s) => s.tenant);
  return tenant?.id ? <SyncProgressBannerInner /> : null;
}

function SyncProgressBannerInner() {
  const { data } = useCurrentSyncStatus();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [flash, setFlash] = useState<null | 'completed' | 'failed'>(null);
  const prevStatusRef = useRef<string | null>(null);

  // Detect terminal transitions → refresh tenant data, show flash card briefly
  useEffect(() => {
    const status = data?.status ?? null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if (
      prev &&
      (prev === 'RUNNING' || prev === 'PENDING') &&
      (status === 'COMPLETED' || status === 'FAILED')
    ) {
      setFlash(status === 'COMPLETED' ? 'completed' : 'failed');
      // Refresh dashboard + employee queries so counts update immediately
      void qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
      // Hide the completion banner after 8 seconds
      const t = setTimeout(() => setFlash(null), 8000);
      return () => clearTimeout(t);
    }
  }, [data?.status, qc]);

  if (dismissed) return null;

  const isRunning = data?.status === 'RUNNING' || data?.status === 'PENDING';

  if (!isRunning && !flash) return null;

  // Running banner
  if (isRunning && data) {
    const processed = data.processedRecords ?? 0;
    const total = data.totalRecords ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;
    const phaseLabel =
      data.phase === 'roles'
        ? 'Syncing roles, permissions, and users…'
        : data.phase === 'employees'
          ? `Syncing employees from Compport${total > 0 ? ` (${processed.toLocaleString()} / ${total.toLocaleString()})` : ` (${processed.toLocaleString()} synced)`}`
          : 'Starting Compport data sync…';

    return (
      <div className="mb-4 rounded-lg border border-blue-500/50 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Compport data sync in progress
            </p>
            <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-300">{phaseLabel}</p>
            {pct !== null && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
                <div
                  className="h-full bg-blue-600 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          {pct !== null && (
            <span className="shrink-0 text-xs font-semibold text-blue-700 dark:text-blue-300">
              {pct}%
            </span>
          )}
        </div>
      </div>
    );
  }

  // Completed flash
  if (flash === 'completed') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-500/50 bg-green-50 dark:bg-green-950/20 px-4 py-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-green-900 dark:text-green-100">
            Compport data sync completed
          </p>
          <p className="mt-0.5 text-xs text-green-700 dark:text-green-300">
            {(data?.processedRecords ?? 0).toLocaleString()} employees synced.
            Dashboard data has been refreshed.
          </p>
        </div>
        <button
          onClick={() => {
            setFlash(null);
            setDismissed(true);
          }}
          className="shrink-0 rounded p-1 text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900/30"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Failed flash
  if (flash === 'failed') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">Compport data sync failed</p>
          {data?.errorMessage && (
            <p className="mt-0.5 text-xs text-destructive/80 break-words">
              {data.errorMessage}
            </p>
          )}
        </div>
        <button
          onClick={() => {
            setFlash(null);
            setDismissed(true);
          }}
          className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/20"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
}
