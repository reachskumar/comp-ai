"use client";

import { AppWindow, Link2, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const connectors = [
  {
    title: "Workday",
    description: "HRIS data sync for employee records, org structure, and job profiles.",
    status: "planned",
  },
  {
    title: "SAP SuccessFactors",
    description: "Employee central integration for compensation and benefits data.",
    status: "planned",
  },
  {
    title: "BambooHR",
    description: "Lightweight HRIS connector for SMB employee data synchronization.",
    status: "planned",
  },
  {
    title: "ADP Workforce Now",
    description: "Payroll and HR data integration for compensation workflows.",
    status: "planned",
  },
  {
    title: "Compport PHP",
    description: "Bridge connector to the existing Compport compensation platform.",
    status: "in-development",
  },
  {
    title: "Custom API",
    description: "Build custom integrations using the universal connector framework.",
    status: "planned",
  },
];

function statusBadge(status: string) {
  if (status === "in-development") {
    return <Badge variant="default" className="text-xs">In Development</Badge>;
  }
  return <Badge variant="outline" className="text-xs">Planned</Badge>;
}

export default function ConnectedAppsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Connected Apps</h1>
          <p className="text-muted-foreground">
            Connect your HR systems and third-party applications.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <AppWindow className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Integration Hub</CardTitle>
              <CardDescription>
                Pre-built connectors and a universal framework for connecting any HR system.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connectors.map((connector) => (
          <Card key={connector.title}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Link2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-base">{connector.title}</CardTitle>
                </div>
                {statusBadge(connector.status)}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{connector.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

