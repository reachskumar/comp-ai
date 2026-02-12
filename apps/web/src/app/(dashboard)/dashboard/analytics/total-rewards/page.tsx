"use client";

import { BarChart3, DollarSign, Heart, TrendingUp, PieChart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Compensation Breakdown",
    description: "Visualize base pay, bonuses, equity, and variable compensation components.",
    icon: DollarSign,
  },
  {
    title: "Benefits Valuation",
    description: "Calculate the total value of health, retirement, and other benefit programs.",
    icon: Heart,
  },
  {
    title: "Trend Analysis",
    description: "Track total rewards changes over time with year-over-year comparisons.",
    icon: TrendingUp,
  },
  {
    title: "Statement Generator",
    description: "Create personalized total rewards statements for employees.",
    icon: PieChart,
  },
];

export default function TotalRewardsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Total Rewards</h1>
          <p className="text-muted-foreground">
            Comprehensive view of compensation, benefits, and total rewards packages.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <BarChart3 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Total Rewards Analytics</CardTitle>
              <CardDescription>
                Understand the full picture of employee compensation and benefits investment.
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

