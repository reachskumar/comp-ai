'use client';

import * as React from 'react';
import {
  GitCompare,
  Plus,
  ArrowLeft,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowUpDown,
  ChevronRight,
  Sparkles,
  X,
  Check,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  useCycleList,
  useCalibrationSessions,
  useCreateCalibrationMutation,
  useRecommendations,
  useUpdateRecommendationStatusMutation,
  useAiCalibrationSuggestMutation,
  useApplyAiSuggestionsMutation,
  type CalibrationSession,
  type Recommendation,
  type RecommendationStatus,
  type AiCalibrationSuggestion,
} from '@/hooks/use-cycles';

// ─── Helpers ──────────────────────────────────────────────

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPercent(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

const SESSION_VARIANT: Record<CalibrationSession['status'], 'default' | 'secondary' | 'outline'> = {
  OPEN: 'outline',
  IN_PROGRESS: 'secondary',
  COMPLETED: 'default',
};

export default function CalibrationPage() {
  const [selectedCycleId, setSelectedCycleId] = React.useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const { data: cyclesData, isLoading: cyclesLoading } = useCycleList(1, 50);
  const cycles = cyclesData?.data ?? [];

  // Auto-select first cycle
  React.useEffect(() => {
    const first = cycles[0];
    if (first && !selectedCycleId) {
      setSelectedCycleId(first.id);
    }
  }, [cycles, selectedCycleId]);

  if (selectedSessionId && selectedCycleId) {
    return (
      <SessionDetailView
        cycleId={selectedCycleId}
        sessionId={selectedSessionId}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  return (
    <SessionListView
      selectedCycleId={selectedCycleId}
      onCycleChange={setSelectedCycleId}
      cycles={cycles}
      cyclesLoading={cyclesLoading}
      onSelectSession={(id) => setSelectedSessionId(id)}
      createOpen={createOpen}
      onCreateOpen={() => setCreateOpen(true)}
      onCreateClose={() => setCreateOpen(false)}
    />
  );
}

// ─── Session List View ────────────────────────────────────

function SessionListView({
  selectedCycleId,
  onCycleChange,
  cycles,
  cyclesLoading,
  onSelectSession,
  createOpen,
  onCreateOpen,
  onCreateClose,
}: {
  selectedCycleId: string;
  onCycleChange: (id: string) => void;
  cycles: { id: string; name: string }[];
  cyclesLoading: boolean;
  onSelectSession: (id: string) => void;
  createOpen: boolean;
  onCreateOpen: () => void;
  onCreateClose: () => void;
}) {
  const { toast } = useToast();
  const { data: sessions, isLoading: sessionsLoading } = useCalibrationSessions(
    selectedCycleId || null,
  );
  const createMutation = useCreateCalibrationMutation();

  const [newName, setNewName] = React.useState('');
  const [newDept, setNewDept] = React.useState('');

  const handleCreate = () => {
    if (!newName.trim() || !selectedCycleId) return;
    createMutation.mutate(
      { cycleId: selectedCycleId, name: newName, department: newDept || undefined },
      {
        onSuccess: () => {
          toast({ title: 'Session created', description: `${newName} is ready.` });
          onCreateClose();
          setNewName('');
          setNewDept('');
        },
        onError: (err) => {
          toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const sessionList = sessions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calibration</h1>
          <p className="text-muted-foreground">
            Calibrate compensation across teams and departments.
          </p>
        </div>
        <Button onClick={onCreateOpen} disabled={!selectedCycleId}>
          <Plus className="mr-2 h-4 w-4" />
          New Session
        </Button>
      </div>

      {/* Cycle Selector */}
      <div className="w-64">
        <Select
          value={selectedCycleId}
          onChange={(e) => onCycleChange(e.target.value)}
          options={cycles.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Select cycle..."
        />
      </div>

      {/* Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            Calibration Sessions
          </CardTitle>
          <CardDescription>
            Review and compare recommendations within calibration sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cyclesLoading || sessionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !selectedCycleId ? (
            <div className="flex flex-col items-center py-12 text-center">
              <GitCompare className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Select a cycle</p>
              <p className="text-sm text-muted-foreground">
                Choose a compensation cycle to view calibration sessions.
              </p>
            </div>
          ) : sessionList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <GitCompare className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No calibration sessions</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create a session to start calibrating recommendations.
              </p>
              <Button onClick={onCreateOpen}>
                <Plus className="mr-2 h-4 w-4" />
                Create Session
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Participants</TableHead>
                  <TableHead>Recommendations</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionList.map((session) => (
                  <TableRow
                    key={session.id}
                    className="cursor-pointer"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <TableCell className="font-medium">{session.name}</TableCell>
                    <TableCell className="text-sm">{session.department ?? 'All'}</TableCell>
                    <TableCell>
                      <Badge variant={SESSION_VARIANT[session.status]}>
                        {session.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {session.participants}
                      </div>
                    </TableCell>
                    <TableCell>{session.recommendations}</TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Session Dialog */}
      <Dialog open={createOpen} onOpenChange={onCreateClose}>
        <DialogContent onClose={onCreateClose}>
          <DialogHeader>
            <DialogTitle>Create Calibration Session</DialogTitle>
            <DialogDescription>
              Start a new calibration session to review and compare recommendations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="session-name">Session Name</Label>
              <Input
                id="session-name"
                placeholder="e.g., Engineering Q1 Calibration"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-dept">Department (optional)</Label>
              <Input
                id="session-dept"
                placeholder="e.g., Engineering"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCreateClose}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Session Detail View ──────────────────────────────────

function SessionDetailView({
  cycleId,
  sessionId,
  onBack,
}: {
  cycleId: string;
  sessionId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const { data: sessions } = useCalibrationSessions(cycleId);
  const session = sessions?.find((s) => s.id === sessionId);

  // Fetch recommendations for this session's department (or all)
  const filters = React.useMemo(
    () => ({
      department: session?.department || undefined,
      page: 1,
      limit: 200,
    }),
    [session?.department],
  );
  const { data: recsData, isLoading: recsLoading } = useRecommendations(cycleId, filters);
  const recommendations = recsData?.data ?? [];

  const updateStatusMutation = useUpdateRecommendationStatusMutation();

  // AI Suggestions state
  const aiSuggestMutation = useAiCalibrationSuggestMutation();
  const applyMutation = useApplyAiSuggestionsMutation();
  const [aiSuggestions, setAiSuggestions] = React.useState<AiCalibrationSuggestion[]>([]);
  const [acceptedIds, setAcceptedIds] = React.useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = React.useState<Set<string>>(new Set());
  const [showAiPanel, setShowAiPanel] = React.useState(false);

  const handleAiSuggest = () => {
    aiSuggestMutation.mutate(
      { cycleId, sessionId },
      {
        onSuccess: (data) => {
          setAiSuggestions(data.suggestions);
          setAcceptedIds(new Set());
          setRejectedIds(new Set());
          setShowAiPanel(true);
          toast({
            title: 'AI Analysis Complete',
            description: `${data.suggestions.length} suggestions generated.`,
          });
        },
        onError: (err) => {
          toast({ title: 'AI Error', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleAcceptSuggestion = (recId: string) => {
    setAcceptedIds((prev) => new Set([...prev, recId]));
    setRejectedIds((prev) => {
      const next = new Set(prev);
      next.delete(recId);
      return next;
    });
  };

  const handleRejectSuggestion = (recId: string) => {
    setRejectedIds((prev) => new Set([...prev, recId]));
    setAcceptedIds((prev) => {
      const next = new Set(prev);
      next.delete(recId);
      return next;
    });
  };

  const handleAcceptAll = () => {
    const allIds = new Set(aiSuggestions.map((s) => s.recommendationId));
    setAcceptedIds(allIds);
    setRejectedIds(new Set());
  };

  const handleApplyAccepted = () => {
    const toApply = aiSuggestions
      .filter((s) => acceptedIds.has(s.recommendationId))
      .map((s) => ({ recommendationId: s.recommendationId, suggestedValue: s.suggestedValue }));

    if (toApply.length === 0) {
      toast({
        title: 'No suggestions selected',
        description: 'Accept at least one suggestion to apply.',
        variant: 'destructive',
      });
      return;
    }

    applyMutation.mutate(
      { cycleId, sessionId, suggestions: toApply },
      {
        onSuccess: (data) => {
          toast({
            title: 'Suggestions Applied',
            description: `${data.applied} recommendations updated.`,
          });
          setShowAiPanel(false);
          setAiSuggestions([]);
        },
        onError: (err) => {
          toast({ title: 'Error', description: err.message, variant: 'destructive' });
        },
      },
    );
  };

  const handleStatusChange = (recId: string, status: RecommendationStatus) => {
    updateStatusMutation.mutate(
      { cycleId, recommendationId: recId, status },
      {
        onSuccess: () => toast({ title: 'Status updated' }),
        onError: (err) =>
          toast({ title: 'Error', description: err.message, variant: 'destructive' }),
      },
    );
  };

  // Sort
  const [sortField, setSortField] = React.useState<keyof Recommendation>('changePercent');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');

  const sortedRecs = React.useMemo(() => {
    return [...recommendations].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [recommendations, sortField, sortDir]);

  const handleSort = (field: keyof Recommendation) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Distribution data for chart
  const distributionData = React.useMemo(() => {
    const buckets = [
      { range: '0-2%', min: 0, max: 2, count: 0 },
      { range: '2-4%', min: 2, max: 4, count: 0 },
      { range: '4-6%', min: 4, max: 6, count: 0 },
      { range: '6-8%', min: 6, max: 8, count: 0 },
      { range: '8-10%', min: 8, max: 10, count: 0 },
      { range: '10%+', min: 10, max: Infinity, count: 0 },
    ];
    for (const rec of recommendations) {
      const pct = Math.abs(rec.changePercent);
      const bucket = buckets.find((b) => pct >= b.min && pct < b.max);
      if (bucket) bucket.count++;
    }
    return buckets.map(({ range, count }) => ({ range, count }));
  }, [recommendations]);

  // Summary stats
  const stats = React.useMemo(() => {
    if (recommendations.length === 0) return null;
    const changes = recommendations.map((r) => r.changePercent);
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    const approved = recommendations.filter((r) => r.status === 'APPROVED').length;
    const pending = recommendations.filter((r) => r.status === 'PENDING').length;
    const outliers = recommendations.filter((r) => r.isOutlier).length;
    return { avg, approved, pending, outliers, total: recommendations.length };
  }, [recommendations]);

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
    import('recharts').then((mod) => {
      setRechartsComponents({
        BarChart: mod.BarChart as unknown as React.ComponentType<Record<string, unknown>>,
        Bar: mod.Bar as unknown as React.ComponentType<Record<string, unknown>>,
        XAxis: mod.XAxis as unknown as React.ComponentType<Record<string, unknown>>,
        YAxis: mod.YAxis as unknown as React.ComponentType<Record<string, unknown>>,
        CartesianGrid: mod.CartesianGrid as unknown as React.ComponentType<Record<string, unknown>>,
        Tooltip: mod.Tooltip as unknown as React.ComponentType<Record<string, unknown>>,
        ResponsiveContainer: mod.ResponsiveContainer as unknown as React.ComponentType<
          Record<string, unknown>
        >,
      });
    });
  }, []);

  if (!session) {
    return (
      <div className="flex flex-col items-center py-12">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="mt-2 text-sm">Session not found</p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{session.name}</h1>
            <Badge variant={SESSION_VARIANT[session.status]}>
              {session.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {session.department ?? 'All departments'} · {session.participants} participants ·{' '}
            {session.recommendations} recommendations
          </p>
        </div>
        <Button onClick={handleAiSuggest} disabled={aiSuggestMutation.isPending} className="gap-2">
          {aiSuggestMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          AI Suggest
        </Button>
      </div>

      {/* AI Suggestions Panel */}
      {showAiPanel && aiSuggestions.length > 0 && (
        <Card className="border-purple-200 dark:border-purple-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" />
                <CardTitle>AI Calibration Suggestions</CardTitle>
                <Badge variant="secondary">{aiSuggestions.length} suggestions</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleAcceptAll}>
                  <Check className="mr-1 h-3 w-3" />
                  Accept All
                </Button>
                <Button
                  size="sm"
                  onClick={handleApplyAccepted}
                  disabled={acceptedIds.size === 0 || applyMutation.isPending}
                >
                  {applyMutation.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-3 w-3" />
                  )}
                  Apply {acceptedIds.size > 0 ? `(${acceptedIds.size})` : ''}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setShowAiPanel(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <CardDescription>
              Review AI-generated suggestions. Accept or reject each, then apply accepted changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {aiSuggestions.map((suggestion) => {
                const isAccepted = acceptedIds.has(suggestion.recommendationId);
                const isRejected = rejectedIds.has(suggestion.recommendationId);
                return (
                  <div
                    key={suggestion.recommendationId}
                    className={`rounded-lg border p-4 transition-colors ${
                      isAccepted
                        ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
                        : isRejected
                          ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/10 opacity-60'
                          : 'border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{suggestion.employeeName}</span>
                          <Badge
                            variant={
                              suggestion.priority === 'HIGH'
                                ? 'destructive'
                                : suggestion.priority === 'MEDIUM'
                                  ? 'default'
                                  : 'secondary'
                            }
                            className="text-xs"
                          >
                            {suggestion.priority}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">
                            Manager:{' '}
                            <span className="font-medium text-foreground">
                              {formatCurrency(suggestion.currentProposed)}
                            </span>
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-muted-foreground">
                            AI:{' '}
                            <span className="font-medium text-purple-600">
                              {formatCurrency(suggestion.suggestedValue)}
                            </span>
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              suggestion.suggestedValue > suggestion.currentProposed
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            ({suggestion.suggestedValue > suggestion.currentProposed ? '+' : ''}
                            {formatCurrency(suggestion.suggestedValue - suggestion.currentProposed)}
                            )
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{suggestion.reason}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant={isAccepted ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleAcceptSuggestion(suggestion.recommendationId)}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant={isRejected ? 'destructive' : 'outline'}
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleRejectSuggestion(suggestion.recommendationId)}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Recommendations</CardDescription>
              <CardTitle className="text-2xl">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Avg Change</CardDescription>
              <CardTitle className="text-2xl">{formatPercent(stats.avg)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Approved / Pending
              </CardDescription>
              <CardTitle className="text-2xl">
                {stats.approved} / {stats.pending}
              </CardTitle>
              <Progress
                value={stats.total > 0 ? (stats.approved / stats.total) * 100 : 0}
                className="mt-1"
              />
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Outliers</CardDescription>
              <CardTitle className={`text-2xl ${stats.outliers > 0 ? 'text-amber-600' : ''}`}>
                {stats.outliers}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Distribution Chart */}
      {RechartsComponents && recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Change Distribution</CardTitle>
            <CardDescription>Distribution of compensation change percentages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <RechartsComponents.ResponsiveContainer width="100%" height="100%">
                <RechartsComponents.BarChart data={distributionData}>
                  <RechartsComponents.CartesianGrid strokeDasharray="3 3" />
                  <RechartsComponents.XAxis dataKey="range" />
                  <RechartsComponents.YAxis allowDecimals={false} />
                  <RechartsComponents.Tooltip />
                  <RechartsComponents.Bar
                    dataKey="count"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </RechartsComponents.BarChart>
              </RechartsComponents.ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            Recommendation Comparison
          </CardTitle>
          <CardDescription>
            Review, compare, and approve recommendations ranked by change percentage.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {recsLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : sortedRecs.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <GitCompare className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No recommendations</p>
              <p className="text-sm text-muted-foreground">
                No recommendations found for this session.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead>
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort('employeeName')}
                    >
                      Employee <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => handleSort('level')}
                    >
                      Level <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort('currentSalary')}
                    >
                      Current <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort('proposedSalary')}
                    >
                      Proposed <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      className="flex items-center gap-1 ml-auto hover:text-foreground"
                      onClick={() => handleSort('changePercent')}
                    >
                      Change % <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRecs.map((rec, idx) => (
                  <TableRow
                    key={rec.id}
                    className={rec.isOutlier ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}
                  >
                    <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{rec.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{rec.department}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{rec.level}</TableCell>
                    <TableCell className="text-right text-sm">
                      {formatCurrency(rec.currentSalary)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {formatCurrency(rec.proposedSalary)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={
                          rec.changePercent > 10
                            ? 'text-red-600 font-medium'
                            : rec.changePercent > 5
                              ? 'text-amber-600'
                              : 'text-sm'
                        }
                      >
                        {formatPercent(rec.changePercent)}
                      </span>
                      {rec.isOutlier && (
                        <Badge variant="outline" className="ml-1 text-xs text-amber-600">
                          outlier
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          rec.status === 'APPROVED'
                            ? 'default'
                            : rec.status === 'REJECTED'
                              ? 'destructive'
                              : rec.status === 'PENDING'
                                ? 'outline'
                                : 'secondary'
                        }
                      >
                        {rec.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(rec.status === 'PENDING' || rec.status === 'DRAFT') && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-green-600 hover:text-green-700"
                            onClick={() => handleStatusChange(rec.id, 'APPROVED')}
                            disabled={updateStatusMutation.isPending}
                          >
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                            onClick={() => handleStatusChange(rec.id, 'REJECTED')}
                            disabled={updateStatusMutation.isPending}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
