"use client";

import { useState } from "react";
import { HeartPulse, Shield, Users, FileText, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function HealthInsurancePage() {
  const [tab, setTab] = useState("plans");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Health &amp; Insurance</h1>
          <p className="text-muted-foreground">
            Manage employee health insurance plans, enrollment, and claims.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="enrollment">Enrollment</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="dependents">Dependents</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Medical Plans", desc: "PPO, HMO, and HDHP options", icon: HeartPulse },
              { title: "Dental Plans", desc: "Preventive and comprehensive coverage", icon: Shield },
              { title: "Vision Plans", desc: "Eye exams and corrective lenses", icon: FileText },
            ].map((plan) => (
              <Card key={plan.title}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <plan.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{plan.title}</CardTitle>
                      <CardDescription className="text-xs">{plan.desc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Plan configuration and tier management will be available here.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="enrollment">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Users className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Open Enrollment</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Manage enrollment windows, employee elections, and life event changes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="claims">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <FileText className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Claims Management</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Track claim submissions, approvals, and reimbursement status.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dependents">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Users className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Dependent Management</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Add and manage employee dependents for insurance coverage.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Settings className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Plan Settings</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Configure carrier integrations, eligibility rules, and contribution tiers.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

