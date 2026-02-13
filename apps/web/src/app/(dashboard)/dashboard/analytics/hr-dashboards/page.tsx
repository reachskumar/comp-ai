"use client";

import * as React from "react";
import { Users, DollarSign, BarChart3, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRC = React.ComponentType<any>;

interface RechartsComponents {
  BarChart: AnyRC;
  Bar: AnyRC;
  XAxis: AnyRC;
  YAxis: AnyRC;
  CartesianGrid: AnyRC;
  Tooltip: AnyRC;
  ResponsiveContainer: AnyRC;
}

interface HrDashboardResponse {
  headcountByDepartment: Array<{ department: string; count: number }>;
  salaryDistribution: Array<{ range: string; count: number }>;
  avgSalaryByLevel: Array<{ level: string; avgSalary: number; count: number }>;
  summary: {
    totalEmployees: number;
    avgSalary: number;
    medianSalary: number;
    totalPayroll: number;
  };
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function HRDashboardsPage() {
  const [data, setData] = React.useState<HrDashboardResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Dynamic Recharts import (avoid SSR issues)
  const [RC, setRC] = React.useState<RechartsComponents | null>(null);
  React.useEffect(() => {
    import("recharts").then((mod) => {
      setRC({
        BarChart: mod.BarChart,
        Bar: mod.Bar,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
      } as RechartsComponents);
    });
  }, []);

  React.useEffect(() => {
    setLoading(true);
    apiClient
      .fetch<HrDashboardResponse>("/api/v1/analytics/hr-dashboard")
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HR Dashboards</h1>
        <p className="text-muted-foreground">
          Workforce analytics and HR metrics from your employee data.
        </p>
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {data && data.summary.totalEmployees === 0 && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No Employee Data</p>
            <p className="text-xs text-muted-foreground">Import employees to see HR dashboard metrics.</p>
          </CardContent>
        </Card>
      )}

      {data && data.summary.totalEmployees > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Employees</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  {data.summary.totalEmployees.toLocaleString()}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Average Salary</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  {formatCurrency(data.summary.avgSalary)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Median Salary</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  {formatCurrency(data.summary.medianSalary)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Payroll</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  {formatCurrency(data.summary.totalPayroll)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Headcount by Department Chart */}
          {RC && data.headcountByDepartment.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Headcount by Department
                </CardTitle>
                <CardDescription>Active employee distribution across departments.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <RC.ResponsiveContainer width="100%" height="100%">
                    <RC.BarChart data={data.headcountByDepartment}>
                      <RC.CartesianGrid strokeDasharray="3 3" />
                      <RC.XAxis dataKey="department" />
                      <RC.YAxis allowDecimals={false} />
                      <RC.Tooltip />
                      <RC.Bar dataKey="count" name="Employees" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </RC.BarChart>
                  </RC.ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Salary Distribution Chart */}
          {RC && data.salaryDistribution.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Salary Distribution
                </CardTitle>
                <CardDescription>Distribution of base salaries across the organization.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <RC.ResponsiveContainer width="100%" height="100%">
                    <RC.BarChart data={data.salaryDistribution}>
                      <RC.CartesianGrid strokeDasharray="3 3" />
                      <RC.XAxis dataKey="range" />
                      <RC.YAxis allowDecimals={false} />
                      <RC.Tooltip />
                      <RC.Bar dataKey="count" name="Employees" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </RC.BarChart>
                  </RC.ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Average Salary by Level Table */}
          {data.avgSalaryByLevel.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Average Salary by Level</CardTitle>
                <CardDescription>Compensation breakdown by employee level.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Level</TableHead>
                      <TableHead className="text-right">Employees</TableHead>
                      <TableHead className="text-right">Avg Salary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.avgSalaryByLevel.map((row) => (
                      <TableRow key={row.level}>
                        <TableCell className="font-medium">{row.level}</TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                        <TableCell className="text-right">{formatCurrency(row.avgSalary)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

