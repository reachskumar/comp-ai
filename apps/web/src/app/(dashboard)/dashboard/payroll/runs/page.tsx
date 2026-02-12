"use client";

import * as React from "react";
import {
  Play,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  usePayrollRuns,
  useCreatePayrollRun,
  useRunCheck,
  type PayrollRun,
  type PayrollStatus,
} from "@/hooks/use-payroll";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "PROCESSING", label: "Processing" },
  { value: "REVIEW", label: "Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "FINALIZED", label: "Finalized" },
  { value: "ERROR", label: "Error" },
];

function statusBadge(status: PayrollStatus) {
  const map: Record<PayrollStatus, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    DRAFT: { variant: "outline", icon: <Clock className="mr-1 h-3 w-3" /> },
    PROCESSING: { variant: "secondary", icon: <Loader2 className="mr-1 h-3 w-3 animate-spin" /> },
    REVIEW: { variant: "default", icon: <AlertTriangle className="mr-1 h-3 w-3" /> },
    APPROVED: { variant: "secondary", icon: <CheckCircle2 className="mr-1 h-3 w-3" /> },
    FINALIZED: { variant: "secondary", icon: <CheckCircle2 className="mr-1 h-3 w-3" /> },
    ERROR: { variant: "destructive", icon: <XCircle className="mr-1 h-3 w-3" /> },
  };
  const cfg = map[status] ?? { variant: "outline" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="flex w-fit items-center">
      {cfg.icon}
      {status}
    </Badge>
  );
}

function severityIndicator(count: number) {
  if (count === 0) return <span className="text-green-600 font-medium">0</span>;
  if (count <= 3) return <span className="text-yellow-600 font-medium">{count}</span>;
  return <span className="text-red-600 font-medium">{count}</span>;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PayrollRunsPage() {
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const [statusFilter, setStatusFilter] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newPeriod, setNewPeriod] = React.useState("");
  const limit = 20;

  const listQuery = usePayrollRuns(page, limit, statusFilter || undefined);
  const createMutation = useCreatePayrollRun();
  const runCheckMutation = useRunCheck();

  const handleCreate = () => {
    if (!newPeriod.trim()) return;
    createMutation.mutate(
      { period: newPeriod, lineItems: [] },
      {
        onSuccess: () => {
          toast({ title: "Payroll run created", description: `Period: ${newPeriod}` });
          setCreateOpen(false);
          setNewPeriod("");
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const handleRunCheck = (runId: string) => {
    runCheckMutation.mutate(runId, {
      onSuccess: (data) => {
        toast({ title: "Reconciliation check complete", description: `Status: ${data.status}` });
      },
      onError: (err) => {
        toast({ title: "Check failed", description: err.message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll Runs</h1>
          <p className="text-muted-foreground">View and manage payroll processing runs.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Payroll Run
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="w-48">
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Payroll Runs
          </CardTitle>
          <CardDescription>All payroll runs with anomaly indicators.</CardDescription>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <div className="flex flex-col items-center py-12 text-center">
              <XCircle className="h-8 w-8 text-red-500" />
              <p className="mt-2 text-sm font-medium">Failed to load payroll runs</p>
              <p className="text-xs text-muted-foreground">{listQuery.error?.message}</p>
            </div>
          ) : !listQuery.data || listQuery.data.data.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Play className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No payroll runs found</p>
              <p className="text-xs text-muted-foreground">
                {statusFilter ? "Try changing the filter." : "Create a new payroll run to get started."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right">Line Items</TableHead>
                  <TableHead className="text-right">Anomalies</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.data.data.map((run: PayrollRun) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.period}</TableCell>
                    <TableCell>{statusBadge(run.status)}</TableCell>
                    <TableCell className="text-right">{run.employeeCount}</TableCell>
                    <TableCell className="text-right">{run._count?.lineItems ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {severityIndicator(run._count?.anomalies ?? 0)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(run.createdAt)}
                    </TableCell>
                    <TableCell>
                      {run.status === "DRAFT" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunCheck(run.id)}
                          disabled={runCheckMutation.isPending}
                        >
                          {runCheckMutation.isPending ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="mr-1 h-3 w-3" />
                          )}
                          Run Check
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {listQuery.data && listQuery.data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {listQuery.data.pagination.page} of {listQuery.data.pagination.totalPages} ({listQuery.data.pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= (listQuery.data?.pagination.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Payroll Run</DialogTitle>
            <DialogDescription>
              Create a new payroll run for a specific period.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="period">Period</Label>
              <Input
                id="period"
                placeholder="e.g. 2026-02"
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || !newPeriod.trim()}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

