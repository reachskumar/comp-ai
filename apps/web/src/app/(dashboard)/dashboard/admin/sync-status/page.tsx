'use client';

import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useSyncHealth, usePauseSync, useResumeSync } from '@/hooks/use-admin';

function StatusIcon({ status }: { status: string }) {
  if (status === 'healthy') return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (status === 'degraded') return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
  return <XCircle className="h-5 w-5 text-muted-foreground" />;
}

export default function AdminSyncStatusPage() {
  const { data, isLoading, error, refetch } = useSyncHealth();
  const pauseSync = usePauseSync();
  const resumeSync = useResumeSync();
  const { toast } = useToast();

  const handlePause = async (tenantId: string) => {
    try {
      await pauseSync.mutateAsync(tenantId);
      toast({ title: 'Sync paused', description: `Paused sync for tenant ${tenantId}` });
    } catch {
      toast({ title: 'Failed to pause sync', variant: 'destructive' });
    }
  };

  const handleResume = async (tenantId: string) => {
    try {
      await resumeSync.mutateAsync(tenantId);
      toast({ title: 'Sync resumed', description: `Resumed sync for tenant ${tenantId}` });
    } catch {
      toast({ title: 'Failed to resume sync', variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Real-time Sync Status</h1>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((k) => (
            <Skeleton key={k} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Real-time Sync Status</h1>
        <Card className="border-destructive">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">
              Failed to load sync health: {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { status, scheduler, connections, tenants } = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Real-time Sync Status</h1>
            <p className="text-sm text-muted-foreground">
              Auto-refreshes every 10 seconds · Sync interval: {scheduler.intervalSeconds}s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon status={status} />
          <Badge
            variant={
              status === 'healthy' ? 'default' : status === 'degraded' ? 'secondary' : 'outline'
            }
          >
            {status.toUpperCase()}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{connections.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-green-600">Healthy</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{connections.healthy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-yellow-600">Degraded</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-600">{connections.degraded}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600">Disconnected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{connections.disconnected}</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-tenant table */}
      <Card>
        <CardHeader>
          <CardTitle>Tenant Connections</CardTitle>
          <CardDescription>Per-tenant MySQL pool status and sync controls</CardDescription>
        </CardHeader>
        <CardContent>
          {tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No active sync connections. Tenants will appear here once sync is configured.
            </p>
          ) : (
            <div className="space-y-3">
              {tenants.map((t) => (
                <div
                  key={t.tenantId}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {t.connected && t.consecutiveFailures === 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : t.connected ? (
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{t.tenantId}</p>
                      <p className="text-xs text-muted-foreground">
                        Schema: {t.schemaName ?? 'N/A'}
                        {t.connectedSince &&
                          ` · Since: ${new Date(t.connectedSince).toLocaleString()}`}
                        {t.lastHealthCheck &&
                          ` · Last check: ${new Date(t.lastHealthCheck).toLocaleTimeString()}`}
                      </p>
                      {t.lastError && <p className="text-xs text-red-500 mt-0.5">{t.lastError}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.consecutiveFailures > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {t.consecutiveFailures} failures
                      </Badge>
                    )}
                    <Badge variant={t.paused ? 'secondary' : 'default'}>
                      {t.paused ? 'Paused' : 'Active'}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void (t.paused ? handleResume(t.tenantId) : handlePause(t.tenantId))
                      }
                    >
                      {t.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
