"use client";

import { useState, useEffect, useCallback } from "react";
import { ScrollText, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";

interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

const ACTION_OPTIONS = [
  { value: "", label: "All Actions" },
  { value: "CREATE", label: "Create" },
  { value: "UPDATE", label: "Update" },
  { value: "DELETE", label: "Delete" },
  { value: "LOGIN", label: "Login" },
  { value: "EXPORT", label: "Export" },
];

const ENTITY_OPTIONS = [
  { value: "", label: "All Entities" },
  { value: "Employee", label: "Employee" },
  { value: "User", label: "User" },
  { value: "CompCycle", label: "Comp Cycle" },
  { value: "RuleSet", label: "Rule Set" },
  { value: "BenefitPlan", label: "Benefit Plan" },
  { value: "PayrollRun", label: "Payroll Run" },
];

function actionBadge(action: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    CREATE: { variant: "secondary", className: "bg-green-500/20 text-green-700" },
    UPDATE: { variant: "secondary", className: "bg-blue-500/20 text-blue-700" },
    DELETE: { variant: "destructive", className: "" },
    LOGIN: { variant: "outline", className: "" },
    EXPORT: { variant: "secondary", className: "bg-amber-500/20 text-amber-700" },
  };
  const cfg = map[action] ?? { variant: "outline" as const, className: "" };
  return <Badge variant={cfg.variant} className={cfg.className}>{action}</Badge>;
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page, limit: 20 };
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entityType = entityFilter;
      const result = await apiClient.listAuditLogs(params as Parameters<typeof apiClient.listAuditLogs>[0]);
      setEntries(result.data);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground">
          View system activity and change history.
        </p>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="w-48">
          <Select
            options={ACTION_OPTIONS}
            value={actionFilter}
            onChange={handleFilterChange(setActionFilter)}
            placeholder="Filter by action"
          />
        </div>
        <div className="w-48">
          <Select
            options={ENTITY_OPTIONS}
            value={entityFilter}
            onChange={handleFilterChange(setEntityFilter)}
            placeholder="Filter by entity"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <ScrollText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>
                {loading ? "Loading..." : `${total} entr${total !== 1 ? "ies" : "y"} found`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((k) => (
                <div key={k} className="flex items-center gap-4">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <ScrollText className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Audit Entries</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                No activity has been recorded yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Entity ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="font-medium">
                      {entry.user?.name || entry.user?.email || "System"}
                    </TableCell>
                    <TableCell>{actionBadge(entry.action)}</TableCell>
                    <TableCell>{entry.entityType}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.entityId.length > 12
                        ? `${entry.entityId.slice(0, 12)}…`
                        : entry.entityId}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

