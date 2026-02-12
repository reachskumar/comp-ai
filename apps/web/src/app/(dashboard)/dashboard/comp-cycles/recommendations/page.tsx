"use client";

import * as React from "react";
import {
  BarChart3,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
  useRecommendations,
  useUpdateRecommendationStatusMutation,
  useBulkApprovalMutation,
  type Recommendation,
  type RecommendationStatus,
} from "@/hooks/use-cycles";

// ─── Helpers ──────────────────────────────────────────────

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPercent(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const STATUS_VARIANT: Record<RecommendationStatus, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "secondary",
  PENDING: "outline",
  APPROVED: "default",
  REJECTED: "destructive",
  ESCALATED: "outline",
};

export default function RecommendationsPage() {
  const { toast } = useToast();

  // Cycle selection
  const { data: cyclesData, isLoading: cyclesLoading } = useCycleList(1, 50);
  const cycles = cyclesData?.data ?? [];
  const [selectedCycleId, setSelectedCycleId] = React.useState<string>("");

  // Auto-select first cycle
  React.useEffect(() => {
    const first = cycles[0];
    if (first && !selectedCycleId) {
      setSelectedCycleId(first.id);
    }
  }, [cycles, selectedCycleId]);

  // Filters
  const [deptFilter, setDeptFilter] = React.useState("");
  const [levelFilter, setLevelFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [outlierFilter, setOutlierFilter] = React.useState("");
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  const filters = React.useMemo(
    () => ({
      department: deptFilter || undefined,
      level: levelFilter || undefined,
      status: statusFilter || undefined,
      outlier: outlierFilter === "true" ? true : outlierFilter === "false" ? false : undefined,
      page,
      limit: pageSize,
    }),
    [deptFilter, levelFilter, statusFilter, outlierFilter, page]
  );

  const { data: recsData, isLoading: recsLoading } = useRecommendations(
    selectedCycleId || null,
    filters
  );
  const recommendations = recsData?.data ?? [];
  const totalRecs = recsData?.total ?? 0;
  const totalPages = Math.ceil(totalRecs / pageSize);

  // Selection for bulk actions
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    if (selected.size === recommendations.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(recommendations.map((r) => r.id)));
    }
  };

  // Mutations
  const updateStatusMutation = useUpdateRecommendationStatusMutation();
  const bulkApprovalMutation = useBulkApprovalMutation();

  const handleStatusChange = (recId: string, status: RecommendationStatus) => {
    if (!selectedCycleId) return;
    updateStatusMutation.mutate(
      { cycleId: selectedCycleId, recommendationId: recId, status },
      {
        onSuccess: () => toast({ title: "Status updated" }),
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleBulkAction = (action: "approve" | "reject") => {
    if (!selectedCycleId || selected.size === 0) return;
    const actions = Array.from(selected).map((id) => ({
      recommendationId: id,
      action,
    }));
    bulkApprovalMutation.mutate(
      { cycleId: selectedCycleId, actions },
      {
        onSuccess: () => {
          toast({ title: `${selected.size} recommendations ${action}d` });
          setSelected(new Set());
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  // Sort
  const [sortField, setSortField] = React.useState<keyof Recommendation>("employeeName");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");

  const sortedRecs = React.useMemo(() => {
    return [...recommendations].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }, [recommendations, sortField, sortDir]);

  const handleSort = (field: keyof Recommendation) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };


  // Unique departments and levels for filter options
  const departments = React.useMemo(
    () => [...new Set(recommendations.map((r) => r.department))].sort(),
    [recommendations]
  );
  const levels = React.useMemo(
    () => [...new Set(recommendations.map((r) => r.level))].sort(),
    [recommendations]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Recommendations</h1>
        <p className="text-muted-foreground">
          Review and approve compensation recommendations across cycles.
        </p>
      </div>

      {/* Cycle selector + Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              value={selectedCycleId}
              onChange={(e) => { setSelectedCycleId(e.target.value); setPage(1); }}
              options={cycles.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select cycle..."
            />
            <Select
              value={deptFilter}
              onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
              options={departments.map((d) => ({ value: d, label: d }))}
              placeholder="All departments"
            />
            <Select
              value={levelFilter}
              onChange={(e) => { setLevelFilter(e.target.value); setPage(1); }}
              options={levels.map((l) => ({ value: l, label: l }))}
              placeholder="All levels"
            />
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              options={[
                { value: "DRAFT", label: "Draft" },
                { value: "PENDING", label: "Pending" },
                { value: "APPROVED", label: "Approved" },
                { value: "REJECTED", label: "Rejected" },
                { value: "ESCALATED", label: "Escalated" },
              ]}
              placeholder="All statuses"
            />
            <Select
              value={outlierFilter}
              onChange={(e) => { setOutlierFilter(e.target.value); setPage(1); }}
              options={[
                { value: "true", label: "Outliers only" },
                { value: "false", label: "Non-outliers" },
              ]}
              placeholder="All"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            size="sm"
            onClick={() => handleBulkAction("approve")}
            disabled={bulkApprovalMutation.isPending}
          >
            {bulkApprovalMutation.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-3 w-3" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleBulkAction("reject")}
            disabled={bulkApprovalMutation.isPending}
          >
            <XCircle className="mr-1 h-3 w-3" />
            Reject
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}


      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {recsLoading || cyclesLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !selectedCycleId ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">Select a cycle</p>
              <p className="text-sm text-muted-foreground">
                Choose a compensation cycle above to view recommendations.
              </p>
            </div>
          ) : sortedRecs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No recommendations found</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your filters to see more results.
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <input
                        type="checkbox"
                        checked={selected.size === recommendations.length && recommendations.length > 0}
                        onChange={toggleAll}
                        className="rounded border-gray-300"
                      />
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("employeeName")}>
                        Employee <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("department")}>
                        Dept <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort("level")}>
                        Level <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => handleSort("currentSalary")}>
                        Current <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => handleSort("proposedSalary")}>
                        Proposed <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 ml-auto hover:text-foreground" onClick={() => handleSort("changePercent")}>
                        Change % <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRecs.map((rec) => (
                    <TableRow key={rec.id} className={rec.isOutlier ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(rec.id)}
                          onChange={() => toggleSelect(rec.id)}
                          className="rounded border-gray-300"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{rec.employeeName}</TableCell>
                      <TableCell className="text-sm">{rec.department}</TableCell>
                      <TableCell className="text-sm">{rec.level}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(rec.currentSalary)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{formatCurrency(rec.proposedSalary)}</TableCell>
                      <TableCell className="text-right">
                        <span className={rec.changePercent > 10 ? "text-red-600 font-medium" : rec.changePercent > 5 ? "text-amber-600" : "text-sm"}>
                          {formatPercent(rec.changePercent)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant={STATUS_VARIANT[rec.status]}>{rec.status}</Badge>
                          {rec.status === "PENDING" && (
                            <div className="flex gap-0.5 ml-1">
                              <button
                                onClick={() => handleStatusChange(rec.id, "APPROVED")}
                                className="rounded p-0.5 hover:bg-green-100 dark:hover:bg-green-900/30"
                                title="Approve"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                              </button>
                              <button
                                onClick={() => handleStatusChange(rec.id, "REJECTED")}
                                className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30"
                                title="Reject"
                              >
                                <XCircle className="h-3.5 w-3.5 text-red-600" />
                              </button>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {rec.isOutlier && (
                          <span title="Outlier"><AlertTriangle className="h-4 w-4 text-amber-500" /></span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages} · {totalRecs} total recommendations
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="mr-1 h-3 w-3" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      Next
                      <ChevronRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
