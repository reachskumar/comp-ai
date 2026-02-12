"use client";

import { SlidersHorizontal, Wallet, ShoppingBag, Briefcase, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Flex Spending Accounts",
    description: "Healthcare FSA, Dependent Care FSA, and Limited Purpose FSA administration.",
    icon: Wallet,
  },
  {
    title: "HSA Management",
    description: "Health Savings Account contributions, investments, and qualified expense tracking.",
    icon: ShoppingBag,
  },
  {
    title: "Lifestyle Accounts",
    description: "Customizable lifestyle spending accounts for wellness, education, and commuting.",
    icon: Briefcase,
  },
  {
    title: "Plan Configuration",
    description: "Set contribution limits, eligible expenses, and reimbursement workflows.",
    icon: Settings,
  },
];

export default function FlexibleBenefitsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Flexible Benefits</h1>
          <p className="text-muted-foreground">
            Manage FSA, HSA, and lifestyle spending accounts for employees.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <SlidersHorizontal className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Flexible Benefits Platform</CardTitle>
              <CardDescription>
                Give employees choice and control over their benefits with flexible spending options.
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

