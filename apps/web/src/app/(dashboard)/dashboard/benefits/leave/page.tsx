"use client";

import { useState } from "react";
import { CalendarDays, Clock, FileText, BarChart3, Settings } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function LeaveManagementPage() {
  const [tab, setTab] = useState("balances");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave Management</h1>
          <p className="text-muted-foreground">
            Track and manage employee leave balances, requests, and policies.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "Vacation", desc: "Annual paid time off", icon: CalendarDays },
              { title: "Sick Leave", desc: "Medical and personal illness", icon: Clock },
              { title: "Personal Days", desc: "Discretionary time off", icon: FileText },
              { title: "Parental Leave", desc: "Maternity and paternity", icon: CalendarDays },
            ].map((type) => (
              <Card key={type.title}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <type.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{type.title}</CardTitle>
                      <CardDescription className="text-xs">{type.desc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Balance tracking and accrual rules will be configured here.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="requests">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <FileText className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Leave Requests</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Review pending requests, approve or deny, and track request history.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <CalendarDays className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Team Calendar</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                View team availability, holidays, and scheduled time off at a glance.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="policies">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Settings className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Leave Policies</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Configure accrual rules, carryover limits, and eligibility criteria.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <BarChart3 className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Leave Reports</h3>
              <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                Generate utilization reports, trend analysis, and compliance summaries.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

