"use client";

import { Landmark, TrendingUp, PiggyBank, Calculator, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "401(k) Management",
    description: "Configure employer match rules, vesting schedules, and contribution limits.",
    icon: PiggyBank,
  },
  {
    title: "Pension Plans",
    description: "Manage defined benefit plans with actuarial calculations and funding status.",
    icon: Calculator,
  },
  {
    title: "Investment Options",
    description: "Curate fund lineups, target-date funds, and self-directed brokerage windows.",
    icon: TrendingUp,
  },
  {
    title: "Compliance & Reporting",
    description: "Automated ADP/ACP testing, Form 5500 preparation, and audit support.",
    icon: ShieldCheck,
  },
];

export default function RetirementPlansPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Retirement Plans</h1>
          <p className="text-muted-foreground">
            Manage 401(k), pension, and other retirement benefit programs.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Landmark className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Retirement Benefits Hub</CardTitle>
              <CardDescription>
                Centralized management for all retirement plan offerings and employee participation.
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

