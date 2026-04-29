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
  TrendingUp,
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
  Download,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
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
  useAnalyzeCohortRootCauseMutation,
  useExplainOutlierMutation,
  useCalculateRemediationsMutation,
  useRemediations,
  useDecideRemediationMutation,
  useApplyRemediationsMutation,
  useForecastProjectionMutation,
  usePayEquityAir,
  usePayEquityMethodology,
  usePayEquityAuditTrail,
  usePayEquityCopilotMutation,
  type PayEquityOverviewData,
  type CohortCell,
  type CohortRootCauseEnvelope,
  type OutlierExplainEnvelope,
  type RemediationRow,
  type ProjectionEnvelope,
  type AirCohort,
  type AuditEvent,
  type CopilotEnvelope,
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

          <CopilotCard />

          <TrustCard
            latestRunId={
              overview.data?.hasData ? (overview.data as PayEquityOverviewData).latestRunId : null
            }
          />
        </TabsContent>

        <TabsContent value="diagnose" className="space-y-4">
          <DiagnosePanel
            latestRunId={
              overview.data?.hasData ? (overview.data as PayEquityOverviewData).latestRunId : null
            }
          />
        </TabsContent>
        <TabsContent value="remediate" className="space-y-4">
          <RemediatePanel
            latestRunId={
              overview.data?.hasData ? (overview.data as PayEquityOverviewData).latestRunId : null
            }
          />
        </TabsContent>
        <TabsContent value="reports" className="space-y-4">
          <ReportsPanel
            latestRunId={
              overview.data?.hasData ? (overview.data as PayEquityOverviewData).latestRunId : null
            }
          />
        </TabsContent>
        <TabsContent value="prevent" className="space-y-4">
          <PreventPanel
            latestRunId={
              overview.data?.hasData ? (overview.data as PayEquityOverviewData).latestRunId : null
            }
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
      <OutliersCard runId={latestRunId} outliers={outliers.data} loading={outliers.isLoading} />
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
  const rootCauseMutation = useAnalyzeCohortRootCauseMutation();
  const { toast } = useToast();
  const [rootCause, setRootCause] = React.useState<CohortRootCauseEnvelope | null>(null);

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

  const handleAnalyze = () => {
    rootCauseMutation.mutate(
      { runId, dimension, group },
      {
        onSuccess: (data) => {
          setRootCause(data.envelope);
          toast({
            title: 'Root-cause analysis complete',
            description: `${data.envelope.output.rootCauses.length} factor(s) identified · confidence ${data.envelope.confidence}`,
          });
        },
        onError: (err) =>
          toast({
            title: "Couldn't analyze root cause",
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  const t = detail.data.statisticalTest;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {dimension} / {group} — {detail.data.rows.length} employees
            {detail.data.truncated && ' (truncated to 50)'}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAnalyze}
              disabled={rootCauseMutation.isPending}
            >
              {rootCauseMutation.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Search className="mr-1 h-3 w-3" />
              )}
              {rootCause ? 'Re-analyze' : 'Analyze root cause'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
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
      <CardContent className="space-y-4">
        {rootCause && (
          <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-baseline justify-between">
              <h4 className="text-sm font-semibold">Root-cause analysis</h4>
              <Badge variant="outline" className="text-xs">
                confidence {rootCause.confidence} · {rootCause.methodology.name}@
                {rootCause.methodology.version}
              </Badge>
            </div>
            {rootCause.warnings.length > 0 && (
              <div className="space-y-1">
                {rootCause.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-700">
                    ⚠ {w.message}
                  </p>
                ))}
              </div>
            )}
            <ol className="space-y-2">
              {rootCause.output.rootCauses.map((rc, i) => (
                <li key={i} className="rounded-md border bg-background p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{rc.factor}</span>
                    <span className="text-xs text-muted-foreground">
                      contribution {(rc.contribution * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{rc.explanation}</p>
                </li>
              ))}
            </ol>
            {rootCause.output.recommendedNextStep && (
              <div className="rounded-md border-l-4 border-primary bg-background p-3 text-sm">
                <span className="font-medium">Next step: </span>
                {rootCause.output.recommendedNextStep}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              {rootCause.citations.length} citation(s) · run {rootCause.runId.slice(-8)}
            </p>
          </div>
        )}
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
  runId,
  outliers,
  loading,
}: {
  runId: string;
  outliers?: ReturnType<typeof usePayEquityOutliers>['data'];
  loading: boolean;
}) {
  const explainMutation = useExplainOutlierMutation();
  const { toast } = useToast();
  const [explanations, setExplanations] = React.useState<Record<string, OutlierExplainEnvelope>>(
    {},
  );
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!outliers) return null;

  const handleExplain = (employeeId: string) => {
    setPendingId(employeeId);
    explainMutation.mutate(
      { runId, employeeId },
      {
        onSuccess: (data) => {
          setExplanations((prev) => ({ ...prev, [employeeId]: data.envelope }));
          setPendingId(null);
        },
        onError: (err) => {
          setPendingId(null);
          toast({
            title: "Couldn't explain outlier",
            description: err.message,
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Outliers — most underpaid in their cohort</CardTitle>
        <CardDescription>
          {outliers.outliers.length === 0
            ? (outliers.reason ?? 'No outliers detected.')
            : 'Lowest compa-ratios within statistically-significant cohorts. Click Explain for an AI-narrated take + recommended action.'}
        </CardDescription>
      </CardHeader>
      {outliers.outliers.length > 0 && (
        <CardContent>
          <div className="space-y-2">
            {outliers.outliers.map((o) => {
              const expl = explanations[o.employeeId];
              const isPending = pendingId === o.employeeId;
              return (
                <div key={o.employeeId} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center gap-3">
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
                      {!expl && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleExplain(o.employeeId)}
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Search className="mr-1 h-3 w-3" />
                          )}
                          Explain
                        </Button>
                      )}
                    </div>
                  </div>
                  {expl && (
                    <div className="mt-3 rounded-md border-l-4 border-primary bg-primary/5 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs">
                        <Badge
                          variant={
                            expl.output.severity === 'high'
                              ? 'destructive'
                              : expl.output.severity === 'medium'
                                ? 'default'
                                : 'outline'
                          }
                          className="text-xs"
                        >
                          {expl.output.severity}
                        </Badge>
                        <span className="text-muted-foreground">
                          confidence {expl.confidence} · {expl.citations.length} citation(s)
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed">{expl.output.paragraph}</p>
                      <div className="mt-2 rounded border-l-2 border-primary/40 pl-2 text-xs">
                        <span className="font-medium">Recommended: </span>
                        {expl.output.recommendedAction}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Remediate Panel (Phase 2) ───────────────────────────────────────

function RemediatePanel({ latestRunId }: { latestRunId: string | null }) {
  const calcMutation = useCalculateRemediationsMutation();
  const { toast } = useToast();
  const [remediationRunId, setRemediationRunId] = React.useState<string | null>(null);
  const [targetGap, setTargetGap] = React.useState('2');
  const [maxPerEmp, setMaxPerEmp] = React.useState('15');
  const [planSummary, setPlanSummary] = React.useState<string>('');

  const handleCalculate = () => {
    if (!latestRunId) return;
    calcMutation.mutate(
      {
        runId: latestRunId,
        targetGapPercent: Number(targetGap) || 2,
        maxPerEmployeePct: Number(maxPerEmp) > 0 ? Number(maxPerEmp) / 100 : undefined,
      },
      {
        onSuccess: (data) => {
          setRemediationRunId(data.runId);
          setPlanSummary(
            `${data.envelope.output.affectedEmployees} adjustment(s) · cost ${Intl.NumberFormat(
              'en-US',
              { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
            ).format(data.envelope.output.totalCost)}`,
          );
          toast({
            title: 'Remediation plan computed',
            description: `${data.envelope.output.affectedEmployees} adjustments proposed · confidence ${data.envelope.confidence}`,
          });
        },
        onError: (err) =>
          toast({
            title: "Couldn't compute remediations",
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  if (!latestRunId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Run an analysis first (Overview tab) to compute remediations.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compute remediation plan</CardTitle>
          <CardDescription>
            Pulls employees in significant cohorts, proposes adjustments toward the cohort mean
            (capped per employee), and gets AI-narrated justifications. Persists as PROPOSED rows
            you approve below before apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="target-gap">Target gap (%)</Label>
              <input
                id="target-gap"
                type="number"
                step="0.1"
                min={0}
                max={50}
                value={targetGap}
                onChange={(e) => setTargetGap(e.target.value)}
                className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="max-per-emp">Max per-employee bump (%)</Label>
              <input
                id="max-per-emp"
                type="number"
                step="0.1"
                min={0}
                max={100}
                value={maxPerEmp}
                onChange={(e) => setMaxPerEmp(e.target.value)}
                className="flex h-9 w-32 rounded-md border border-input bg-transparent px-3 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            {planSummary && <span className="text-sm text-muted-foreground">{planSummary}</span>}
            <Button onClick={handleCalculate} disabled={calcMutation.isPending}>
              {calcMutation.isPending ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Computing…
                </>
              ) : (
                <>
                  <Wrench className="mr-1 h-4 w-4" />
                  {remediationRunId ? 'Re-compute plan' : 'Compute plan'}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {remediationRunId && <RemediationsTable runId={remediationRunId} />}
    </>
  );
}

function RemediationsTable({ runId }: { runId: string }) {
  const remediations = useRemediations(runId);
  const decideMutation = useDecideRemediationMutation();
  const applyMutation = useApplyRemediationsMutation();
  const { toast } = useToast();
  const [showApplyConfirm, setShowApplyConfirm] = React.useState(false);

  if (remediations.isLoading) return <Skeleton className="h-48 w-full" />;
  const rows = remediations.data ?? [];

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const proposedCost = rows
    .filter((r) => r.status === 'PROPOSED')
    .reduce((s, r) => s + r.deltaValue, 0);
  const approvedCost = rows
    .filter((r) => r.status === 'APPROVED')
    .reduce((s, r) => s + r.deltaValue, 0);

  const handleDecide = (r: RemediationRow, decision: 'APPROVED' | 'DECLINED') => {
    decideMutation.mutate(
      { remediationId: r.id, runId, decision },
      {
        onError: (err) =>
          toast({
            title: `Couldn't ${decision === 'APPROVED' ? 'approve' : 'decline'}`,
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  const handleApply = () => {
    applyMutation.mutate(
      { runId },
      {
        onSuccess: (data) => {
          toast({
            title: 'Remediations applied',
            description: `${data.applied} salar${data.applied === 1 ? 'y' : 'ies'} updated · cost ${Intl.NumberFormat(
              'en-US',
              { style: 'currency', currency: 'USD', maximumFractionDigits: 0 },
            ).format(data.totalCost)}`,
          });
          setShowApplyConfirm(false);
        },
        onError: (err) =>
          toast({
            title: "Couldn't apply",
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Proposed adjustments</CardTitle>
            <CardDescription>
              Approve or decline each row. APPROVED rows can be applied to Employee.baseSalary in
              one transaction with full audit trail.
            </CardDescription>
          </div>
          <Button
            size="sm"
            disabled={(counts['APPROVED'] ?? 0) === 0 || applyMutation.isPending}
            onClick={() => setShowApplyConfirm(true)}
          >
            {applyMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Wrench className="mr-1 h-4 w-4" />
            )}
            Apply {counts['APPROVED'] ?? 0} approved
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          {Object.entries(counts).map(([status, n]) => (
            <Badge key={status} variant="outline">
              {status} · {n}
            </Badge>
          ))}
          {(proposedCost > 0 || approvedCost > 0) && (
            <span className="text-muted-foreground">
              Proposed cost{' '}
              {Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }).format(proposedCost)}{' '}
              · Approved cost{' '}
              {Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }).format(approvedCost)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {showApplyConfirm && (
          <div className="mb-4 rounded-md border border-amber-500 bg-amber-50 p-4 text-sm">
            <p className="font-medium">
              Apply {counts['APPROVED'] ?? 0} approved remediation
              {(counts['APPROVED'] ?? 0) === 1 ? '' : 's'}?
            </p>
            <p className="mt-1 text-muted-foreground">
              This writes Employee.baseSalary in a transaction and emits an AuditLog row per change.
              Each remediation flips to APPLIED.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowApplyConfirm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleApply} disabled={applyMutation.isPending}>
                {applyMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Confirm apply
              </Button>
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No remediations.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs">
                <tr>
                  <th className="px-2 py-1.5 text-left">Employee</th>
                  <th className="px-2 py-1.5 text-right">From</th>
                  <th className="px-2 py-1.5 text-right">To</th>
                  <th className="px-2 py-1.5 text-right">Δ</th>
                  <th className="px-2 py-1.5 text-left">Justification</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.employeeCode} · {r.level} · {r.department}
                        {r.currentCompaRatio !== null && ` · CR ${r.currentCompaRatio.toFixed(2)}`}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: r.currency,
                        maximumFractionDigits: 0,
                      }).format(r.fromValue)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">
                      {Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: r.currency,
                        maximumFractionDigits: 0,
                      }).format(r.toValue)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="font-mono text-emerald-600">
                        +
                        {Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: r.currency,
                          maximumFractionDigits: 0,
                        }).format(r.deltaValue)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        +{r.deltaPercent.toFixed(1)}%
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground max-w-xs">
                      {r.justification ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge
                        variant={
                          r.status === 'APPLIED'
                            ? 'default'
                            : r.status === 'APPROVED'
                              ? 'default'
                              : r.status === 'DECLINED'
                                ? 'destructive'
                                : 'outline'
                        }
                        className="text-xs"
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      {r.status === 'PROPOSED' ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDecide(r, 'APPROVED')}
                            disabled={decideMutation.isPending}
                          >
                            ✓
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDecide(r, 'DECLINED')}
                            disabled={decideMutation.isPending}
                          >
                            ✗
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Phase 3 — Reports panel ──────────────────────────────────────

const REPORT_DEFS: Array<{
  type: 'board' | 'eu_ptd' | 'uk_gpg' | 'eeo1' | 'sb1162' | 'auditor' | 'defensibility';
  title: string;
  description: string;
  format: 'PDF' | 'CSV';
}> = [
  {
    type: 'board',
    title: 'Board narrative',
    description: 'Executive summary, headline metrics, cohort findings, methodology box.',
    format: 'PDF',
  },
  {
    type: 'eu_ptd',
    title: 'EU Pay Transparency Directive',
    description: 'Article 9 disclosure (Directive (EU) 2023/970). Reviewed before filing.',
    format: 'CSV',
  },
  {
    type: 'uk_gpg',
    title: 'UK Gender Pay Gap',
    description:
      'Six required figures (Equality Act 2010, 2017 Regulations). Bonus + quartile fields require raw payroll.',
    format: 'CSV',
  },
  {
    type: 'eeo1',
    title: 'EEO-1 Component 1',
    description: 'Federal contractor disclosure. Job-category mapping required for full grid.',
    format: 'CSV',
  },
  {
    type: 'sb1162',
    title: 'California SB 1162 Pay Data',
    description: 'Labor Code §12999 establishment-level rows. Pay-band detail requires raw rates.',
    format: 'CSV',
  },
  {
    type: 'auditor',
    title: 'Auditor defensibility export',
    description:
      'Hashed identifiers, full methodology + regression detail + citation list. Watermarked.',
    format: 'PDF',
  },
  {
    type: 'defensibility',
    title: 'Litigation defensibility export',
    description:
      'Comprehensive: methodology + full regression detail + citations + every audit event + every child agent invocation. Internal use; identifiers NOT hashed.',
    format: 'PDF',
  },
];

function ReportsPanel({ latestRunId }: { latestRunId: string | null }) {
  const { toast } = useToast();
  const [busyType, setBusyType] = React.useState<string | null>(null);

  if (!latestRunId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reports</CardTitle>
          <CardDescription>
            Run a Pay Equity analysis from the Overview tab to enable report exports.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleDownload = async (type: (typeof REPORT_DEFS)[number]['type']) => {
    setBusyType(type);
    try {
      const { blob, fileName } = await apiClient.fetchBlob(
        `/api/v1/pay-equity/runs/${latestRunId}/reports/${type}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        fileName ?? `pay-equity-${type}.${type === 'board' || type === 'auditor' ? 'pdf' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: 'Download failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setBusyType(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reports</CardTitle>
        <CardDescription>
          All exports are generated from the latest run&apos;s immutable envelope and audit-logged
          on download. Statutory CSV templates may have fields marked{' '}
          <code className="font-mono text-xs">not_available</code> until canonical schema gains the
          underlying data (bonus components, hourly rate, race/ethnicity, job category).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {REPORT_DEFS.map((def) => (
          <div
            key={def.type}
            className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{def.title}</span>
                </div>
                <Badge variant="outline" className="mt-1 text-[10px] uppercase">
                  {def.format}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyType !== null}
                onClick={() => void handleDownload(def.type)}
              >
                {busyType === def.type ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                Download
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{def.description}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Phase 4 — Prevent panel ──────────────────────────────────────

function PreventPanel({ latestRunId }: { latestRunId: string | null }) {
  const air = usePayEquityAir(latestRunId);
  const forecastMutation = useForecastProjectionMutation();
  const { toast } = useToast();

  const [horizonMonths, setHorizonMonths] = React.useState(12);
  const [hires, setHires] = React.useState<
    Array<{ level: string; dimension: string; group: string; count: number; meanSalary: number }>
  >([]);
  const [draft, setDraft] = React.useState({
    level: 'L4',
    dimension: 'gender',
    group: 'Male',
    count: 10,
    meanSalary: 120000,
  });

  const [forecast, setForecast] = React.useState<ProjectionEnvelope | null>(null);

  const handleAddHire = () => {
    if (!draft.level || !draft.group || draft.count <= 0) return;
    setHires((prev) => [...prev, { ...draft }]);
  };

  const handleRunForecast = () => {
    forecastMutation.mutate(
      {
        horizonMonths,
        hiringPlan: hires,
        scenarioLabel: hires.length === 0 ? 'Status quo' : undefined,
      },
      {
        onSuccess: (res) => {
          setForecast(res.envelope);
          toast({
            title: 'Forecast computed',
            description: `Projected gap at t+${res.envelope.output.horizonMonths}mo: ${res.envelope.output.projectedGap.toFixed(1)}% (baseline ${res.envelope.output.baselineGap.toFixed(1)}%)`,
          });
        },
        onError: (err) =>
          toast({ title: 'Forecast failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  if (!latestRunId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Predict & Prevent</CardTitle>
          <CardDescription>
            Run a Pay Equity analysis from the Overview tab first; projections + AIR are computed
            from the latest run.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* AIR — 80% rule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adverse Impact Ratio (80% rule)</CardTitle>
          <CardDescription>
            AIR = exp(β) per cohort. AIR &lt; 0.8 indicates adverse impact under the OFCCP
            four-fifths rule. Read-only; computed from the latest run&apos;s regression
            coefficients.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {air.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !air.data || air.data.cohorts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cohorts to evaluate.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2">Cohort</th>
                    <th className="py-2">vs reference</th>
                    <th className="py-2">n</th>
                    <th className="py-2">Gap</th>
                    <th className="py-2">AIR</th>
                    <th className="py-2">80% rule</th>
                  </tr>
                </thead>
                <tbody>
                  {air.data.cohorts.map((c: AirCohort) => (
                    <tr key={`${c.dimension}/${c.group}`} className="border-b last:border-0">
                      <td className="py-2 font-medium">
                        {c.dimension}/{c.group}
                      </td>
                      <td className="py-2 text-muted-foreground">{c.referenceGroup}</td>
                      <td className="py-2">{c.sampleSize}</td>
                      <td className="py-2">{c.gapPercent.toFixed(2)}%</td>
                      <td className="py-2 font-mono">{c.adverseImpactRatio.toFixed(2)}</td>
                      <td className="py-2">
                        {c.passesEightyPercentRule ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                            Pass
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className={
                              c.severity === 'high'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-700'
                            }
                          >
                            Fail
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-muted-foreground">
                {air.data.summary.passing}/{air.data.summary.total} cohorts pass the 80% rule
                {air.data.summary.failing > 0 && ` · ${air.data.summary.failing} failing`}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forecast scenario */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">12-month forecast + hiring impact</CardTitle>
          <CardDescription>
            Linear extrapolation of the worst-cohort gap from recent runs. Add hires to model their
            effect on the projected trajectory. AI agent narrates drivers + actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="horizon">Horizon (months)</Label>
              <input
                id="horizon"
                type="number"
                min={1}
                max={36}
                value={horizonMonths}
                onChange={(e) => setHorizonMonths(Math.max(1, parseInt(e.target.value, 10) || 12))}
                className="mt-1 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-sm font-medium">Hiring scenario</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <input
                placeholder="Level"
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <input
                placeholder="Dimension"
                value={draft.dimension}
                onChange={(e) => setDraft({ ...draft, dimension: e.target.value })}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <input
                placeholder="Group"
                value={draft.group}
                onChange={(e) => setDraft({ ...draft, group: e.target.value })}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <input
                type="number"
                min={1}
                placeholder="Count"
                value={draft.count}
                onChange={(e) =>
                  setDraft({ ...draft, count: Math.max(1, parseInt(e.target.value, 10) || 1) })
                }
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
              <input
                type="number"
                min={0}
                placeholder="Mean salary"
                value={draft.meanSalary}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    meanSalary: Math.max(0, parseInt(e.target.value, 10) || 0),
                  })
                }
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={handleAddHire}>
                Add to plan
              </Button>
              {hires.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {hires.length} item{hires.length === 1 ? '' : 's'} in plan
                </span>
              )}
            </div>
            {hires.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {hires.map((h, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span>
                      {h.count}× {h.dimension}/{h.group} at {h.level} (mean{' '}
                      {h.meanSalary.toLocaleString()})
                    </span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setHires((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✗
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-end">
            <Button size="sm" onClick={handleRunForecast} disabled={forecastMutation.isPending}>
              {forecastMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <TrendingUp className="mr-1 h-4 w-4" />
              )}
              Run forecast
            </Button>
          </div>

          {forecast && (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {forecast.output.scenarioLabel} ·{' '}
                  <span
                    className={
                      forecast.output.riskLevel === 'high'
                        ? 'text-red-700'
                        : forecast.output.riskLevel === 'medium'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }
                  >
                    {forecast.output.riskLevel} risk
                  </span>
                </div>
                <p className="mt-1 text-sm">{forecast.output.narrative}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Today</div>
                  <div className="font-mono">{forecast.output.baselineGap.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    t+{forecast.output.horizonMonths}mo
                  </div>
                  <div className="font-mono">{forecast.output.projectedGap.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">95% CI low</div>
                  <div className="font-mono text-muted-foreground">
                    {forecast.output.confidenceLow.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">95% CI high</div>
                  <div className="font-mono text-muted-foreground">
                    {forecast.output.confidenceHigh.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Sparkline-style projected series */}
              <div className="rounded-md bg-background p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Projected series
                </div>
                <div className="flex items-end gap-2">
                  {forecast.output.monthlySeries.map((p) => {
                    const max = Math.max(
                      ...forecast.output.monthlySeries.map((q) => Math.abs(q.projectedGapPercent)),
                      Math.abs(forecast.output.baselineGap),
                      1,
                    );
                    const h = Math.max(8, (Math.abs(p.projectedGapPercent) / max) * 80);
                    return (
                      <div key={p.monthsFromNow} className="flex flex-col items-center text-xs">
                        <div
                          className="w-10 rounded-t bg-primary/70"
                          style={{ height: `${h}px` }}
                          title={`${p.projectedGapPercent.toFixed(2)}%`}
                        />
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          t+{p.monthsFromNow}mo
                        </div>
                        <div className="font-mono text-[10px]">
                          {p.projectedGapPercent.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {forecast.output.drivers.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Drivers
                  </div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {forecast.output.drivers.map((d, i) => (
                      <li key={i}>
                        <span className="font-medium">{d.factor}</span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {d.expectedDelta > 0 ? '+' : ''}
                          {d.expectedDelta.toFixed(2)}pp
                        </span>
                        <span className="ml-2 text-muted-foreground">{d.explanation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {forecast.output.recommendedActions.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Recommended actions
                  </div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {forecast.output.recommendedActions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Badge
                          variant="outline"
                          className={
                            a.priority === 'high'
                              ? 'bg-red-50 text-red-700'
                              : a.priority === 'medium'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-emerald-50 text-emerald-700'
                          }
                        >
                          {a.priority}
                        </Badge>
                        <span>
                          <span className="font-medium">{a.action}</span>
                          <span className="ml-2 text-muted-foreground">{a.rationale}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Phase 5 — Trust card ──────────────────────────────────────────

function TrustCard({ latestRunId }: { latestRunId: string | null }) {
  const meth = usePayEquityMethodology(latestRunId);
  const audit = usePayEquityAuditTrail(latestRunId);
  const [showAudit, setShowAudit] = React.useState(false);

  if (!latestRunId) return null;
  if (meth.isLoading) return <Skeleton className="h-32 w-full" />;
  if (!meth.data) return null;

  const m = meth.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Trust & methodology</CardTitle>
            <CardDescription>
              What was done, by what model, on what data — auditor- and litigation-ready.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono">
            {m.methodology.fullName}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Sample size</div>
            <div className="font-semibold">{m.methodology.sampleSize.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Cohorts</div>
            <div className="font-semibold">{m.headline.cohortsEvaluated}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Significant gaps</div>
            <div className="font-semibold">{m.headline.significantGaps}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Citations</div>
            <div className="font-semibold">{m.citationCount}</div>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
            Methodology
          </div>
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Dependent variable:</span>{' '}
              <code className="font-mono">{m.methodology.dependentVariable}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Controls:</span>{' '}
              {m.methodology.controls.length === 0 ? (
                <span className="italic text-muted-foreground">none recorded</span>
              ) : (
                m.methodology.controls.map((c, i) => (
                  <span key={c}>
                    <code className="font-mono">{c}</code>
                    {i < m.methodology.controls.length - 1 ? ', ' : ''}
                  </span>
                ))
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Confidence interval:</span>{' '}
              {(m.methodology.confidenceInterval * 100).toFixed(0)}%
              {m.methodology.complianceThreshold !== null && (
                <>
                  {' '}
                  · <span className="text-muted-foreground">Compliance threshold:</span> ±
                  {m.methodology.complianceThreshold}%
                </>
              )}
            </div>
            {m.headline.confidence && (
              <div>
                <span className="text-muted-foreground">Confidence level:</span>{' '}
                <Badge
                  variant="outline"
                  className={
                    m.headline.confidence === 'high'
                      ? 'bg-emerald-50 text-emerald-700'
                      : m.headline.confidence === 'medium'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-red-700'
                  }
                >
                  {m.headline.confidence}
                </Badge>
              </div>
            )}
          </div>
        </div>

        {m.agentInvocations.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Agent invocations on this run
            </div>
            <div className="space-y-1">
              {m.agentInvocations.slice(0, 6).map((a) => (
                <div key={a.runId} className="flex items-center justify-between text-xs">
                  <span>
                    <Badge variant="outline" className="mr-2 font-mono">
                      {a.agentType}
                    </Badge>
                    {a.summary ?? a.runId}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(a.createdAt).toISOString().slice(0, 10)} · {a.status}
                  </span>
                </div>
              ))}
              {m.agentInvocations.length > 6 && (
                <div className="text-xs italic text-muted-foreground">
                  + {m.agentInvocations.length - 6} more — see audit trail
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => setShowAudit((v) => !v)}
          >
            {showAudit ? '▾' : '▸'} Audit trail ({audit.data?.total ?? 0} events)
          </button>
          {showAudit && audit.data && (
            <div className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1">at</th>
                    <th className="px-2 py-1">action</th>
                    <th className="px-2 py-1">entity</th>
                    <th className="px-2 py-1">user</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.events.slice(0, 100).map((e: AuditEvent) => (
                    <tr key={e.id} className="border-t">
                      <td className="px-2 py-1 font-mono text-[10px]">
                        {new Date(e.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="px-2 py-1 font-mono text-[10px]">{e.action}</td>
                      <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                        {e.entityType}/{e.entityId.slice(0, 8)}…
                      </td>
                      <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                        {e.userId?.slice(0, 8) ?? 'system'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {audit.data.events.length > 100 && (
                <div className="px-2 py-1 text-[10px] italic text-muted-foreground">
                  Showing 100 of {audit.data.events.length}. Download the defensibility export for
                  the full record.
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Phase 6.3 — Manager Equity Copilot card ────────────────────

function CopilotCard() {
  const { toast } = useToast();
  const copilot = usePayEquityCopilotMutation();
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState<CopilotEnvelope | null>(null);

  const SUGGESTED = [
    'Is anyone on my team underpaid relative to their cohort?',
    "What's the worst pay equity gap across the company right now?",
    'Which of my reports has the lowest compa-ratio?',
  ];

  const ask = (q: string) => {
    if (!q.trim()) return;
    copilot.mutate(
      { question: q.trim() },
      {
        onSuccess: (res) => {
          setAnswer(res.envelope);
          if (res.envelope.output.refused) {
            toast({
              title: 'Out of scope',
              description: res.envelope.output.refusalReason ?? 'Copilot refused this question.',
              variant: 'destructive',
            });
          }
        },
        onError: (err) =>
          toast({ title: 'Copilot failed', description: err.message, variant: 'destructive' }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manager equity copilot</CardTitle>
        <CardDescription>
          Bounded Q&A about your team or the org&apos;s pay equity state. The copilot only answers
          using data from this workspace — out-of-scope questions are politely refused.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea
            placeholder="Ask about your team or org PE state…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                ask(question);
              }
            }}
            rows={2}
            className="resize-none text-sm"
          />
          <Button
            size="sm"
            disabled={copilot.isPending || question.trim().length < 3}
            onClick={() => ask(question)}
          >
            {copilot.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Ask
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              disabled={copilot.isPending}
              className="rounded-full border border-input bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>

        {answer && (
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  answer.output.refused
                    ? 'bg-amber-50 text-amber-700'
                    : answer.output.scope === 'team'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-blue-50 text-blue-700'
                }
              >
                {answer.output.refused ? 'refused' : answer.output.scope}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Confidence: {answer.confidence} · {answer.citations.length} citations
              </span>
            </div>

            <p className="whitespace-pre-wrap text-sm">{answer.output.answer}</p>

            {answer.output.highlights.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {answer.output.highlights.map((h, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-background p-2 text-xs"
                  >
                    <div className="text-muted-foreground">{h.label}</div>
                    <div className="font-mono text-sm">{h.value}</div>
                    {h.detail && <div className="text-muted-foreground">{h.detail}</div>}
                  </div>
                ))}
              </div>
            )}

            {answer.output.followUpSuggestions.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Follow-up
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {answer.output.followUpSuggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setQuestion(s);
                        ask(s);
                      }}
                      disabled={copilot.isPending}
                      className="rounded-full border border-input bg-background px-3 py-1 text-xs hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
