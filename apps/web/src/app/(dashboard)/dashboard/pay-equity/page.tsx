'use client';

/**
 * Pay Equity Workspace — Phase 0 shell.
 *
 * 5-tab structure (Overview / Diagnose / Remediate / Reports / Prevent)
 * with a persistent status bar that shows the latest run's headline numbers.
 * Phase 0 wires only the Overview tab; subsequent phases fill in the others.
 *
 * The legacy /dashboard/analytics/pay-equity page continues to work; this is
 * the new workspace alongside it. Navigation entry: "Pay Equity" (new) under
 * AI Features in navigation.ts.
 *
 * See PAY_EQUITY_CONTEXT.md § 4 for the phase plan.
 */

import * as React from 'react';
import {
  Scale,
  Play,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Users,
  ShieldAlert,
  Loader2,
  Activity,
  Search,
  Wrench,
  FileText,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  usePayEquityOverview,
  usePayEquityRuns,
  useRunPayEquityAnalysisMutation,
  usePayEquityTrend,
  usePayEquityCohorts,
  usePayEquityCohortDetail,
  usePayEquityOutliers,
  type PayEquityOverviewData,
  type CohortCell,
} from '@/hooks/use-pay-equity';

const ALL_DIMENSIONS = [
  { value: 'gender', label: 'Gender' },
  { value: 'ethnicity', label: 'Ethnicity' },
  { value: 'age_band', label: 'Age band' },
  { value: 'department', label: 'Department' },
  { value: 'location', label: 'Location' },
] as const;

export default function PayEquityWorkspacePage() {
  const overview = usePayEquityOverview();
  const runs = usePayEquityRuns();
  const runMutation = useRunPayEquityAnalysisMutation();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = React.useState('overview');
  const [selectedDims, setSelectedDims] = React.useState<string[]>(['gender']);
  const [note, setNote] = React.useState('');
  const [threshold, setThreshold] = React.useState('2');

  const toggleDim = (v: string) =>
    setSelectedDims((prev) => (prev.includes(v) ? prev.filter((d) => d !== v) : [...prev, v]));

  const handleRun = () => {
    if (selectedDims.length === 0) return;
    runMutation.mutate(
      {
        dimensions: selectedDims,
        targetThreshold: Number(threshold) || 2,
        note: note.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          const env = data.envelope;
          const wcount = env.warnings.length;
          toast({
            title: 'Pay equity analysis complete',
            description:
              env.confidence === 'low'
                ? `Confidence is LOW${wcount ? ` — ${wcount} warning(s)` : ''}. Check sample sizes.`
                : `Confidence ${env.confidence}${wcount ? ` · ${wcount} warning(s)` : ''}`,
          });
          setNote('');
          setActiveTab('overview');
        },
        onError: (err) =>
          toast({
            title: 'Analysis failed',
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Scale className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pay Equity Workspace</h1>
            <p className="text-sm text-muted-foreground">
              Diagnose, remediate, report, and prevent compensation gaps. Auditor-defensible by
              design — every claim cited, every methodology versioned.
            </p>
          </div>
        </div>
      </div>

      {/* Persistent status bar */}
      <StatusBar overview={overview.data} loading={overview.isLoading} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="mr-1 h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="diagnose">
            <Search className="mr-1 h-4 w-4" />
            Diagnose
          </TabsTrigger>
          <TabsTrigger value="remediate">
            <Wrench className="mr-1 h-4 w-4" />
            Remediate
          </TabsTrigger>
          <TabsTrigger value="reports">
            <FileText className="mr-1 h-4 w-4" />
            Reports
          </TabsTrigger>
          <TabsTrigger value="prevent">
            <Eye className="mr-1 h-4 w-4" />
            Prevent
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Run controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run analysis</CardTitle>
              <CardDescription>
                Pick the protected-class dimensions to evaluate. The result lands here as a
                PayEquityRun row — saved, citable, and queryable for the trend chart.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Dimensions</Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_DIMENSIONS.map((d) => {
                    const on = selectedDims.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        onClick={() => toggleDim(d.value)}
                        className={
                          'rounded-full border px-3 py-1 text-xs transition-colors ' +
                          (on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-background hover:bg-muted')
                        }
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="threshold">Target threshold (%)</Label>
                  <input
                    id="threshold"
                    type="number"
                    step="0.1"
                    min={0}
                    max={50}
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea
                  id="note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Recorded with the run for audit trail"
                  maxLength={500}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleRun}
                  disabled={runMutation.isPending || selectedDims.length === 0}
                >
                  {runMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <Play className="mr-1 h-4 w-4" />
                      Run analysis
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent runs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription>
                Every analysis is persisted with its methodology version and citations for audit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runs.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : !runs.data?.items.length ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No runs yet — kick off the first analysis above.
                </p>
              ) : (
                <div className="space-y-2">
                  {runs.data.items.slice(0, 5).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">
                          {r.methodologyName}@{r.methodologyVersion}
                        </Badge>
                        <span>{r.summary ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>n={r.sampleSize}</span>
                        <span>{new Date(r.createdAt).toLocaleString()}</span>
                        <Badge
                          variant={r.status === 'COMPLETE' ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {r.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnose" className="space-y-4">
          <DiagnosePanel
            latestRunId={
              overview.data?.hasData ? (overview.data as PayEquityOverviewData).latestRunId : null
            }
          />
        </TabsContent>
        <TabsContent value="remediate">
          <PhasePlaceholder
            phase="Phase 2"
            title="Remediate"
            description="Cost-to-close slider, optimal remediation AI, phased plan, apply as ad-hoc cycle, generate per-employee letters."
          />
        </TabsContent>
        <TabsContent value="reports">
          <PhasePlaceholder
            phase="Phase 3"
            title="Reports"
            description="Board narrative PDF, EU PTD, UK GPG, EEO-1, CA SB 1162, comp committee deck, scheduled delivery."
          />
        </TabsContent>
        <TabsContent value="prevent">
          <PhasePlaceholder
            phase="Phase 4"
            title="Predict & Prevent"
            description="Forward-looking gap projection, hiring impact modeler, in-cycle warnings, manager equity dashboard."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Status bar ─────────────────────────────────────────────────

function StatusBar({
  overview,
  loading,
}: {
  overview: ReturnType<typeof usePayEquityOverview>['data'];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!overview || !overview.hasData) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {overview?.message ?? 'No pay equity analysis has been run yet.'}
        </CardContent>
      </Card>
    );
  }

  const data = overview as PayEquityOverviewData;
  const trend = data.delta?.worstGapPercentDelta ?? 0;
  const trendIsImproving = Math.abs(data.worstGapPercent + trend) < Math.abs(data.worstGapPercent);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<TrendingUp className="h-4 w-4" />}
        title="Worst adjusted gap"
        value={`${data.worstGapPercent > 0 ? '+' : ''}${data.worstGapPercent}%`}
        subtitle={data.worstCohort}
        delta={
          data.delta
            ? {
                value: data.delta.worstGapPercentDelta,
                isGood: trendIsImproving,
              }
            : null
        }
        tone={Math.abs(data.worstGapPercent) > 5 ? 'warn' : 'normal'}
      />
      <StatCard
        icon={<Activity className="h-4 w-4" />}
        title="Significance"
        value={data.worstPValue < 0.05 ? `p=${data.worstPValue.toFixed(3)}` : 'not sig.'}
        subtitle={`n=${data.totalEmployees}`}
      />
      <StatCard
        icon={<Users className="h-4 w-4" />}
        title="At-risk employees"
        value={String(data.atRiskEmployees)}
        subtitle={`${data.significantCount} significant cohort(s)`}
        tone={data.atRiskEmployees > 0 ? 'warn' : 'normal'}
      />
      <StatCard
        icon={<ShieldAlert className="h-4 w-4" />}
        title="Confidence"
        value={data.confidence}
        subtitle={
          data.warningCount > 0
            ? `${data.warningCount} warning(s) — see latest run`
            : `Methodology: ${data.methodology}`
        }
        tone={data.confidence === 'low' ? 'warn' : 'normal'}
      />
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  delta,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle?: string;
  delta?: { value: number; isGood: boolean } | null;
  tone?: 'warn' | 'normal';
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs">
          {icon}
          {title}
        </CardDescription>
        <div className="flex items-baseline gap-2">
          <CardTitle className={`text-2xl ${tone === 'warn' ? 'text-amber-600' : ''}`}>
            {value}
          </CardTitle>
          {delta && (
            <span
              className={
                'flex items-center text-xs ' +
                (delta.isGood ? 'text-emerald-600' : 'text-destructive')
              }
            >
              {delta.value >= 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {delta.value >= 0 ? '+' : ''}
              {delta.value.toFixed(2)}
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
    </Card>
  );
}

function PhasePlaceholder({
  phase,
  title,
  description,
}: {
  phase: string;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-12 text-center">
        <div className="mb-3 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {phase}
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3 w-3" />
          Tracked in PAY_EQUITY_CONTEXT.md — not yet shipped
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Diagnose Panel (Phase 1) ──────────────────────────────────────────

function DiagnosePanel({ latestRunId }: { latestRunId: string | null }) {
  const trend = usePayEquityTrend(undefined, 12);
  const cohorts = usePayEquityCohorts(latestRunId);
  const outliers = usePayEquityOutliers(latestRunId, undefined, 10);
  const [selected, setSelected] = React.useState<{ dimension: string; group: string } | null>(null);

  if (!latestRunId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Run an analysis first (Overview tab) to see diagnostics.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <TrendCard trend={trend.data} loading={trend.isLoading} />
      <CohortMatrixCard
        cohorts={cohorts.data}
        loading={cohorts.isLoading}
        selected={selected}
        onSelect={setSelected}
      />
      {selected && (
        <CohortDetailCard
          runId={latestRunId}
          dimension={selected.dimension}
          group={selected.group}
          onClose={() => setSelected(null)}
        />
      )}
      <OutliersCard outliers={outliers.data} loading={outliers.isLoading} />
    </>
  );
}

function TrendCard({
  trend,
  loading,
}: {
  trend?: ReturnType<typeof usePayEquityTrend>['data'];
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (!trend || trend.series.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trend (last runs)</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Need at least 2 completed runs for a trend.
        </CardContent>
      </Card>
    );
  }
  const series = trend.series;
  const max = Math.max(...series.map((p) => Math.abs(p.worstGapPercent)), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Worst-cohort gap over time</CardTitle>
        <CardDescription>
          Latest {series.length} runs. Methodology version shifts shown as separators.
          {trend.methodologyShifts.length > 0 &&
            ` ${trend.methodologyShifts.length} shift(s) in this window.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex h-32 items-end gap-1">
          {series.map((p, i) => {
            const h = Math.max(4, (Math.abs(p.worstGapPercent) / max) * 100);
            const isShift = trend.methodologyShifts.includes(i);
            return (
              <div
                key={p.runId}
                className="group flex flex-1 flex-col items-center justify-end"
                title={`${new Date(p.at).toLocaleDateString()} · ${p.worstGapPercent}% (${p.worstCohort ?? '—'}) · ${p.methodology}`}
              >
                <div
                  className={
                    'w-full rounded-t-sm transition-all ' +
                    (Math.abs(p.worstGapPercent) > 5
                      ? 'bg-amber-500/70'
                      : Math.abs(p.worstGapPercent) > 2
                        ? 'bg-primary/60'
                        : 'bg-emerald-500/60')
                  }
                  style={{ height: `${h}%` }}
                />
                <span className="mt-1 text-[10px] text-muted-foreground">
                  {p.worstGapPercent.toFixed(1)}%
                  {isShift && <span className="ml-1 text-amber-600">↺</span>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{new Date(series[0]!.at).toLocaleDateString()}</span>
          <span>{new Date(series[series.length - 1]!.at).toLocaleDateString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CohortMatrixCard({
  cohorts,
  loading,
  selected,
  onSelect,
}: {
  cohorts?: ReturnType<typeof usePayEquityCohorts>['data'];
  loading: boolean;
  selected: { dimension: string; group: string } | null;
  onSelect: (s: { dimension: string; group: string }) => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!cohorts) return null;
  if (cohorts.cells.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cohort matrix</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No cohorts in this run.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cohort matrix</CardTitle>
        <CardDescription>
          Click a cell to drill into the employee rows behind it. Suppressed cells (n &lt; 5) are
          greyed out per k-anonymity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {cohorts.dimensions.map((dim) => (
            <div key={dim}>
              <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{dim}</div>
              <div className="flex flex-wrap gap-2">
                {cohorts.cells
                  .filter((c) => c.dimension === dim)
                  .map((c) => (
                    <CohortCellButton
                      key={`${c.dimension}-${c.group}`}
                      cell={c}
                      isSelected={selected?.dimension === c.dimension && selected.group === c.group}
                      onClick={() => onSelect({ dimension: c.dimension, group: c.group })}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
        {cohorts.warnings.length > 0 && (
          <div className="mt-4 space-y-1">
            {cohorts.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600">
                ⚠ {w.message}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CohortCellButton({
  cell,
  isSelected,
  onClick,
}: {
  cell: CohortCell;
  isSelected: boolean;
  onClick: () => void;
}) {
  if (cell.suppressed) {
    return (
      <div
        className="cursor-not-allowed rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        title={`Suppressed: n=${cell.sampleSize} below k=5 threshold`}
      >
        {cell.group} · n &lt; 5
      </div>
    );
  }
  const tone =
    Math.abs(cell.gapPercent) > 5
      ? 'border-destructive bg-destructive/10 text-destructive'
      : Math.abs(cell.gapPercent) > 2
        ? 'border-amber-500 bg-amber-50 text-amber-900'
        : 'border-emerald-500 bg-emerald-50 text-emerald-900';
  return (
    <button
      onClick={onClick}
      className={
        'rounded-md border px-3 py-2 text-left text-xs transition-all ' +
        tone +
        (isSelected ? ' ring-2 ring-primary ring-offset-1' : ' hover:opacity-80')
      }
    >
      <div className="font-semibold">{cell.group}</div>
      <div>
        {cell.gapPercent > 0 ? '+' : ''}
        {cell.gapPercent}% · n={cell.sampleSize}
      </div>
      <div className="text-[10px] opacity-70">
        p={cell.pValue.toFixed(3)} · {cell.significance}
      </div>
    </button>
  );
}

function CohortDetailCard({
  runId,
  dimension,
  group,
  onClose,
}: {
  runId: string;
  dimension: string;
  group: string;
  onClose: () => void;
}) {
  const detail = usePayEquityCohortDetail(runId, dimension, group);

  if (detail.isLoading) return <Skeleton className="h-56 w-full" />;
  if (!detail.data) return null;

  if (detail.data.suppressed) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {dimension} / {group} — suppressed
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
          <CardDescription className="text-amber-600">
            {detail.data.suppressionReason}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const t = detail.data.statisticalTest;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {dimension} / {group} — {detail.data.rows.length} employees
            {detail.data.truncated && ' (truncated to 50)'}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <CardDescription>
          β={t.coefficient.toFixed(3)} · SE={t.standardError.toFixed(3)} · p={t.pValue.toFixed(4)}
          {' · CI '}[{t.confidenceInterval[0]}, {t.confidenceInterval[1]}] · n={t.sampleSize}
          {' · '}
          <span
            className={
              t.significance === 'significant'
                ? 'text-destructive'
                : t.significance === 'marginal'
                  ? 'text-amber-600'
                  : 'text-emerald-600'
            }
          >
            {t.significance}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs">
              <tr>
                <th className="px-2 py-1.5 text-left">Code</th>
                <th className="px-2 py-1.5 text-left">Name</th>
                <th className="px-2 py-1.5 text-left">Dept</th>
                <th className="px-2 py-1.5 text-left">Level</th>
                <th className="px-2 py-1.5 text-right">Salary</th>
                <th className="px-2 py-1.5 text-right">CR</th>
                <th className="px-2 py-1.5 text-right">Perf</th>
              </tr>
            </thead>
            <tbody>
              {detail.data.rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-2 py-1.5 font-mono text-xs">{r.employeeCode}</td>
                  <td className="px-2 py-1.5">{r.name}</td>
                  <td className="px-2 py-1.5">{r.department}</td>
                  <td className="px-2 py-1.5">{r.level}</td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: r.currency,
                      maximumFractionDigits: 0,
                    }).format(r.baseSalary)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.compaRatio !== null ? r.compaRatio.toFixed(2) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.performanceRating !== null ? r.performanceRating.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OutliersCard({
  outliers,
  loading,
}: {
  outliers?: ReturnType<typeof usePayEquityOutliers>['data'];
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!outliers) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outliers — most underpaid in their cohort</CardTitle>
        <CardDescription>
          {outliers.outliers.length === 0
            ? (outliers.reason ?? 'No outliers detected.')
            : `Lowest compa-ratios within statistically-significant cohorts. AI explainer in Phase 1.5.`}
        </CardDescription>
      </CardHeader>
      {outliers.outliers.length > 0 && (
        <CardContent>
          <div className="space-y-2">
            {outliers.outliers.map((o) => (
              <div
                key={o.employeeId}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-xs">
                    CR {o.compaRatio.toFixed(2)}
                  </Badge>
                  <div>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {o.employeeCode} · {o.level} · {o.department}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs">
                    {Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: o.currency,
                      maximumFractionDigits: 0,
                    }).format(o.baseSalary)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.cohort.dimension}/{o.cohort.group} · {o.gapPercent}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
