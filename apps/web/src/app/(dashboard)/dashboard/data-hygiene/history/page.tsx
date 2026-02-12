"use client";

import { useState, useCallback } from "react";
import {
  History,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  FileText,
  AlertCircle,
  XCircle,
  ArrowLeft,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useImportList,
  useImportDetail,
  triggerDownload,
  type ImportJob,
  type ImportStatus,
} from "@/hooks/use-imports";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "ANALYZING", label: "Analyzing" },
  { value: "REVIEW", label: "Review" },
  { value: "CLEANING", label: "Cleaning" },
  { value: "APPROVED", label: "Approved" },
  { value: "COMPLETED", label: "Completed" },
];

function statusBadge(status: ImportStatus) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    PENDING: "outline",
    ANALYZING: "secondary",
    REVIEW: "outline",
    CLEANING: "secondary",
    APPROVED: "default",
    COMPLETED: "default",
  };
  return <Badge variant={variants[status] ?? "outline"}>{status}</Badge>;
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

export default function ImportHistoryPage() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const limit = 20;

  const listQuery = useImportList(page, limit, statusFilter || undefined);
  const detailQuery = useImportDetail(selectedId);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value);
    setPage(1);
  }, []);

  // ─── Detail View ──────────────────────────────────────

  if (selectedId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Import Details</h1>
            <p className="text-muted-foreground">
              {detailQuery.data?.fileName ?? "Loading..."}
            </p>
          </div>
        </div>

        {detailQuery.isLoading && (
          <Card>
            <CardContent className="py-12 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </CardContent>
          </Card>
        )}

        {detailQuery.error && (
          <Card>
            <CardContent className="py-8 text-center">
              <XCircle className="mx-auto h-8 w-8 text-destructive" />
              <p className="mt-2 text-sm text-destructive">{detailQuery.error.message}</p>
            </CardContent>
          </Card>
        )}

        {detailQuery.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Status</CardDescription>
                  <div className="pt-1">{statusBadge(detailQuery.data.status)}</div>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Rows</CardDescription>
                  <CardTitle className="text-2xl">{detailQuery.data.totalRows ?? "—"}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Clean Rows</CardDescription>
                  <CardTitle className="text-2xl text-green-600">
                    {detailQuery.data.cleanRows ?? "—"}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Rejected</CardDescription>
                  <CardTitle className="text-2xl text-red-600">
                    {detailQuery.data.rejectRows ?? "—"}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Uploaded</CardDescription>
                  <CardTitle className="text-sm">
                    {formatDate(detailQuery.data.createdAt)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Download buttons */}
            {(detailQuery.data.status === "REVIEW" ||
              detailQuery.data.status === "APPROVED" ||
              detailQuery.data.status === "COMPLETED") && (
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => triggerDownload(selectedId, "cleaned")}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Cleaned CSV
                </Button>
                {(detailQuery.data.rejectRows ?? 0) > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => triggerDownload(selectedId, "rejects")}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Rejects CSV
                  </Button>
                )}
              </div>
            )}

            {/* Issues table */}
            {detailQuery.data.issues.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Issues ({detailQuery.data.issues.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Original</TableHead>
                        <TableHead>Cleaned</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailQuery.data.issues.map((issue) => (
                        <TableRow key={issue.id}>
                          <TableCell className="font-mono text-xs">{issue.row}</TableCell>
                          <TableCell className="text-xs">{issue.fieldName}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {issue.issueType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                issue.severity === "ERROR"
                                  ? "destructive"
                                  : issue.severity === "WARNING"
                                  ? "outline"
                                  : "secondary"
                              }
                            >
                              {issue.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate font-mono text-xs">
                            {issue.originalValue ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate font-mono text-xs text-green-600">
                            {issue.cleanedValue ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── List View ────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import History</h1>
        <p className="text-muted-foreground">View past data imports and their processing status.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="w-48">
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={handleFilterChange}
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading && (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {listQuery.error && (
            <div className="py-8 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
              <p className="mt-2 text-sm text-destructive">{listQuery.error.message}</p>
            </div>
          )}

          {listQuery.data && (
            <>
              {listQuery.data.data.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <History className="h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm font-medium">No imports found</p>
                  <p className="text-xs text-muted-foreground">
                    {statusFilter ? "Try changing the filter." : "Upload a CSV file to get started."}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total Rows</TableHead>
                      <TableHead className="text-right">Clean</TableHead>
                      <TableHead className="text-right">Rejected</TableHead>
                      <TableHead>Uploaded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listQuery.data.data.map((job: ImportJob) => (
                      <TableRow
                        key={job.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(job.id)}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            {job.fileName}
                          </div>
                        </TableCell>
                        <TableCell>{statusBadge(job.status)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {job.totalRows ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-600">
                          {job.cleanRows ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-red-600">
                          {job.rejectRows ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(job.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {listQuery.data && listQuery.data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {listQuery.data.page} of {listQuery.data.totalPages} ({listQuery.data.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= (listQuery.data?.totalPages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

