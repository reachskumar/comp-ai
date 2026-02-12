"use client";

import { RefreshCcw, CheckCircle2, Clock, AlertTriangle, Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Sync History",
    description: "View detailed logs of all data synchronization runs with timestamps and status.",
    icon: Clock,
  },
  {
    title: "Health Monitoring",
    description: "Real-time monitoring of connector health, uptime, and error rates.",
    icon: Activity,
  },
  {
    title: "Error Resolution",
    description: "Identify and resolve sync failures with detailed error messages and retry options.",
    icon: AlertTriangle,
  },
  {
    title: "Sync Scheduling",
    description: "Configure automatic sync intervals and trigger manual syncs on demand.",
    icon: CheckCircle2,
  },
];

export default function SyncStatusPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sync Status</h1>
          <p className="text-muted-foreground">
            Monitor data synchronization health and resolve sync issues.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <RefreshCcw className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Synchronization Dashboard</CardTitle>
              <CardDescription>
                Track the status of all data flows between connected systems in real time.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((feature) => (
          <Card key={feature.title}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <feature.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <CardTitle className="text-base">{feature.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

