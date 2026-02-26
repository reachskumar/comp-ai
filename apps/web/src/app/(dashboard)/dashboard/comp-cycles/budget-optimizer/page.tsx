'use client';

import * as React from 'react';
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCycleList, useCycleDetail } from '@/hooks/use-cycles';
import {
  useBudgetOptimizeMutation,
  useApplyBudgetAllocationMutation,
  type BudgetOptimizationResult,
  type OptimizationScenario,
} from '@/hooks/use-budget-optimizer';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Select } from '@/components/ui/select';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function BudgetOptimizerPage() {
  const { toast } = useToast();
  const [selectedCycleId, setSelectedCycleId] = React.useState<string>('');
  const [totalBudget, setTotalBudget] = React.useState<string>('');
  const [result, setResult] = React.useState<BudgetOptimizationResult | null>(null);
  const [selectedScenario, setSelectedScenario] = React.useState<number>(0);

  const { data: cyclesData, isLoading: cyclesLoading } = useCycleList(1, 50);
  const cycles = cyclesData?.data ?? [];
  const { data: cycle } = useCycleDetail(selectedCycleId || null);
  const optimizeMutation = useBudgetOptimizeMutation();
  const applyMutation = useApplyBudgetAllocationMutation();

  React.useEffect(() => {
    const first = cycles[0];
    if (first && !selectedCycleId) setSelectedCycleId(first.id);
  }, [cycles, selectedCycleId]);

  React.useEffect(() => {
    if (cycle && !totalBudget) setTotalBudget(String(cycle.budgetTotal));
  }, [cycle, totalBudget]);

  const handleOptimize = () => {
    if (!selectedCycleId || !totalBudget) return;
    optimizeMutation.mutate(
      { cycleId: selectedCycleId, totalBudget: Number(totalBudget) },
      {
        onSuccess: (data) => {
          setResult(data);
          setSelectedScenario(0);
          toast({
            title: 'Optimization complete',
            description: 'AI has generated budget allocation suggestions.',
          });
        },
        onError: (err) => {
          toast({ title: 'Optimization failed', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleApply = () => {
    if (!result?.allocations || !selectedCycleId) return;
    applyMutation.mutate(
      {
        cycleId: selectedCycleId,
        allocations: result.allocations.map((a) => ({
          department: a.department,
          amount: a.suggestedBudget,
        })),
      },
      {
        onSuccess: () => {
          toast({ title: 'Budget applied', description: 'Department budgets have been updated.' });
        },
        onError: (err) => {
          toast({ title: 'Apply failed', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleApplyScenario = (scenario: OptimizationScenario) => {
    if (!selectedCycleId) return;
    applyMutation.mutate(
      {
        cycleId: selectedCycleId,
        allocations: scenario.allocations.map((a) => ({
          department: a.department,
          amount: a.amount,
        })),
      },
      {
        onSuccess: () => {
          toast({ title: 'Scenario applied', description: `"${scenario.name}" allocations set.` });
        },
        onError: (err) => {
          toast({ title: 'Apply failed', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const chartData =
    result?.allocations?.map((a) => ({
      department: a.department,
      current: a.currentBudget,
      suggested: a.suggestedBudget,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <a href="/dashboard/comp-cycles/active">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </a>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-purple-500" />
            AI Budget Optimizer
          </h1>
          <p className="text-sm text-muted-foreground">
            Optimize budget allocation across departments using AI analysis
          </p>
        </div>
      </div>

      <ConfigSection
        cycles={cycles}
        cyclesLoading={cyclesLoading}
        selectedCycleId={selectedCycleId}
        totalBudget={totalBudget}
        isPending={optimizeMutation.isPending}
        onCycleChange={(id) => {
          setSelectedCycleId(id);
          setResult(null);
          setTotalBudget('');
        }}
        onBudgetChange={setTotalBudget}
        onOptimize={handleOptimize}
      />

      {optimizeMutation.isPending && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <p className="text-muted-foreground">
                AI is analyzing department data, attrition risks, and equity gaps...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {result && !optimizeMutation.isPending && (
        <>
          <ImpactCards result={result} />
          <InsightsCard result={result} />
          <ComparisonChart chartData={chartData} />
          <AllocationTable
            result={result}
            onApply={handleApply}
            applyPending={applyMutation.isPending}
          />
          <ScenariosSection
            scenarios={result.scenarios}
            onApply={handleApplyScenario}
            applyPending={applyMutation.isPending}
          />
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function ConfigSection({
  cycles,
  cyclesLoading,
  selectedCycleId,
  totalBudget,
  isPending,
  onCycleChange,
  onBudgetChange,
  onOptimize,
}: {
  cycles: { id: string; name: string; status: string }[];
  cyclesLoading: boolean;
  selectedCycleId: string;
  totalBudget: string;
  isPending: boolean;
  onCycleChange: (id: string) => void;
  onBudgetChange: (v: string) => void;
  onOptimize: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>Select a cycle and set the total budget to optimize</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-2 min-w-[200px]">
            <Label htmlFor="cycle-select">Compensation Cycle</Label>
            {cyclesLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                id="cycle-select"
                value={selectedCycleId}
                onChange={(e) => onCycleChange(e.target.value)}
                placeholder="Select a cycle"
                options={cycles.map((c) => ({ value: c.id, label: `${c.name} (${c.status})` }))}
              />
            )}
          </div>
          <div className="space-y-2 min-w-[200px]">
            <Label htmlFor="total-budget">Total Budget ($)</Label>
            <Input
              id="total-budget"
              type="number"
              placeholder="e.g., 1000000"
              value={totalBudget}
              onChange={(e) => onBudgetChange(e.target.value)}
            />
          </div>
          <Button onClick={onOptimize} disabled={!selectedCycleId || !totalBudget || isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                AI Optimize
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactCards({ result }: { result: BudgetOptimizationResult }) {
  if (!result.impactSummary) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Retention Impact
          </CardDescription>
          <CardTitle className="text-lg">{result.impactSummary.retentionRiskReduction}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Equity Gaps Addressed
          </CardDescription>
          <CardTitle className="text-lg">{result.impactSummary.equityGapsClosed}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Total Budget
          </CardDescription>
          <CardTitle className="text-lg">{formatCurrency(result.totalBudget)}</CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}

function InsightsCard({ result }: { result: BudgetOptimizationResult }) {
  const insights = result.impactSummary?.keyInsights;
  if (!insights?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Key Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {insights.map((insight, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground">•</span>
              {insight}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ComparisonChart({
  chartData,
}: {
  chartData: { department: string; current: number; suggested: number }[];
}) {
  if (!chartData.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current vs Suggested Allocation</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="department" />
            <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatCurrency(Number(v))} />
            <Legend />
            <Bar dataKey="current" name="Current" fill="#94a3b8" />
            <Bar dataKey="suggested" name="Suggested" fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function AllocationTable({
  result,
  onApply,
  applyPending,
}: {
  result: BudgetOptimizationResult;
  onApply: () => void;
  applyPending: boolean;
}) {
  if (!result.allocations?.length) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Suggested Allocations</CardTitle>
          <Button onClick={onApply} disabled={applyPending}>
            {applyPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Apply Suggested
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead>Current</TableHead>
              <TableHead>Suggested</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Reasoning</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.allocations.map((a) => {
              const diff = a.suggestedBudget - a.currentBudget;
              return (
                <TableRow key={a.department}>
                  <TableCell className="font-medium">{a.department}</TableCell>
                  <TableCell>{formatCurrency(a.currentBudget)}</TableCell>
                  <TableCell>{formatCurrency(a.suggestedBudget)}</TableCell>
                  <TableCell>
                    <Badge variant={diff > 0 ? 'default' : diff < 0 ? 'destructive' : 'secondary'}>
                      {diff > 0 ? '+' : ''}
                      {formatCurrency(diff)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] text-sm text-muted-foreground">
                    {a.reasoning}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ScenariosSection({
  scenarios,
  onApply,
  applyPending,
}: {
  scenarios?: OptimizationScenario[];
  onApply: (s: OptimizationScenario) => void;
  applyPending: boolean;
}) {
  if (!scenarios?.length) return null;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Alternative Scenarios</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((scenario, i) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="text-lg">{scenario.name}</CardTitle>
              <CardDescription>{scenario.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                {scenario.allocations.map((a) => (
                  <div key={a.department} className="flex justify-between text-sm">
                    <span>{a.department}</span>
                    <span className="font-medium">
                      {formatCurrency(a.amount)} ({a.percentOfTotal}%)
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{scenario.tradeoffs}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onApply(scenario)}
                disabled={applyPending}
              >
                Apply This Scenario
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
