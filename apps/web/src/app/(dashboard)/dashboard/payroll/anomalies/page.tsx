"use client";

import * as React from "react";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  XCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Shield,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePayrollRuns,
  useAnomalies,
  type PayrollAnomaly,
  type AnomalySeverity,
  type AnomalyType,
} from "@/hooks/use-payroll";

const SEVERITY_OPTIONS = [
  { value: "", label: "All Severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

const TYPE_OPTIONS = [
  { value: "", label: "All Types" },
  { value: "NEGATIVE_NET", label: "Negative Net" },
  { value: "SPIKE", label: "Spike" },
  { value: "DROP", label: "Drop" },
  { value: "UNUSUAL_DEDUCTION", label: "Unusual Deduction" },
  { value: "MISSING_COMPONENT", label: "Missing Component" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "CUSTOM", label: "Custom" },
];

const RESOLVED_OPTIONS = [
  { value: "", label: "All" },
  { value: "false", label: "Unresolved" },
  { value: "true", label: "Resolved" },
];

function severityBadge(severity: AnomalySeverity) {
  const map: Record<AnomalySeverity, { variant: "destructive" | "default" | "secondary" | "outline"; className: string }> = {
    CRITICAL: { variant: "destructive", className: "" },
    HIGH: { variant: "default", className: "bg-orange-500 hover:bg-orange-500/80" },
    MEDIUM: { variant: "secondary", className: "bg-yellow-500/20 text-yellow-700" },
    LOW: { variant: "outline", className: "text-blue-600 border-blue-300" },
  };
  const cfg = map[severity];
  return <Badge variant={cfg.variant} className={cfg.className}>{severity}</Badge>;
}

function typeLabel(type: AnomalyType): string {
  const labels: Record<AnomalyType, string> = {
    NEGATIVE_NET: "Negative Net",
    SPIKE: "Spike",
    DROP: "Drop",
    UNUSUAL_DEDUCTION: "Unusual Deduction",
    MISSING_COMPONENT: "Missing Component",
    DUPLICATE: "Duplicate",
    CUSTOM: "Custom",
  };
  return labels[type] ?? type;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AnomaliesPage() {
  const [selectedRunId, setSelectedRunId] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [severityFilter, setSeverityFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [resolvedFilter, setResolvedFilter] = React.useState("");
  const limit = 20;

  // Load runs for the selector
  const runsQuery = usePayrollRuns(1, 100);
  const runs = runsQuery.data?.data ?? [];

  // Auto-select first run with anomalies
  React.useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      const withAnomalies = runs.find((r) => (r._count?.anomalies ?? 0) > 0);
      setSelectedRunId(withAnomalies?.id ?? runs[0]?.id ?? "");
    }
  }, [runs, selectedRunId]);

  const anomaliesQuery = useAnomalies(
    selectedRunId || null,
    page,
    limit,
    {
      severity: severityFilter || undefined,
      anomalyType: typeFilter || undefined,
      resolved: resolvedFilter || undefined,
    },
  );

  const anomalies = anomaliesQuery.data?.data ?? [];
  const pagination = anomaliesQuery.data?.pagination;

  // Compute summary counts from current page (best effort without a dedicated summary endpoint)
  const criticalCount = anomalies.filter((a) => a.severity === "CRITICAL").length;
  const highCount = anomalies.filter((a) => a.severity === "HIGH").length;
  const mediumCount = anomalies.filter((a) => a.severity === "MEDIUM").length;
  const lowCount = anomalies.filter((a) => a.severity === "LOW").length;
  const totalCount = pagination?.total ?? 0;

  // Recharts dynamic import
  const [RechartsComponents, setRechartsComponents] = React.useState<{
    BarChart: React.ComponentType<Record<string, unknown>>;
    Bar: React.ComponentType<Record<string, unknown>>;
    XAxis: React.ComponentType<Record<string, unknown>>;
    YAxis: React.ComponentType<Record<string, unknown>>;
    CartesianGrid: React.ComponentType<Record<string, unknown>>;
    Tooltip: React.ComponentType<Record<string, unknown>>;
    ResponsiveContainer: React.ComponentType<Record<string, unknown>>;
  } | null>(null);

  React.useEffect(() => {
    import("recharts").then((mod) => {
      setRechartsComponents({
        BarChart: mod.BarChart as unknown as React.ComponentType<Record<string, unknown>>,
        Bar: mod.Bar as unknown as React.ComponentType<Record<string, unknown>>,
        XAxis: mod.XAxis as unknown as React.ComponentType<Record<string, unknown>>,
        YAxis: mod.YAxis as unknown as React.ComponentType<Record<string, unknown>>,
        CartesianGrid: mod.CartesianGrid as unknown as React.ComponentType<Record<string, unknown>>,
        Tooltip: mod.Tooltip as unknown as React.ComponentType<Record<string, unknown>>,
        ResponsiveContainer: mod.ResponsiveContainer as unknown as React.ComponentType<Record<string, unknown>>,
      });
    });
  }, []);

  // Build trend data from runs
  const trendData = runs
    .filter((r) => (r._count?.anomalies ?? 0) >= 0)
    .slice(0, 12)
    .reverse()
    .map((r) => ({
      period: r.period,
      anomalies: r._count?.anomalies ?? 0,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Anomaly Dashboard</h1>
        <p className="text-muted-foreground">Review detected payroll anomalies and discrepancies.</p>
      </div>

      {/* Run Selector */}
      <div className="flex items-center gap-4">
        <div className="w-64">
          <Select
            options={[
              { value: "", label: "Select a payroll run..." },
              ...runs.map((r) => ({
                value: r.id,
                label: `${r.period} — ${r._count?.anomalies ?? 0} anomalies`,
              })),
            ]}
            value={selectedRunId}
            onChange={(e) => { setSelectedRunId(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3 text-red-500" /> Critical
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-orange-500" /> High
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-orange-600">{highCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Info className="h-3 w-3 text-yellow-500" /> Medium
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-600">{mediumCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-500" /> Low
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">{lowCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      {RechartsComponents && trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Anomaly Trend
            </CardTitle>
            <CardDescription>Anomaly counts across recent payroll runs.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <RechartsComponents.ResponsiveContainer width="100%" height="100%">
                <RechartsComponents.BarChart data={trendData}>
                  <RechartsComponents.CartesianGrid strokeDasharray="3 3" />
                  <RechartsComponents.XAxis dataKey="period" />
                  <RechartsComponents.YAxis allowDecimals={false} />
                  <RechartsComponents.Tooltip />
                  <RechartsComponents.Bar dataKey="anomalies" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </RechartsComponents.BarChart>
              </RechartsComponents.ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <Select
            options={SEVERITY_OPTIONS}
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
          />
        </div>
        <div className="w-48">
          <Select
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          />
        </div>
        <div className="w-40">
          <Select
            options={RESOLVED_OPTIONS}
            value={resolvedFilter}
            onChange={(e) => { setResolvedFilter(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Anomaly Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" /> Anomalies
          </CardTitle>
          <CardDescription>
            {selectedRunId ? "Detected anomalies for the selected payroll run." : "Select a payroll run to view anomalies."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedRunId ? (
            <div className="flex flex-col items-center py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No run selected</p>
              <p className="text-xs text-muted-foreground">Choose a payroll run from the dropdown above.</p>
            </div>
          ) : anomaliesQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : anomaliesQuery.isError ? (
            <div className="flex flex-col items-center py-12 text-center">
              <XCircle className="h-8 w-8 text-red-500" />
              <p className="mt-2 text-sm font-medium">Failed to load anomalies</p>
              <p className="text-xs text-muted-foreground">{anomaliesQuery.error?.message}</p>
            </div>
          ) : anomalies.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="mt-2 text-sm font-medium">No anomalies found</p>
              <p className="text-xs text-muted-foreground">This payroll run looks clean!</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalies.map((a: PayrollAnomaly) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium font-mono text-xs">{a.employeeId.slice(0, 8)}…</TableCell>
                    <TableCell>{typeLabel(a.anomalyType)}</TableCell>
                    <TableCell>{severityBadge(a.severity)}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">
                      {(a.details as { message?: string })?.message ?? JSON.stringify(a.details).slice(0, 80)}
                    </TableCell>
                    <TableCell>
                      {a.resolved ? (
                        <Badge variant="secondary" className="bg-green-500/20 text-green-700">Resolved</Badge>
                      ) : (
                        <Badge variant="outline" className="text-orange-600 border-orange-300">Open</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

