"use client";

import * as React from "react";
import {
  Scale,
  AlertTriangle,
  TrendingUp,
  Sparkles,
  Loader2,
  Download,
  Play,
  BarChart3,
  Info,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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

/* ─── Types ────────────────────────────────────────── */

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
  Cell: AnyRC;
  ScatterChart: AnyRC;
  Scatter: AnyRC;
  Legend: AnyRC;
}

interface RegressionResult {
  dimension: string;
  group: string;
  referenceGroup: string;
  coefficient: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
  confidenceInterval: [number, number];
  sampleSize: number;
  gapPercent: number;
  significance: "significant" | "marginal" | "not_significant";
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
}

interface CompaRatioResult {
  dimension: string;
  group: string;
  avgCompaRatio: number;
  medianCompaRatio: number;
  count: number;
  stdDev: number;
}

interface RemediationEstimate {
  totalCost: number;
  affectedEmployees: number;
  avgAdjustment: number;
  adjustmentsByGroup: Array<{
    dimension: string;
    group: string;
    employees: number;
    totalCost: number;
    avgAdjustment: number;
  }>;
}

interface PayEquityReport {
  id: string;
  tenantId: string;
  createdAt: string;
  dimensions: string[];
  controlVariables: string[];
  overallStats: {
    totalEmployees: number;
    rSquared: number;
    adjustedRSquared: number;
    fStatistic: number;
  };
  regressionResults: RegressionResult[];
  compaRatios: CompaRatioResult[];
  remediation: RemediationEstimate;
  status: string;
}

interface SimulationResult {
  originalCost: number;
  newCost: number;
  savings: number;
  affectedEmployees: number;
  newGapEstimates: Array<{
    dimension: string;
    group: string;
    estimatedNewGap: number;
  }>;
}

/* ─── Constants ─────────────────────────────────────── */

const DIMENSION_OPTIONS = [
  { value: "gender", label: "Gender" },
  { value: "ethnicity", label: "Ethnicity" },
  { value: "age_band", label: "Age Band" },
];

/* ─── Helpers ───────────────────────────────────────── */

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);
}

function riskBadge(level: string) {
  const variants: Record<string, { variant: "destructive" | "default" | "secondary"; className: string }> = {
    HIGH: { variant: "destructive", className: "" },
    MEDIUM: { variant: "default", className: "bg-orange-500 hover:bg-orange-500/80" },
    LOW: { variant: "secondary", className: "bg-green-500/20 text-green-700" },
  };
  const cfg = variants[level] ?? variants["LOW"]!;
  return <Badge variant={cfg.variant} className={cfg.className}>{level}</Badge>;
}

function significanceBadge(sig: string) {
  if (sig === "significant") return <Badge variant="destructive">Significant (p&lt;0.05)</Badge>;
  if (sig === "marginal") return <Badge variant="default" className="bg-yellow-500 hover:bg-yellow-500/80">Marginal (p&lt;0.10)</Badge>;
  return <Badge variant="secondary">Not Significant</Badge>;
}

/* ─── Page Component ────────────────────────────────── */

export default function PayEquityPage() {
  const [selectedDimension, setSelectedDimension] = React.useState("gender");
  const [activeTab, setActiveTab] = React.useState("overview");
  const [report, setReport] = React.useState<PayEquityReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Simulation state
  const [simAdjustment, setSimAdjustment] = React.useState("3");
  const [simResult, setSimResult] = React.useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = React.useState(false);

  // AI narrative state
  const [narrative, setNarrative] = React.useState<string | null>(null);
  const [narrativeLoading, setNarrativeLoading] = React.useState(false);

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
        Cell: mod.Cell,
        ScatterChart: mod.ScatterChart,
        Scatter: mod.Scatter,
        Legend: mod.Legend,
      } as RechartsComponents);
    });
  }, []);

  const runAnalysis = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setNarrative(null);
    setSimResult(null);
    try {
      const result = await apiClient.fetch<PayEquityReport>(
        "/api/v1/analytics/pay-equity/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            dimensions: [selectedDimension],
            controlVariables: ["job_level", "tenure", "performance", "location", "department"],
            targetThreshold: 2,
          }),
        },
      );
      setReport(result);
      setActiveTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [selectedDimension]);

  const runSimulation = React.useCallback(async () => {
    if (!report) return;
    setSimLoading(true);
    try {
      const result = await apiClient.fetch<SimulationResult>(
        `/api/v1/analytics/pay-equity/report/${report.id}/simulate`,
        {
          method: "POST",
          body: JSON.stringify({ adjustmentPercent: parseFloat(simAdjustment) || 3 }),
        },
      );
      setSimResult(result);
    } catch {
      // silent fail for simulation
    } finally {
      setSimLoading(false);
    }
  }, [report, simAdjustment]);

  const generateNarrative = React.useCallback(async () => {
    if (!report) return;
    setNarrativeLoading(true);
    try {
      // Use report data to generate a client-side narrative summary
      const highRisk = report.regressionResults.filter((r) => r.riskLevel === "HIGH");
      const medRisk = report.regressionResults.filter((r) => r.riskLevel === "MEDIUM");
      const lines = [
        `## Pay Equity Executive Summary`,
        ``,
        `**Analysis Date:** ${new Date(report.createdAt).toLocaleDateString()}`,
        `**Population:** ${report.overallStats.totalEmployees} employees`,
        `**Dimensions Analyzed:** ${report.dimensions.join(", ")}`,
        `**Model R²:** ${report.overallStats.rSquared}`,
        ``,
        `### Key Findings`,
        ``,
        highRisk.length > 0
          ? `⚠️ **${highRisk.length} HIGH-RISK gap(s) detected** requiring immediate attention.`
          : `✅ No high-risk pay gaps detected.`,
        medRisk.length > 0
          ? `⚡ **${medRisk.length} MEDIUM-RISK gap(s)** should be monitored.`
          : ``,
        ``,
        ...report.regressionResults
          .filter((r) => r.significance !== "not_significant")
          .map(
            (r) =>
              `- **${r.group}** vs ${r.referenceGroup} (${r.dimension}): ${r.gapPercent > 0 ? "+" : ""}${r.gapPercent}% gap (p=${r.pValue}, ${r.riskLevel} risk)`,
          ),
        ``,
        `### Remediation Estimate`,
        ``,
        `Estimated total cost to close gaps: **${formatCurrency(report.remediation.totalCost)}**`,
        `Affected employees: **${report.remediation.affectedEmployees}**`,
      ];
      setNarrative(lines.filter(Boolean).join("\n"));
    } finally {
      setNarrativeLoading(false);
    }
  }, [report]);

  // Derived data for charts
  const gapChartData = React.useMemo(() => {
    if (!report) return [];
    return report.regressionResults.map((r) => ({
      name: `${r.group}`,
      gap: r.gapPercent,
      risk: r.riskLevel,
    }));
  }, [report]);

  const compaChartData = React.useMemo(() => {
    if (!report) return [];
    return report.compaRatios.map((c) => ({
      name: c.group,
      avg: c.avgCompaRatio,
      median: c.medianCompaRatio,
      count: c.count,
    }));
  }, [report]);

  const RISK_COLORS: Record<string, string> = { HIGH: "#ef4444", MEDIUM: "#f97316", LOW: "#22c55e" };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="h-6 w-6" /> Pay Equity Analyzer
          </h1>
          <p className="text-muted-foreground">
            Statistical analysis of pay equity with AI-powered insights.
          </p>
        </div>
        {report && (
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Download className="mr-1 h-4 w-4" /> Export PDF
          </Button>
        )}
      </div>

      {/* Analysis Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Analysis</CardTitle>
          <CardDescription>
            Select demographic dimension and run regression analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="w-48">
              <label className="text-sm font-medium mb-1 block">Dimension</label>
              <Select
                options={DIMENSION_OPTIONS}
                value={selectedDimension}
                onChange={(e) => setSelectedDimension(e.target.value)}
              />
            </div>
            <Button onClick={runAnalysis} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              {loading ? "Analyzing..." : "Run Analysis"}
            </Button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* Results */}
      {report && !loading && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Employees</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{report.overallStats.totalEmployees}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Model R²</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{report.overallStats.rSquared}</p>
                <p className="text-xs text-muted-foreground">Adjusted: {report.overallStats.adjustedRSquared}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-red-500" /> Significant Gaps
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-red-600">
                  {report.regressionResults.filter((r) => r.significance === "significant").length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Remediation Cost
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(report.remediation.totalCost)}</p>
                <p className="text-xs text-muted-foreground">{report.remediation.affectedEmployees} affected</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabbed Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="overview">
                <BarChart3 className="mr-1 h-4 w-4" /> Overview
              </TabsTrigger>
              <TabsTrigger value="regression">
                <Info className="mr-1 h-4 w-4" /> Regression Details
              </TabsTrigger>
              <TabsTrigger value="remediation">
                <TrendingUp className="mr-1 h-4 w-4" /> Remediation Simulator
              </TabsTrigger>
              <TabsTrigger value="narrative">
                <Sparkles className="mr-1 h-4 w-4" /> AI Insights
              </TabsTrigger>
            </TabsList>

            {/* TAB: Overview */}
            <TabsContent value="overview">
              <OverviewTab report={report} RC={RC} gapChartData={gapChartData} compaChartData={compaChartData} RISK_COLORS={RISK_COLORS} />
            </TabsContent>

            {/* TAB: Regression Details */}
            <TabsContent value="regression">
              <RegressionTab report={report} />
            </TabsContent>

            {/* TAB: Remediation Simulator */}
            <TabsContent value="remediation">
              <RemediationTab
                report={report}
                simAdjustment={simAdjustment}
                setSimAdjustment={setSimAdjustment}
                simResult={simResult}
                simLoading={simLoading}
                runSimulation={runSimulation}
              />
            </TabsContent>

            {/* TAB: AI Insights */}
            <TabsContent value="narrative">
              <NarrativeTab
                narrative={narrative}
                narrativeLoading={narrativeLoading}
                generateNarrative={generateNarrative}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

/* ─── Overview Tab ──────────────────────────────────── */

function OverviewTab({
  report,
  RC,
  gapChartData,
  compaChartData,
  RISK_COLORS,
}: {
  report: PayEquityReport;
  RC: RechartsComponents | null;
  gapChartData: Array<{ name: string; gap: number; risk: string }>;
  compaChartData: Array<{ name: string; avg: number; median: number; count: number }>;
  RISK_COLORS: Record<string, string>;
}) {
  return (
    <div className="space-y-6 mt-4">
      {/* Gap Chart */}
      {RC && gapChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Pay Gap by Group
            </CardTitle>
            <CardDescription>
              Regression-adjusted pay gap percentage vs reference group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <RC.ResponsiveContainer width="100%" height="100%">
                <RC.BarChart data={gapChartData} layout="vertical">
                  <RC.CartesianGrid strokeDasharray="3 3" />
                  <RC.XAxis type="number" tickFormatter={(v: number) => `${v}%`} />
                  <RC.YAxis dataKey="name" type="category" width={120} />
                  <RC.Tooltip formatter={(v: number) => [`${v}%`, "Pay Gap"]} />
                  <RC.Bar dataKey="gap" radius={[0, 4, 4, 0]}>
                    {gapChartData.map((entry, idx) => (
                      <RC.Cell key={idx} fill={RISK_COLORS[entry.risk] ?? "#6b7280"} />
                    ))}
                  </RC.Bar>
                </RC.BarChart>
              </RC.ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compa-Ratio Chart */}
      {RC && compaChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compa-Ratio Distribution</CardTitle>
            <CardDescription>
              Average compa-ratio by demographic group (1.0 = at midpoint).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <RC.ResponsiveContainer width="100%" height="100%">
                <RC.BarChart data={compaChartData}>
                  <RC.CartesianGrid strokeDasharray="3 3" />
                  <RC.XAxis dataKey="name" />
                  <RC.YAxis domain={[0.8, 1.2]} />
                  <RC.Tooltip />
                  <RC.Bar dataKey="avg" name="Avg Compa-Ratio" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <RC.Bar dataKey="median" name="Median Compa-Ratio" fill="#a5b4fc" radius={[4, 4, 0, 0]} />
                </RC.BarChart>
              </RC.ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Risk Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Risk Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {report.regressionResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <span className="font-medium">{r.group}</span>
                  <span className="text-muted-foreground text-sm ml-2">vs {r.referenceGroup}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono">
                    {r.gapPercent > 0 ? "+" : ""}{r.gapPercent}%
                  </span>
                  {riskBadge(r.riskLevel)}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


/* ─── Regression Tab ────────────────────────────────── */

function RegressionTab({ report }: { report: PayEquityReport }) {
  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regression Results</CardTitle>
          <CardDescription>
            OLS regression coefficients controlling for {report.controlVariables.join(", ")}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Coefficient</TableHead>
                <TableHead className="text-right">Std Error</TableHead>
                <TableHead className="text-right">t-Stat</TableHead>
                <TableHead className="text-right">p-Value</TableHead>
                <TableHead className="text-right">Gap %</TableHead>
                <TableHead>Significance</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">N</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.regressionResults.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.group}</TableCell>
                  <TableCell className="text-muted-foreground">{r.referenceGroup}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(r.coefficient)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(r.standardError)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.tStatistic.toFixed(3)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.pValue.toFixed(4)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    <span className={r.gapPercent < 0 ? "text-red-600" : r.gapPercent > 0 ? "text-green-600" : ""}>
                      {r.gapPercent > 0 ? "+" : ""}{r.gapPercent}%
                    </span>
                  </TableCell>
                  <TableCell>{significanceBadge(r.significance)}</TableCell>
                  <TableCell>{riskBadge(r.riskLevel)}</TableCell>
                  <TableCell className="text-right">{r.sampleSize}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confidence Intervals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">95% Confidence Intervals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {report.regressionResults.map((r, i) => {
              const range = r.confidenceInterval[1] - r.confidenceInterval[0];
              const maxAbs = Math.max(
                ...report.regressionResults.flatMap((rr) => rr.confidenceInterval.map(Math.abs)),
              );
              const left = 50 + (r.confidenceInterval[0] / (maxAbs * 2)) * 100;
              const width = (range / (maxAbs * 2)) * 100;

              return (
                <div key={i} className="flex items-center gap-4">
                  <span className="w-32 text-sm font-medium truncate">{r.group}</span>
                  <div className="flex-1 relative h-6 bg-muted rounded">
                    {/* Zero line */}
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border" />
                    {/* CI bar */}
                    <div
                      className="absolute top-1 bottom-1 rounded"
                      style={{
                        left: `${Math.max(0, left)}%`,
                        width: `${Math.min(100, width)}%`,
                        backgroundColor: RISK_COLOR_MAP[r.riskLevel] ?? "#6b7280",
                      }}
                    />
                  </div>
                  <span className="w-40 text-xs font-mono text-muted-foreground">
                    [{formatCurrency(r.confidenceInterval[0])}, {formatCurrency(r.confidenceInterval[1])}]
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const RISK_COLOR_MAP: Record<string, string> = { HIGH: "#ef4444", MEDIUM: "#f97316", LOW: "#22c55e" };

/* ─── Remediation Tab ───────────────────────────────── */

function RemediationTab({
  report,
  simAdjustment,
  setSimAdjustment,
  simResult,
  simLoading,
  runSimulation,
}: {
  report: PayEquityReport;
  simAdjustment: string;
  setSimAdjustment: (v: string) => void;
  simResult: SimulationResult | null;
  simLoading: boolean;
  runSimulation: () => void;
}) {
  return (
    <div className="space-y-6 mt-4">
      {/* Current Remediation Estimate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Remediation Estimate</CardTitle>
          <CardDescription>
            Cost to close all statistically significant pay gaps above threshold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <div className="p-4 rounded-lg border text-center">
              <p className="text-sm text-muted-foreground">Total Cost</p>
              <p className="text-2xl font-bold">{formatCurrency(report.remediation.totalCost)}</p>
            </div>
            <div className="p-4 rounded-lg border text-center">
              <p className="text-sm text-muted-foreground">Affected Employees</p>
              <p className="text-2xl font-bold">{report.remediation.affectedEmployees}</p>
            </div>
            <div className="p-4 rounded-lg border text-center">
              <p className="text-sm text-muted-foreground">Avg Adjustment</p>
              <p className="text-2xl font-bold">{formatCurrency(report.remediation.avgAdjustment)}</p>
            </div>
          </div>

          {report.remediation.adjustmentsByGroup.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dimension</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Avg per Employee</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.remediation.adjustmentsByGroup.map((g, i) => (
                  <TableRow key={i}>
                    <TableCell>{g.dimension}</TableCell>
                    <TableCell className="font-medium">{g.group}</TableCell>
                    <TableCell className="text-right">{g.employees}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(g.totalCost)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(g.avgAdjustment)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Simulator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" /> What-If Simulator
          </CardTitle>
          <CardDescription>
            Model the impact of raising pay for underpaid groups by a percentage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 mb-6">
            <div>
              <label className="text-sm font-medium mb-1 block">Adjustment %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={simAdjustment}
                onChange={(e) => setSimAdjustment(e.target.value)}
                className="flex h-9 w-24 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              />
            </div>
            <Button onClick={runSimulation} disabled={simLoading}>
              {simLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              Simulate
            </Button>
          </div>

          {simResult && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 rounded-lg border text-center">
                  <p className="text-sm text-muted-foreground">New Cost</p>
                  <p className="text-2xl font-bold">{formatCurrency(simResult.newCost)}</p>
                </div>
                <div className="p-4 rounded-lg border text-center">
                  <p className="text-sm text-muted-foreground">Affected</p>
                  <p className="text-2xl font-bold">{simResult.affectedEmployees}</p>
                </div>
                <div className="p-4 rounded-lg border text-center">
                  <p className="text-sm text-muted-foreground">Savings vs Full Fix</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(simResult.savings)}</p>
                </div>
              </div>

              {simResult.newGapEstimates.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Projected Remaining Gaps</p>
                  {simResult.newGapEstimates.map((g, i) => (
                    <div key={i} className="flex items-center gap-3 mb-2">
                      <span className="text-sm w-32">{g.group} ({g.dimension})</span>
                      <Progress value={Math.max(0, 100 - g.estimatedNewGap * 10)} max={100} className="flex-1" />
                      <span className="text-sm font-mono w-16 text-right">{g.estimatedNewGap.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Narrative Tab ─────────────────────────────────── */

function NarrativeTab({
  narrative,
  narrativeLoading,
  generateNarrative,
}: {
  narrative: string | null;
  narrativeLoading: boolean;
  generateNarrative: () => void;
}) {
  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" /> AI-Generated Insights
              </CardTitle>
              <CardDescription>
                Executive summary and actionable recommendations.
              </CardDescription>
            </div>
            <Button onClick={generateNarrative} disabled={narrativeLoading}>
              {narrativeLoading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              {narrative ? "Regenerate" : "Generate Insights"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!narrative && !narrativeLoading && (
            <div className="flex flex-col items-center py-12 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No insights generated yet</p>
              <p className="text-xs text-muted-foreground">
                Click &quot;Generate Insights&quot; to create an AI-powered executive summary.
              </p>
            </div>
          )}
          {narrativeLoading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          {narrative && !narrativeLoading && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              {narrative.split("\n").map((line, i) => {
                if (line.startsWith("## ")) return <h2 key={i} className="text-lg font-bold mt-4 mb-2">{line.slice(3)}</h2>;
                if (line.startsWith("### ")) return <h3 key={i} className="text-base font-semibold mt-3 mb-1">{line.slice(4)}</h3>;
                if (line.startsWith("- ")) return <li key={i} className="ml-4 text-sm">{line.slice(2)}</li>;
                if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="text-sm font-bold">{line.replace(/\*\*/g, "")}</p>;
                if (line.trim() === "") return <br key={i} />;
                return <p key={i} className="text-sm text-muted-foreground">{line}</p>;
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}