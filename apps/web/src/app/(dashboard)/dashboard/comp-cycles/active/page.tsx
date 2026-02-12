"use client";

import * as React from "react";
import {
  Plus,
  ListChecks,
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  DollarSign,
  Users,
  TrendingUp,
  Clock,
  ChevronRight,
  Loader2,
  Play,
  Bell,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  useCycleList,
  useCycleDetail,
  useCycleSummary,
  useCycleAlerts,
  useCreateCycleMutation,
  useTransitionCycleMutation,
  useRunMonitorsMutation,
  useNudgeMutation,
  type Cycle,
  type CycleStatus,
  type CycleAlert,
  type DepartmentProgress,
} from "@/hooks/use-cycles";

// ─── Helpers ──────────────────────────────────────────────

const STATUS_COLORS: Record<CycleStatus, string> = {
  DRAFT: "secondary",
  PLANNING: "outline",
  ACTIVE: "default",
  CALIBRATION: "outline",
  APPROVAL: "outline",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

const STATUS_ORDER: CycleStatus[] = [
  "DRAFT",
  "PLANNING",
  "ACTIVE",
  "CALIBRATION",
  "APPROVAL",
  "COMPLETED",
];

function statusBadgeVariant(status: CycleStatus) {
  return STATUS_COLORS[status] as "default" | "secondary" | "outline" | "destructive";
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  HIGH: <AlertCircle className="h-4 w-4 text-red-500" />,
  MEDIUM: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
  LOW: <Bell className="h-4 w-4 text-blue-500" />,
};

// ─── Main Page ────────────────────────────────────────────

export default function ActiveCyclesPage() {
  const [selectedCycleId, setSelectedCycleId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  if (selectedCycleId) {
    return (
      <CycleDetailView
        cycleId={selectedCycleId}
        onBack={() => setSelectedCycleId(null)}
      />
    );
  }

  return (
    <CycleListView
      onSelectCycle={setSelectedCycleId}
      onCreateOpen={() => setCreateOpen(true)}
      createOpen={createOpen}
      onCreateClose={() => setCreateOpen(false)}
    />
  );
}


// ─── Cycle List View ──────────────────────────────────────

function CycleListView({
  onSelectCycle,
  onCreateOpen,
  createOpen,
  onCreateClose,
}: {
  onSelectCycle: (id: string) => void;
  onCreateOpen: () => void;
  createOpen: boolean;
  onCreateClose: () => void;
}) {
  const { toast } = useToast();
  const { data, isLoading, error } = useCycleList();
  const createMutation = useCreateCycleMutation();

  const [newName, setNewName] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [newStart, setNewStart] = React.useState("");
  const [newEnd, setNewEnd] = React.useState("");

  const handleCreate = () => {
    if (!newName.trim() || !newStart || !newEnd) return;
    createMutation.mutate(
      { name: newName, description: newDesc || undefined, startDate: newStart, endDate: newEnd },
      {
        onSuccess: () => {
          toast({ title: "Cycle created", description: `${newName} is ready.` });
          onCreateClose();
          setNewName("");
          setNewDesc("");
          setNewStart("");
          setNewEnd("");
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const cycles = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Compensation Cycles</h1>
          <p className="text-muted-foreground">Manage and monitor active compensation cycles.</p>
        </div>
        <Button onClick={onCreateOpen}>
          <Plus className="mr-2 h-4 w-4" />
          New Cycle
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            All Cycles
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-12 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="mt-2 text-sm text-destructive">{error.message}</p>
            </div>
          ) : cycles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ListChecks className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No cycles yet</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first compensation cycle to get started.
              </p>
              <Button onClick={onCreateOpen}>
                <Plus className="mr-2 h-4 w-4" />
                Create Cycle
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cycles.map((cycle) => (
                  <TableRow
                    key={cycle.id}
                    className="cursor-pointer"
                    onClick={() => onSelectCycle(cycle.id)}
                  >
                    <TableCell className="font-medium">{cycle.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(cycle.status)}>
                        {cycle.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={cycle.progress} className="flex-1" />
                        <span className="text-xs text-muted-foreground w-8">
                          {cycle.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatCurrency(cycle.budgetTotal)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
                    </TableCell>
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

      {/* Create Cycle Dialog */}
      <Dialog open={createOpen} onOpenChange={onCreateClose}>
        <DialogContent onClose={onCreateClose}>
          <DialogHeader>
            <DialogTitle>Create New Cycle</DialogTitle>
            <DialogDescription>
              Set up a new compensation cycle with dates and budget.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cycle-name">Cycle Name</Label>
              <Input
                id="cycle-name"
                placeholder="e.g., 2026 Annual Merit Review"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cycle-desc">Description (optional)</Label>
              <Input
                id="cycle-desc"
                placeholder="Brief description of this cycle"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cycle-start">Start Date</Label>
                <Input
                  id="cycle-start"
                  type="date"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cycle-end">End Date</Label>
                <Input
                  id="cycle-end"
                  type="date"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCreateClose}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || !newStart || !newEnd || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Cycle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Cycle Detail View (Control Tower) ────────────────────

function CycleDetailView({
  cycleId,
  onBack,
}: {
  cycleId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const { data: cycle, isLoading: cycleLoading } = useCycleDetail(cycleId);
  const { data: summary, isLoading: summaryLoading } = useCycleSummary(cycleId);
  const { data: alerts } = useCycleAlerts(cycleId);
  const transitionMutation = useTransitionCycleMutation();
  const runMonitorsMutation = useRunMonitorsMutation();
  const nudgeMutation = useNudgeMutation();

  const handleTransition = (targetStatus: CycleStatus) => {
    transitionMutation.mutate(
      { cycleId, targetStatus },
      {
        onSuccess: () => {
          toast({ title: "Cycle updated", description: `Moved to ${targetStatus}` });
        },
        onError: (err) => {
          toast({ title: "Transition failed", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleRunMonitors = () => {
    runMonitorsMutation.mutate(cycleId, {
      onSuccess: () => toast({ title: "Monitors triggered", description: "Running analysis..." }),
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  };

  const handleNudge = () => {
    nudgeMutation.mutate(
      { cycleId },
      {
        onSuccess: () => toast({ title: "Reminders sent" }),
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  if (cycleLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="flex flex-col items-center py-12">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="mt-2 text-sm">Cycle not found</p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          Go Back
        </Button>
      </div>
    );
  }

  const nextStatus = getNextStatus(cycle.status);
  const deptProgress = summary?.departments ?? [];
  const cycleAlerts = alerts ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{cycle.name}</h1>
            <Badge variant={statusBadgeVariant(cycle.status)}>{cycle.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)} · {cycle.progress}% complete
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRunMonitors} disabled={runMonitorsMutation.isPending}>
            {runMonitorsMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Run Monitors
          </Button>
          <Button variant="outline" size="sm" onClick={handleNudge} disabled={nudgeMutation.isPending}>
            <Bell className="mr-1 h-3 w-3" />
            Nudge
          </Button>
          {nextStatus && (
            <Button size="sm" onClick={() => handleTransition(nextStatus)} disabled={transitionMutation.isPending}>
              {transitionMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              Advance to {nextStatus}
            </Button>
          )}
        </div>
      </div>

      {/* Overall Progress */}
      <Progress value={cycle.progress} className="h-3" />

      {/* Budget Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BudgetCard title="Total Budget" value={cycle.budgetTotal} icon={<DollarSign className="h-4 w-4" />} />
        <BudgetCard title="Allocated" value={cycle.budgetAllocated} icon={<TrendingUp className="h-4 w-4" />} subtitle={`${cycle.budgetTotal > 0 ? Math.round((cycle.budgetAllocated / cycle.budgetTotal) * 100) : 0}% of total`} />
        <BudgetCard title="Committed" value={cycle.budgetCommitted} icon={<Users className="h-4 w-4" />} subtitle={`${cycle.budgetTotal > 0 ? Math.round((cycle.budgetCommitted / cycle.budgetTotal) * 100) : 0}% of total`} />
        <BudgetCard
          title="Remaining"
          value={cycle.budgetRemaining}
          icon={<Clock className="h-4 w-4" />}
          variant={cycle.budgetRemaining < 0 ? "destructive" : undefined}
        />
      </div>


      {/* Two-column layout: Alerts + Department Progress */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Alert Feed */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Alerts
              {cycleAlerts.length > 0 && (
                <Badge variant="destructive" className="ml-auto">{cycleAlerts.length}</Badge>
              )}
            </CardTitle>
            <CardDescription>Policy violations, budget drift, and outliers</CardDescription>
          </CardHeader>
          <CardContent>
            {cycleAlerts.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <AlertTriangle className="h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No alerts — looking good!</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[320px]">
                <div className="space-y-3">
                  {cycleAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 rounded-lg border p-3"
                    >
                      {SEVERITY_ICON[alert.severity]}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{alert.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{alert.type.replace(/_/g, " ")}</Badge>
                          {alert.department && (
                            <span className="text-xs text-muted-foreground">{alert.department}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatDate(alert.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Department Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Department Progress
            </CardTitle>
            <CardDescription>Completion and budget usage by department</CardDescription>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : deptProgress.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No department data yet</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead>Completion</TableHead>
                    <TableHead>Pending</TableHead>
                    <TableHead>Budget Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deptProgress.map((dept) => {
                    const pct = dept.totalEmployees > 0
                      ? Math.round((dept.completed / dept.totalEmployees) * 100)
                      : 0;
                    const budgetPct = dept.budgetAllocated > 0
                      ? Math.round((dept.budgetUsed / dept.budgetAllocated) * 100)
                      : 0;
                    return (
                      <TableRow key={dept.department}>
                        <TableCell className="font-medium">{dept.department}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="w-16" />
                            <span className="text-xs">{pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={dept.pending > 0 ? "outline" : "secondary"}>
                            {dept.pending}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={budgetPct > 100 ? "text-red-600 font-medium" : "text-sm"}>
                            {budgetPct}%
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* State Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Cycle Timeline</CardTitle>
          <CardDescription>State machine progression</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 overflow-x-auto py-2">
            {STATUS_ORDER.map((status, i) => {
              const isCurrent = cycle.status === status;
              const isPast = STATUS_ORDER.indexOf(cycle.status) > i;
              const isCancelled = cycle.status === "CANCELLED";
              return (
                <React.Fragment key={status}>
                  {i > 0 && (
                    <div className={`h-px w-8 flex-shrink-0 ${isPast ? "bg-primary" : "bg-border"}`} />
                  )}
                  <div
                    className={`flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium flex-shrink-0 ${
                      isCancelled
                        ? "bg-muted text-muted-foreground"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : isPast
                            ? "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status}
                  </div>
                </React.Fragment>
              );
            })}
            {cycle.status === "CANCELLED" && (
              <>
                <div className="h-px w-8 flex-shrink-0 bg-border" />
                <div className="flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium flex-shrink-0 bg-destructive text-destructive-foreground">
                  CANCELLED
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helper Components ────────────────────────────────────

function BudgetCard({
  title,
  value,
  icon,
  subtitle,
  variant,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  subtitle?: string;
  variant?: "destructive";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          {icon}
          {title}
        </CardDescription>
        <CardTitle className={`text-2xl ${variant === "destructive" ? "text-red-600" : ""}`}>
          {formatCurrency(value)}
        </CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
    </Card>
  );
}

function getNextStatus(current: CycleStatus): CycleStatus | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx === -1 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1] ?? null;
}
