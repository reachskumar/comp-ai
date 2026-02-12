"use client";

import {
  Database,
  Cpu,
  RefreshCw,
  Shield,
  Upload,
  FlaskConical,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const modules = [
  {
    title: "Data Hygiene",
    description: "Data import and validation pipeline",
    icon: Database,
    stats: "12 imports processed",
    detail: "Last import: 2 hours ago",
    badge: "Healthy",
    badgeVariant: "default" as const,
    href: "/dashboard/data-hygiene/import",
    secondaryIcon: Upload,
  },
  {
    title: "Rules Copilot",
    description: "Compensation rule management",
    icon: Cpu,
    stats: "8 active rule sets",
    detail: "3 simulations this week",
    badge: "Active",
    badgeVariant: "default" as const,
    href: "/dashboard/rules/rule-sets",
    secondaryIcon: FlaskConical,
  },
  {
    title: "Comp Cycles",
    description: "Compensation cycle management",
    icon: RefreshCw,
    stats: "2 active cycles",
    detail: "Budget utilization: 73%",
    badge: "In Progress",
    badgeVariant: "secondary" as const,
    href: "/dashboard/comp-cycles/active",
    secondaryIcon: BarChart3,
  },
  {
    title: "Payroll Guard",
    description: "Payroll validation and anomaly detection",
    icon: Shield,
    stats: "3 anomalies detected",
    detail: "Last payroll run: yesterday",
    badge: "Needs Review",
    badgeVariant: "outline" as const,
    href: "/dashboard/payroll/runs",
    secondaryIcon: AlertTriangle,
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to the Compensation Platform overview.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        {modules.map((mod) => (
          <Card key={mod.title} className="transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <mod.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">{mod.title}</CardTitle>
                  <CardDescription className="text-xs">{mod.description}</CardDescription>
                </div>
              </div>
              <Badge variant={mod.badgeVariant}>{mod.badge}</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{mod.stats}</p>
                  <p className="text-xs text-muted-foreground">{mod.detail}</p>
                </div>
                <mod.secondaryIcon className="h-8 w-8 text-muted-foreground/30" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

