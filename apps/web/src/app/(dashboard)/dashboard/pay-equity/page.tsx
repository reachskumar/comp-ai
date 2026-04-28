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
  type PayEquityOverviewData,
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

        <TabsContent value="diagnose">
          <PhasePlaceholder
            phase="Phase 1"
            title="Diagnose"
            description="Multi-dim cohort matrix, drill-down to row level, cohort root-cause AI, statistical tests panel, outlier explainer."
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
