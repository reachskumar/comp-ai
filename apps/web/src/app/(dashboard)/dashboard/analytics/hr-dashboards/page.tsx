"use client";

import { LayoutGrid, Users, TrendingUp, Clock, BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Headcount Analytics",
    description: "Track workforce size, growth trends, and departmental distribution.",
    icon: Users,
  },
  {
    title: "Turnover Metrics",
    description: "Monitor attrition rates, retention trends, and flight risk indicators.",
    icon: TrendingUp,
  },
  {
    title: "Time & Attendance",
    description: "Analyze attendance patterns, overtime trends, and workforce utilization.",
    icon: Clock,
  },
  {
    title: "Custom Dashboards",
    description: "Build and share custom dashboards with drag-and-drop widgets.",
    icon: BarChart3,
  },
];

export default function HRDashboardsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">HR Dashboards</h1>
          <p className="text-muted-foreground">
            Customizable dashboards for workforce analytics and HR metrics.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <LayoutGrid className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>HR Analytics Hub</CardTitle>
              <CardDescription>
                Real-time insights into workforce metrics with customizable dashboard views.
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

