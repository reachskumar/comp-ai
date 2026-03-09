'use client';

import * as React from 'react';
import {
  Scale,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Trash2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';

/* ─── Recharts (dynamic import to avoid SSR issues) ── */

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
  Legend: AnyRC;
  ReferenceLine: AnyRC;
  PieChart: AnyRC;
  Pie: AnyRC;
}

/* ─── Types ────────────────────────────────────────── */

interface EdgeCoefficient {
  name: string;
  value: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
}

interface EdgeRegressionResult {
  populationSize: number;
  maleCount: number;
  femaleCount: number;
  coefficients: EdgeCoefficient[];
  genderEffect: number;
  threshold: number;
  isCompliant: boolean;
  rSquared: number;
  adjustedRSquared: number;
  fStatistic: number;
  dimension: string;
  dimensionType: string;
}

interface EdgeAnalysisConfig {
  type: 'STANDARD' | 'CUSTOMIZED';
  compType: 'SALARY' | 'PAY';
  name: string;
  additionalPredictors?: string[];
}

interface EdgeAnalysisResult {
  config: EdgeAnalysisConfig;
  overall: EdgeRegressionResult;
  dimensions: EdgeRegressionResult[];
  populationSize: number;
  snapshotDate: string;
  errors: string[];
}

interface SummaryStatEntry {
  observations: number;
  maleCount: number;
  femaleCount: number;
  predictorCount: number;
  adjustedRSquared: number;
  genderCoefficient: number | null;
  genderEffect: number;
  isCompliant: boolean;
}

interface AnalyzeResponse {
  salaryReportId: string;
  payReportId: string;
  analysisType: 'STANDARD' | 'CUSTOMIZED';
  name: string;
  snapshotDate: string;
  passesEdgeStandard: boolean;
  summaryStatistics: {
    analysisType: string;
    analysisName: string;
    threshold: number;
    salary: SummaryStatEntry;
    pay: SummaryStatEntry;
  };
  salaryAnalysis: EdgeAnalysisResult;
  payAnalysis: EdgeAnalysisResult;
  errors: string[];
}

interface ReportListItem {
  id: string;
  name: string;
  type: string;
  status: string;
  compType: string;
  snapshotDate: string;
  populationSize: number;
  threshold: number;
  genderEffect: number;
  isCompliant: boolean;
  adjustedRSquared: number;
  createdAt: string;
}

/* ─── Constants ─────────────────────────────────────── */

const ANALYSIS_TYPE_OPTIONS = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'CUSTOMIZED', label: 'Customized' },
];

const CUSTOM_VARIABLE_OPTIONS = [{ value: 'ftePercent', label: 'FTE Percentage' }];

/* ─── Helpers ───────────────────────────────────────── */

function fmtPct(val: number, decimals = 2): string {
  return `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}%`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ─── Page Component ────────────────────────────────── */

export default function EdgeDashboardPage() {
  // Form state
  const [analysisName, setAnalysisName] = React.useState('');
  const [analysisType, setAnalysisType] = React.useState('STANDARD');
  const [customVars, setCustomVars] = React.useState<string[]>([]);

  // Analysis state
  const [result, setResult] = React.useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // SSE progress state
  const [progressStep, setProgressStep] = React.useState<string | null>(null);
  const [progressPct, setProgressPct] = React.useState(0);

  // Report history state
  const [reports, setReports] = React.useState<ReportListItem[]>([]);
  const [reportsTotal, setReportsTotal] = React.useState(0);
  const [reportsLoading, setReportsLoading] = React.useState(true);

  // Dimension collapse state
  const [showDimensions, setShowDimensions] = React.useState(true);

  // Dynamic Recharts import (avoid SSR issues)
  const [RC, setRC] = React.useState<RechartsComponents | null>(null);
  React.useEffect(() => {
    import('recharts').then((mod) => {
      setRC({
        BarChart: mod.BarChart,
        Bar: mod.Bar,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
        CartesianGrid: mod.CartesianGrid,
        Tooltip: mod.Tooltip,
        ResponsiveContainer: mod.ResponsiveContainer,
        Cell: mod.Cell,
        Legend: mod.Legend,
        ReferenceLine: mod.ReferenceLine,
        PieChart: mod.PieChart,
        Pie: mod.Pie,
      } as RechartsComponents);
    });
  }, []);

  // Load report history on mount
  const fetchReports = React.useCallback(async () => {
    setReportsLoading(true);
    try {
      const data = await apiClient.fetch<{ reports: ReportListItem[]; total: number }>(
        '/api/v1/analytics/pay-equity/edge/reports?limit=50',
      );
      setReports(data.reports);
      setReportsTotal(data.total);
    } catch {
      // silently fail — reports just won't show
    } finally {
      setReportsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const runAnalysis = React.useCallback(async () => {
    if (!analysisName.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgressStep(null);
    setProgressPct(0);

    const body: Record<string, unknown> = {
      analysisType,
      name: analysisName.trim(),
    };
    if (analysisType === 'CUSTOMIZED' && customVars.length > 0) {
      body.customVariables = customVars;
    }

    try {
      const API_BASE = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

      const res = await fetch(`${API_BASE}/api/v1/analytics/pay-equity/edge/analyze/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'progress:step') {
                setProgressStep(data.step ?? null);
                setProgressPct(data.percent ?? 0);
              } else if (currentEvent === 'progress:result') {
                setResult(data as AnalyzeResponse);
                setProgressStep(null);
                setProgressPct(100);
                fetchReports();
              } else if (currentEvent === 'progress:error') {
                setError(data.message ?? 'Analysis failed');
              }
            } catch {
              // skip malformed JSON
            }
            currentEvent = '';
          }
        }
      }
    } catch (err) {
      // Fallback: try non-streaming endpoint
      try {
        const data = await apiClient.fetch<AnalyzeResponse>(
          '/api/v1/analytics/pay-equity/edge/analyze',
          { method: 'POST', body: JSON.stringify(body) },
        );
        setResult(data);
        fetchReports();
      } catch (fallbackErr) {
        setError(
          fallbackErr instanceof Error
            ? fallbackErr.message
            : err instanceof Error
              ? err.message
              : 'Analysis failed',
        );
      }
    } finally {
      setLoading(false);
      setProgressStep(null);
    }
  }, [analysisName, analysisType, customVars, fetchReports]);

  const toggleCustomVar = (v: string) => {
    setCustomVars((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const handleRename = React.useCallback(
    async (id: string, newName: string) => {
      try {
        await apiClient.fetch(`/api/v1/analytics/pay-equity/edge/reports/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: newName }),
        });
        fetchReports();
      } catch {
        // silently fail
      }
    },
    [fetchReports],
  );

  const handleDelete = React.useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this EDGE report? This cannot be undone.')) return;
      try {
        await apiClient.fetch(`/api/v1/analytics/pay-equity/edge/reports/${id}`, {
          method: 'DELETE',
        });
        fetchReports();
      } catch {
        // silently fail
      }
    },
    [fetchReports],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Scale className="h-6 w-6" /> EDGE Pay Equity Analysis
        </h1>
        <p className="text-muted-foreground mt-1">
          Run EDGE-certified multivariate regression analyses on Salary and Pay to measure gender
          pay equity compliance.
        </p>
      </div>

      {/* ─── Run Analysis Form ─────────────────────── */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Run New Analysis</CardTitle>
          <CardDescription>
            Configure and submit an EDGE Standard or Customized regression analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Analysis Name</label>
              <Input
                placeholder="Q1 2026 Pay Equity Audit"
                value={analysisName}
                onChange={(e) => setAnalysisName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Analysis Type</label>
              <Select
                options={ANALYSIS_TYPE_OPTIONS}
                value={analysisType}
                onChange={(e) => setAnalysisType(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={runAnalysis}
                disabled={loading || !analysisName.trim()}
                className="w-full"
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {loading ? 'Running…' : 'Run Analysis'}
              </Button>
            </div>
          </div>
          {analysisType === 'CUSTOMIZED' && (
            <div className="mt-4">
              <label className="text-sm font-medium mb-2 block">
                Additional Predictors (reduces threshold by 0.25% each)
              </label>
              <div className="flex gap-3 flex-wrap">
                {CUSTOM_VARIABLE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={customVars.includes(opt.value)}
                      onChange={() => toggleCustomVar(opt.value)}
                      className="rounded border-input"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Error ─────────────────────────────────── */}
      {error && (
        <Card className="border-destructive print:hidden">
          <CardContent className="pt-6">
            <p className="text-destructive text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* ─── Progress ──────────────────────────────── */}
      {loading && progressStep && (
        <Card>
          <CardContent className="py-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progressStep}
                </span>
                <span className="text-muted-foreground">{progressPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Results ───────────────────────────────── */}
      {result && (
        <>
          <div className="flex items-center justify-between print:hidden">
            <h2 className="text-lg font-semibold">Analysis Results</h2>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Download className="mr-2 h-4 w-4" /> Export PDF
            </Button>
          </div>
          <PassFailBanner result={result} />
          <SummaryStatisticsSection result={result} />
          {RC && <GenderEffectCharts result={result} RC={RC} />}
          <DimensionBreakdowns
            result={result}
            show={showDimensions}
            onToggle={() => setShowDimensions((p) => !p)}
          />
        </>
      )}

      <Separator className="print:hidden" />

      {/* ─── Report History ────────────────────────── */}
      <div className="print:hidden">
        <ReportHistory
          reports={reports}
          total={reportsTotal}
          loading={reportsLoading}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}

/* ─── Pass/Fail Banner ──────────────────────────────── */

function PassFailBanner({ result }: { result: AnalyzeResponse }) {
  const passes = result.passesEdgeStandard;
  return (
    <Card
      className={
        passes
          ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
          : 'border-red-500 bg-red-50 dark:bg-red-950/20'
      }
    >
      <CardContent className="py-6 flex items-center gap-4">
        {passes ? (
          <CheckCircle2 className="h-10 w-10 text-green-600 shrink-0" />
        ) : (
          <XCircle className="h-10 w-10 text-red-600 shrink-0" />
        )}
        <div>
          <h2
            className={`text-xl font-bold ${passes ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
          >
            {passes ? '✅ PASSES' : '❌ FAILS'} EDGE {result.analysisType} Certification
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {result.name} — {fmtDate(result.snapshotDate)} — Threshold: ±
            {result.summaryStatistics.threshold.toFixed(2)}%
          </p>
          {!passes && (
            <p className="text-sm mt-1 text-red-600 dark:text-red-400">
              {!result.summaryStatistics.salary.isCompliant &&
                'Salary analysis exceeds threshold. '}
              {!result.summaryStatistics.pay.isCompliant && 'Pay analysis exceeds threshold.'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Summary Statistics (Table 2) ─────────────────── */

function SummaryStatisticsSection({ result }: { result: AnalyzeResponse }) {
  const stats = result.summaryStatistics;
  const rows: { label: string; salary: string; pay: string }[] = [
    {
      label: 'Observations',
      salary: String(stats.salary.observations),
      pay: String(stats.pay.observations),
    },
    {
      label: 'Male / Female',
      salary: `${stats.salary.maleCount} / ${stats.salary.femaleCount}`,
      pay: `${stats.pay.maleCount} / ${stats.pay.femaleCount}`,
    },
    {
      label: 'Predictors',
      salary: String(stats.salary.predictorCount),
      pay: String(stats.pay.predictorCount),
    },
    {
      label: 'Adjusted R²',
      salary: stats.salary.adjustedRSquared.toFixed(4),
      pay: stats.pay.adjustedRSquared.toFixed(4),
    },
    {
      label: 'Gender Coefficient (β₁)',
      salary:
        stats.salary.genderCoefficient != null ? stats.salary.genderCoefficient.toFixed(6) : '—',
      pay: stats.pay.genderCoefficient != null ? stats.pay.genderCoefficient.toFixed(6) : '—',
    },
    {
      label: 'Gender Effect %',
      salary: fmtPct(stats.salary.genderEffect),
      pay: fmtPct(stats.pay.genderEffect),
    },
    {
      label: 'Threshold',
      salary: `±${stats.threshold.toFixed(2)}%`,
      pay: `±${stats.threshold.toFixed(2)}%`,
    },
    {
      label: 'Compliant',
      salary: stats.salary.isCompliant ? '✅ Yes' : '❌ No',
      pay: stats.pay.isCompliant ? '✅ Yes' : '❌ No',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">EDGE Summary Statistics (Table 2)</CardTitle>
        <CardDescription>
          Dual regression results — ln(Salary) and ln(Pay) as dependent variables.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Metric</TableHead>
              <TableHead className="text-center">Salary (Base)</TableHead>
              <TableHead className="text-center">Pay (Base + Bonus)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-center">{row.salary}</TableCell>
                <TableCell className="text-center">{row.pay}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ─── Charts ───────────────────────────────────────── */

function GenderEffectCharts({ result, RC }: { result: AnalyzeResponse; RC: RechartsComponents }) {
  const threshold = result.summaryStatistics.threshold;

  // Build dimension chart data — combine salary & pay overall + dimension breakdowns
  const allSalaryDims = [result.salaryAnalysis.overall, ...result.salaryAnalysis.dimensions];
  const allPayDims = [result.payAnalysis.overall, ...result.payAnalysis.dimensions];

  // Salary vs Pay comparison (grouped bar chart)
  const comparisonData = allSalaryDims.map((sDim) => {
    const pDim = allPayDims.find((p) => p.dimension === sDim.dimension);
    return {
      name: sDim.dimension === 'OVERALL' ? 'Overall' : sDim.dimension,
      salary: Number(sDim.genderEffect.toFixed(2)),
      pay: pDim ? Number(pDim.genderEffect.toFixed(2)) : 0,
    };
  });

  // Population split
  const overall = result.salaryAnalysis.overall;
  const popData = [
    { name: 'Male', value: overall.maleCount, fill: '#3b82f6' },
    { name: 'Female', value: overall.femaleCount, fill: '#ec4899' },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Salary vs Pay Comparison */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Gender Effect — Salary vs Pay by Dimension</CardTitle>
          <CardDescription>
            Grouped comparison of gender effect % across all dimensions. Dashed lines show ±
            {threshold.toFixed(1)}% threshold.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <RC.ResponsiveContainer width="100%" height="100%">
              <RC.BarChart
                data={comparisonData}
                layout="vertical"
                margin={{ left: 80, right: 20, top: 10, bottom: 10 }}
              >
                <RC.CartesianGrid strokeDasharray="3 3" />
                <RC.XAxis type="number" tickFormatter={(v: number) => `${v}%`} />
                <RC.YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 12 }} />
                <RC.Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <RC.Legend />
                <RC.ReferenceLine
                  x={threshold}
                  stroke="#ef4444"
                  strokeDasharray="5 5"
                  label={{ value: `+${threshold}%`, fill: '#ef4444', fontSize: 10 }}
                />
                <RC.ReferenceLine
                  x={-threshold}
                  stroke="#ef4444"
                  strokeDasharray="5 5"
                  label={{ value: `-${threshold}%`, fill: '#ef4444', fontSize: 10 }}
                />
                <RC.Bar dataKey="salary" name="Salary" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <RC.Bar dataKey="pay" name="Pay" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </RC.BarChart>
            </RC.ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Gender Effect Bar Chart (salary only — all dimensions) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Salary Gender Effect by Dimension</CardTitle>
          <CardDescription>Green = within threshold, Red = exceeds threshold</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <RC.ResponsiveContainer width="100%" height="100%">
              <RC.BarChart
                data={comparisonData}
                margin={{ left: 10, right: 10, top: 10, bottom: 10 }}
              >
                <RC.CartesianGrid strokeDasharray="3 3" />
                <RC.XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <RC.YAxis tickFormatter={(v: number) => `${v}%`} />
                <RC.Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <RC.ReferenceLine y={threshold} stroke="#ef4444" strokeDasharray="5 5" />
                <RC.ReferenceLine y={-threshold} stroke="#ef4444" strokeDasharray="5 5" />
                <RC.Bar dataKey="salary" name="Salary Effect">
                  {comparisonData.map((entry, i) => (
                    <RC.Cell
                      key={i}
                      fill={Math.abs(entry.salary) > threshold ? '#ef4444' : '#22c55e'}
                    />
                  ))}
                </RC.Bar>
              </RC.BarChart>
            </RC.ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Population Pie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Population Split</CardTitle>
          <CardDescription>Male vs Female employee count in the analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <RC.ResponsiveContainer width="100%" height="100%">
              <RC.PieChart>
                <RC.Pie
                  data={popData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}
                >
                  {popData.map((entry, i) => (
                    <RC.Cell key={i} fill={entry.fill} />
                  ))}
                </RC.Pie>
                <RC.Tooltip />
                <RC.Legend />
              </RC.PieChart>
            </RC.ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Dimension Breakdowns ─────────────────────────── */

function DimensionBreakdowns({
  result,
  show,
  onToggle,
}: {
  result: AnalyzeResponse;
  show: boolean;
  onToggle: () => void;
}) {
  // Merge salary and pay dimensions into a combined view
  const salaryDims = result.salaryAnalysis.dimensions;
  const payDims = result.payAnalysis.dimensions;

  // Group by dimensionType
  const groups: Record<string, { salary: EdgeRegressionResult[]; pay: EdgeRegressionResult[] }> =
    {};
  for (const d of salaryDims) {
    if (!groups[d.dimensionType]) groups[d.dimensionType] = { salary: [], pay: [] };
    groups[d.dimensionType]!.salary.push(d);
  }
  for (const d of payDims) {
    if (!groups[d.dimensionType]) groups[d.dimensionType] = { salary: [], pay: [] };
    groups[d.dimensionType]!.pay.push(d);
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Dimension Breakdowns</CardTitle>
            <CardDescription>
              Sub-analysis by department, function type, and responsibility level.
            </CardDescription>
          </div>
          {show ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </CardHeader>
      {show && (
        <CardContent className="space-y-6">
          {Object.entries(groups).map(([dimType, { salary, pay }]) => (
            <div key={dimType}>
              <h3 className="text-sm font-semibold mb-2 uppercase tracking-wide text-muted-foreground">
                {dimType === 'DEPARTMENT'
                  ? 'By Department'
                  : dimType === 'FUNCTION'
                    ? 'By Function Type'
                    : 'By Responsibility Level'}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dimension</TableHead>
                    <TableHead className="text-center">Population</TableHead>
                    <TableHead className="text-center">M / F</TableHead>
                    <TableHead className="text-center">Salary Effect</TableHead>
                    <TableHead className="text-center">Pay Effect</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salary.map((sDim) => {
                    const pDim = pay.find((p) => p.dimension === sDim.dimension);
                    const bothCompliant = sDim.isCompliant && (pDim?.isCompliant ?? false);
                    return (
                      <TableRow key={sDim.dimension}>
                        <TableCell className="font-medium">{sDim.dimension}</TableCell>
                        <TableCell className="text-center">{sDim.populationSize}</TableCell>
                        <TableCell className="text-center">
                          {sDim.maleCount} / {sDim.femaleCount}
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={
                              Math.abs(sDim.genderEffect) > sDim.threshold
                                ? 'text-red-600 font-medium'
                                : 'text-green-600'
                            }
                          >
                            {fmtPct(sDim.genderEffect)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {pDim ? (
                            <span
                              className={
                                Math.abs(pDim.genderEffect) > pDim.threshold
                                  ? 'text-red-600 font-medium'
                                  : 'text-green-600'
                              }
                            >
                              {fmtPct(pDim.genderEffect)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={bothCompliant ? 'secondary' : 'destructive'}
                            className={bothCompliant ? 'bg-green-500/20 text-green-700' : ''}
                          >
                            {bothCompliant ? 'Pass' : 'Fail'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ))}
          {Object.keys(groups).length === 0 && (
            <p className="text-sm text-muted-foreground">
              No dimension breakdowns available (insufficient data per group).
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/* ─── Report History ───────────────────────────────── */

function ReportHistory({
  reports,
  total,
  loading,
  onRename,
  onDelete,
}: {
  reports: ReportListItem[];
  total: number;
  loading: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');

  const startEdit = (r: ReportListItem) => {
    setEditingId(r.id);
    setEditName(r.name);
  };

  const confirmEdit = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" /> Report History
        </CardTitle>
        <CardDescription>
          {total > 0
            ? `${total} historical EDGE analysis report${total !== 1 ? 's' : ''}`
            : 'No reports yet — run an analysis above.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
          </div>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No EDGE reports found. Run your first analysis above.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Comp</TableHead>
                <TableHead className="text-center">Population</TableHead>
                <TableHead className="text-center">Gender Effect</TableHead>
                <TableHead className="text-center">R²</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {editingId === r.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          className="h-7 text-sm w-48"
                          autoFocus
                        />
                        <button
                          onClick={confirmEdit}
                          className="p-1 text-green-600 hover:text-green-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      r.name
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.compType}</Badge>
                  </TableCell>
                  <TableCell className="text-center">{r.populationSize}</TableCell>
                  <TableCell className="text-center">
                    <span
                      className={
                        Math.abs(r.genderEffect) > r.threshold
                          ? 'text-red-600 font-medium'
                          : 'text-green-600'
                      }
                    >
                      {fmtPct(r.genderEffect)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">{r.adjustedRSquared.toFixed(4)}</TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={r.isCompliant ? 'secondary' : 'destructive'}
                      className={r.isCompliant ? 'bg-green-500/20 text-green-700' : ''}
                    >
                      {r.isCompliant ? 'Pass' : 'Fail'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(r)}
                        className="p-1 text-muted-foreground hover:text-foreground"
                        title="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(r.id)}
                        className="p-1 text-muted-foreground hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
