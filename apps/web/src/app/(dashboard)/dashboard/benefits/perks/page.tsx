"use client";

import { Gift, Car, GraduationCap, Smartphone, CreditCard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    title: "Commuter Benefits",
    description: "Pre-tax transit passes, parking benefits, and bike-to-work programs.",
    icon: Car,
  },
  {
    title: "Education Assistance",
    description: "Tuition reimbursement, professional development, and certification support.",
    icon: GraduationCap,
  },
  {
    title: "Technology Stipends",
    description: "Home office equipment, phone plans, and internet allowances.",
    icon: Smartphone,
  },
  {
    title: "Discount Programs",
    description: "Corporate discounts, employee purchase programs, and partner offers.",
    icon: CreditCard,
  },
];

export default function PerksAllowancesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Perks &amp; Allowances</h1>
          <p className="text-muted-foreground">
            Manage employee perks, stipends, and allowance programs.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
              <Gift className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <CardTitle>Perks &amp; Allowances Hub</CardTitle>
              <CardDescription>
                Attract and retain talent with competitive perks and flexible allowance programs.
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

