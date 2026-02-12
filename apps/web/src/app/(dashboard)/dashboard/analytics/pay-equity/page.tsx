"use client";

import { Scale, Users, AlertTriangle, FileText, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Pay Gap Analysis",
    description: "Identify and measure pay disparities across gender, ethnicity, and other dimensions.",
    icon: Users,
  },
  {
    title: "Risk Assessment",
    description: "Flag high-risk pay equity issues before they become compliance problems.",
    icon: AlertTriangle,
  },
  {
    title: "Remediation Planning",
    description: "Model adjustment scenarios and budget impact for closing pay gaps.",
    icon: TrendingUp,
  },
  {
    title: "Compliance Reports",
    description: "Generate regulatory reports for pay transparency and equal pay legislation.",
    icon: FileText,
  },
];

export default function PayEquityPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pay Equity</h1>
          <p className="text-muted-foreground">
            Analyze and address pay equity across your organization.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Scale className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Pay Equity Dashboard</CardTitle>
              <CardDescription>
                Proactively identify, analyze, and remediate pay disparities to ensure fair compensation.
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

