"use client";

import { useState } from "react";
import { RefreshCcw, CheckCircle2, Clock, AlertTriangle, Loader2, Play } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  useConnectors,
  useSyncJobs,
  useTriggerSync,
  type Connector,
  type SyncJob,
} from "@/hooks/use-integrations";

function syncStatusBadge(status: string) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    COMPLETED: "default",
    RUNNING: "secondary",
    FAILED: "destructive",
    PENDING: "outline",
    CANCELLED: "outline",
  };
  return <Badge variant={variants[status] ?? "outline"} className="text-xs">{status}</Badge>;
}

function syncStatusIcon(status: string) {
  if (status === "COMPLETED") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "RUNNING") return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
  if (status === "FAILED") return <AlertTriangle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
}

function ConnectorSyncCard({ connector }: { connector: Connector }) {
  const { data: syncJobs, isLoading } = useSyncJobs(connector.id);
  const triggerSync = useTriggerSync();

  const latestJobs = (syncJobs ?? []).slice(0, 5);
  const completed = latestJobs.filter((j) => j.status === "COMPLETED").length;
  const failed = latestJobs.filter((j) => j.status === "FAILED").length;
  const total = latestJobs.length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <RefreshCcw className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">{connector.name}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Last sync: {connector.lastSyncAt
                  ? new Date(connector.lastSyncAt).toLocaleString()
                  : "Never"}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerSync.mutate({ connectorId: connector.id })}
            disabled={triggerSync.isPending}
          >
            {triggerSync.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Sync Now
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Success rate */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Success Rate</span>
          <span className="font-medium">{successRate}%</span>
        </div>
        <Progress value={successRate} className="h-2" />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-2">
            <p className="text-lg font-bold text-green-600">{completed}</p>
            <p className="text-xs text-muted-foreground">Success</p>
          </div>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-2">
            <p className="text-lg font-bold text-red-600">{failed}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-2">
            <p className="text-lg font-bold">{total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>

        {/* Recent sync history */}
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : latestJobs.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Recent Syncs</p>
            {latestJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between text-xs py-1">
                <div className="flex items-center gap-2">
                  {syncStatusIcon(job.status)}
                  <span className="text-muted-foreground">
                    {job.startedAt ? new Date(job.startedAt).toLocaleString() : "Queued"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {job.recordsProcessed != null && (
                    <span className="text-muted-foreground">{job.recordsProcessed} records</span>
                  )}
                  {syncStatusBadge(job.status)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">No sync history yet</p>
        )}

        {/* Error message for latest failed job */}
        {latestJobs[0]?.status === "FAILED" && latestJobs[0].errorMessage && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-2">
            <p className="text-xs text-red-600">{latestJobs[0].errorMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SyncStatusPage() {
  const { data: connectors, isLoading } = useConnectors();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sync Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor data synchronization health across all connected systems.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {(connectors ?? []).length} Connectors
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (connectors ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <RefreshCcw className="h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No connectors configured yet.</p>
            <p className="text-sm text-muted-foreground">
              Set up a connector in the Marketplace to start syncing data.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(connectors ?? []).map((connector) => (
            <ConnectorSyncCard key={connector.id} connector={connector} />
          ))}
        </div>
      )}
    </div>
  );
}

