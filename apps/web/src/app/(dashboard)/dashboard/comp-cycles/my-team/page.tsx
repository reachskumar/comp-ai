'use client';

import * as React from 'react';
import {
  Users,
  AlertCircle,
  Loader2,
  DollarSign,
  TrendingUp,
  Save,
  Wand2,
  ArrowLeft,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  useCycleList,
  useMyTeam,
  useSaveTeamRecommendationsMutation,
  type MyTeamMember,
} from '@/hooks/use-cycles';
import Link from 'next/link';

// Per-row form draft. Either percent OR absolute is the source of truth based
// on `mode`. Comp ratio + status badges are derived for display only.
interface RowDraft {
  employeeId: string;
  mode: 'percent' | 'absolute';
  percent: string;
  absolute: string;
  justification: string;
  // Snapshot of the persisted rec at hydration time, so we can detect dirty.
  persistedProposed: number;
  persistedJustification: string;
  // Set by the manager-typed inputs so we can compute "is dirty".
  dirty: boolean;
}

function fmt(n: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function computeProposed(member: MyTeamMember, draft: RowDraft): number {
  const cur = member.employee.currentSalary;
  if (draft.mode === 'absolute') {
    const v = Number(draft.absolute);
    return Number.isFinite(v) ? v : cur;
  }
  const pct = Number(draft.percent);
  if (!Number.isFinite(pct)) return cur;
  return Math.round(cur * (1 + pct / 100) * 100) / 100;
}

export default function MyTeamPage() {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const initialCycleId = React.useMemo(() => {
    if (!search) return null;
    return new URLSearchParams(search).get('cycleId');
  }, [search]);

  const [cycleId, setCycleId] = React.useState<string | null>(initialCycleId);
  const cyclesQuery = useCycleList();
  const myTeamQuery = useMyTeam(cycleId);
  const saveMutation = useSaveTeamRecommendationsMutation();
  const { toast } = useToast();

  // Default to the first ACTIVE/CALIBRATION cycle.
  React.useEffect(() => {
    if (cycleId || !cyclesQuery.data) return;
    const active = cyclesQuery.data.data.find(
      (c) => c.status === 'ACTIVE' || c.status === 'CALIBRATION' || c.status === 'PLANNING',
    );
    if (active) setCycleId(active.id);
  }, [cyclesQuery.data, cycleId]);

  // Hydrate row drafts from server response.
  const [drafts, setDrafts] = React.useState<Record<string, RowDraft>>({});
  React.useEffect(() => {
    if (!myTeamQuery.data) return;
    const next: Record<string, RowDraft> = {};
    for (const m of myTeamQuery.data.members) {
      const cur = m.employee.currentSalary;
      const proposed = m.recommendation?.proposedValue ?? cur;
      const just = m.recommendation?.justification ?? '';
      const pct = cur > 0 ? Math.round(((proposed - cur) / cur) * 10000) / 100 : 0;
      next[m.employee.id] = {
        employeeId: m.employee.id,
        mode: 'percent',
        percent: String(pct),
        absolute: String(proposed),
        justification: just,
        persistedProposed: proposed,
        persistedJustification: just,
        dirty: false,
      };
    }
    setDrafts(next);
  }, [myTeamQuery.data]);

  const updateDraft = (employeeId: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => {
      const cur = prev[employeeId];
      if (!cur) return prev;
      return { ...prev, [employeeId]: { ...cur, ...patch, dirty: true } };
    });
  };

  const applyBulkPct = (pct: number) => {
    setDrafts((prev) => {
      const next: Record<string, RowDraft> = {};
      for (const [id, d] of Object.entries(prev)) {
        next[id] = { ...d, mode: 'percent', percent: String(pct), dirty: true };
      }
      return next;
    });
  };

  const dirtyDrafts = React.useMemo(() => Object.values(drafts).filter((d) => d.dirty), [drafts]);

  const totalProposedDelta = React.useMemo(() => {
    if (!myTeamQuery.data) return 0;
    let sum = 0;
    for (const m of myTeamQuery.data.members) {
      const d = drafts[m.employee.id];
      if (!d) continue;
      const proposed = computeProposed(m, d);
      sum += proposed - m.employee.currentSalary;
    }
    return sum;
  }, [myTeamQuery.data, drafts]);

  const handleSave = () => {
    if (!cycleId || !myTeamQuery.data) return;
    const recs = myTeamQuery.data.members
      .filter((m) => {
        const d = drafts[m.employee.id];
        if (!d || !d.dirty) return false;
        const proposed = computeProposed(m, d);
        // Save even if proposed === current — manager may want a 0% rec on file.
        return Number.isFinite(proposed) && proposed > 0;
      })
      .map((m) => {
        const d = drafts[m.employee.id]!;
        return {
          employeeId: m.employee.id,
          recType: 'MERIT_INCREASE' as const,
          currentValue: m.employee.currentSalary,
          proposedValue: computeProposed(m, d),
          justification: d.justification.trim() || null,
        };
      });
    if (recs.length === 0) {
      toast({ title: 'Nothing to save', description: 'No rows have changed.' });
      return;
    }
    saveMutation.mutate(
      { cycleId, recommendations: recs },
      {
        onSuccess: (data) => {
          toast({
            title: 'Recommendations saved',
            description: `${data.created} created · ${data.updated} updated`,
          });
        },
        onError: (err) =>
          toast({
            title: "Couldn't save",
            description: err.message,
            variant: 'destructive',
          }),
      },
    );
  };

  const cycles = cyclesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/comp-cycles/active">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">My Team — Planning Workspace</h1>
          <p className="text-sm text-muted-foreground">
            Propose increases for your direct reports.{' '}
            {myTeamQuery.data ? (
              <>
                Cycle:{' '}
                <span className="font-medium text-foreground">{myTeamQuery.data.cycle.name}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/* Cycle picker */}
      {cycles.length > 1 && (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Label htmlFor="cycle-pick" className="whitespace-nowrap">
              Cycle:
            </Label>
            <select
              id="cycle-pick"
              value={cycleId ?? ''}
              onChange={(e) => setCycleId(e.target.value || null)}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">— Select a cycle —</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {!cycleId ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Pick a cycle to start planning.
          </CardContent>
        </Card>
      ) : myTeamQuery.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : myTeamQuery.error ? (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {myTeamQuery.error.message}
          </CardContent>
        </Card>
      ) : myTeamQuery.data && myTeamQuery.data.members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground" />
            <p className="mt-2 text-lg font-medium">No direct reports</p>
            <p className="text-sm text-muted-foreground">
              You don&rsquo;t have any direct reports for this cycle. If that&rsquo;s wrong, ask an
              admin to check the manager linkage on your employee record.
            </p>
          </CardContent>
        </Card>
      ) : myTeamQuery.data ? (
        <>
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<Users className="h-4 w-4" />}
              title="Team size"
              value={String(myTeamQuery.data.teamSize)}
            />
            <StatCard
              icon={<DollarSign className="h-4 w-4" />}
              title="Budget remaining"
              value={
                myTeamQuery.data.budget
                  ? fmt(myTeamQuery.data.budget.remaining, myTeamQuery.data.cycle.currency)
                  : '—'
              }
              subtitle={
                myTeamQuery.data.budget
                  ? `of ${fmt(myTeamQuery.data.budget.allocated, myTeamQuery.data.cycle.currency)} allocated`
                  : 'No manager budget set'
              }
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4" />}
              title="Proposed delta (unsaved)"
              value={fmt(totalProposedDelta, myTeamQuery.data.cycle.currency)}
              tone={
                myTeamQuery.data.budget && totalProposedDelta > myTeamQuery.data.budget.remaining
                  ? 'warn'
                  : 'normal'
              }
            />
            <StatCard
              icon={<Save className="h-4 w-4" />}
              title="Pending edits"
              value={String(dirtyDrafts.length)}
            />
          </div>

          {/* Bulk actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              <Label htmlFor="bulk-pct" className="text-sm">
                Bulk apply
              </Label>
              <BulkPctInput onApply={applyBulkPct} />
              <span className="text-xs text-muted-foreground">% to every row</span>
            </div>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || dirtyDrafts.length === 0}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save {dirtyDrafts.length || ''}{' '}
              {dirtyDrafts.length === 1 ? 'recommendation' : 'recommendations'}
            </Button>
          </div>

          {/* Team table */}
          <Card>
            <CardHeader>
              <CardTitle>Direct reports</CardTitle>
              <CardDescription>
                Edit the % or the dollar amount — the other field updates automatically. Drafts stay
                client-side until you Save.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Perf</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="w-[110px]">% Increase</TableHead>
                    <TableHead className="text-right">Proposed</TableHead>
                    <TableHead>Justification</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myTeamQuery.data.members.map((m) => {
                    const d = drafts[m.employee.id];
                    if (!d) return null;
                    const proposed = computeProposed(m, d);
                    const delta = proposed - m.employee.currentSalary;
                    return (
                      <TableRow key={m.employee.id} className={d.dirty ? 'bg-amber-50/40' : ''}>
                        <TableCell>
                          <div className="font-medium">{m.employee.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {m.employee.employeeCode} · {m.employee.department}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{m.employee.level}</Badge>
                          {m.employee.compaRatio !== null && (
                            <div className="text-xs text-muted-foreground mt-1">
                              CR {m.employee.compaRatio.toFixed(2)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {m.employee.performanceRating !== null
                            ? m.employee.performanceRating.toFixed(1)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmt(m.employee.currentSalary, m.employee.currency)}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.1"
                            value={d.percent}
                            onChange={(e) => {
                              const pct = e.target.value;
                              const cur = m.employee.currentSalary;
                              const num = Number(pct);
                              const abs = Number.isFinite(num)
                                ? Math.round(cur * (1 + num / 100) * 100) / 100
                                : cur;
                              updateDraft(m.employee.id, {
                                mode: 'percent',
                                percent: pct,
                                absolute: String(abs),
                              });
                            }}
                            className="h-8 w-[88px]"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-mono">{fmt(proposed, m.employee.currency)}</div>
                          <div
                            className={
                              'text-xs ' +
                              (delta > 0
                                ? 'text-emerald-600'
                                : delta < 0
                                  ? 'text-destructive'
                                  : 'text-muted-foreground')
                            }
                          >
                            {delta >= 0 ? '+' : ''}
                            {fmt(delta, m.employee.currency)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Textarea
                            rows={1}
                            value={d.justification}
                            onChange={(e) =>
                              updateDraft(m.employee.id, { justification: e.target.value })
                            }
                            className="min-h-[36px] text-xs"
                            placeholder="Why this change?"
                          />
                        </TableCell>
                        <TableCell>
                          {m.recommendation ? (
                            <Badge variant="outline" className="text-xs">
                              {m.recommendation.status}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">draft</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function StatCard({
  icon,
  title,
  value,
  subtitle,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle?: string;
  tone?: 'warn' | 'normal';
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2 text-xs">
          {icon}
          {title}
        </CardDescription>
        <CardTitle className={`text-xl ${tone === 'warn' ? 'text-amber-600' : ''}`}>
          {value}
        </CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
    </Card>
  );
}

function BulkPctInput({ onApply }: { onApply: (pct: number) => void }) {
  const [v, setV] = React.useState('3');
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        step="0.1"
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="h-8 w-[80px]"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const n = Number(v);
          if (Number.isFinite(n)) onApply(n);
        }}
      >
        Apply
      </Button>
    </div>
  );
}
