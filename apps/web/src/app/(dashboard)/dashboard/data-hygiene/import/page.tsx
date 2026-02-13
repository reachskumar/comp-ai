"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  XCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  useUploadMutation,
  useAnalysis,
  useCleanMutation,
  useApproveMutation,
  useAIAnalyzeMutation,
  useAIReport,
  useAIFixMutation,
  triggerDownload,
  type UploadResponse,
  type CleanResponse,
  type AIQualityReport,
} from "@/hooks/use-imports";

type Step = "upload" | "analysis" | "cleaning" | "review" | "approved";

export default function ImportFilesPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("upload");
  const [jobId, setJobId] = useState<string | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanResponse | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [diffTab, setDiffTab] = useState("diffs");

  const uploadMutation = useUploadMutation();
  const analysisQuery = useAnalysis(
    step === "analysis" || step === "cleaning" || step === "review" ? jobId : null
  );
  const cleanMutation = useCleanMutation();
  const approveMutation = useApproveMutation();

  // AI Data Quality hooks
  const aiAnalyzeMutation = useAIAnalyzeMutation();
  const aiReportQuery = useAIReport(jobId ?? undefined);
  const aiFixMutation = useAIFixMutation();
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // ─── Upload handlers ──────────────────────────────────

  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        toast({
          title: "Invalid file type",
          description: "Please upload a CSV file.",
          variant: "destructive",
        });
        return;
      }
      uploadMutation.mutate(file, {
        onSuccess: (data: UploadResponse) => {
          setJobId(data.id);
          toast({
            title: "Upload complete",
            description: `${data.fileName} — ${data.totalRows} rows detected`,
          });
          setStep("analysis");
        },
        onError: (err) => {
          toast({ title: "Upload failed", description: err.message, variant: "destructive" });
        },
      });
    },
    [uploadMutation, toast]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // ─── Clean handler ────────────────────────────────────

  const handleClean = useCallback(() => {
    if (!jobId) return;
    setStep("cleaning");
    cleanMutation.mutate(jobId, {
      onSuccess: (data) => {
        setCleanResult(data);
        setStep("review");
        toast({
          title: "Cleaning complete",
          description: `${data.cleanedRows} cleaned, ${data.rejectedRows} rejected`,
        });
      },
      onError: (err) => {
        setStep("analysis");
        toast({ title: "Cleaning failed", description: err.message, variant: "destructive" });
      },
    });
  }, [jobId, cleanMutation, toast]);

  // ─── Approve handler ─────────────────────────────────

  const handleApprove = useCallback(() => {
    if (!jobId) return;
    setApproveDialogOpen(false);
    approveMutation.mutate(jobId, {
      onSuccess: (data) => {
        setStep("approved");
        toast({
          title: "Import approved!",
          description: `${data.created} created, ${data.updated} updated`,
        });
      },
      onError: (err) => {
        toast({ title: "Approval failed", description: err.message, variant: "destructive" });
      },
    });
  }, [jobId, approveMutation, toast]);

  const analysis = analysisQuery.data?.analysis;
  const summary = analysis?.summary;

  // ─── Severity helpers ─────────────────────────────────

  const severityBadge = (s: string) => {
    const v =
      s === "ERROR" ? "destructive" : s === "WARNING" ? ("outline" as const) : ("secondary" as const);
    return <Badge variant={v}>{s}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import Files</h1>
        <p className="text-muted-foreground">
          Upload, validate, and clean compensation data files.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "analysis", "cleaning", "review", "approved"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-border" />}
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                step === s
                  ? "bg-primary text-primary-foreground"
                  : (["upload", "analysis", "cleaning", "review", "approved"].indexOf(step) >
                    ["upload", "analysis", "cleaning", "review", "approved"].indexOf(s)
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground")
              }`}
            >
              {i + 1}
            </div>
            <span className="hidden sm:inline capitalize">{s === "review" ? "Review Diff" : s}</span>
          </div>
        ))}
      </div>

      {/* ─── STEP: Upload ─────────────────────────────── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Upload CSV File</CardTitle>
            <CardDescription>
              Drag and drop or click to select a CSV file with compensation data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="mt-4 text-sm font-medium">Uploading and analyzing...</p>
                  <Progress indeterminate className="mt-4 w-64" />
                </>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="mt-4 text-sm font-medium">
                    Drop your CSV file here, or{" "}
                    <label className="cursor-pointer text-primary underline">
                      browse
                      <input
                        type="file"
                        accept=".csv"
                        className="sr-only"
                        onChange={onFileChange}
                      />
                    </label>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">CSV files only, up to 50 MB</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP: Analysis ───────────────────────────── */}
      {step === "analysis" && (
        <>
          {analysisQuery.isLoading && (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-3 text-sm">Analyzing file...</span>
              </CardContent>
            </Card>
          )}

          {analysisQuery.error && (
            <Card>
              <CardContent className="py-8 text-center">
                <XCircle className="mx-auto h-8 w-8 text-destructive" />
                <p className="mt-2 text-sm text-destructive">{analysisQuery.error.message}</p>
                <Button variant="outline" className="mt-4" onClick={() => setStep("upload")}>
                  Try Again
                </Button>
              </CardContent>
            </Card>
          )}

          {analysis && summary && (
            <>
              {/* Summary cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Rows</CardDescription>
                    <CardTitle className="text-2xl">{analysis.fileInfo.totalRows}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Issues</CardDescription>
                    <CardTitle className="text-2xl">{summary.totalIssues}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 text-red-500" /> Errors
                    </CardDescription>
                    <CardTitle className="text-2xl text-red-600">{summary.errorCount}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-yellow-500" /> Warnings
                    </CardDescription>
                    <CardTitle className="text-2xl text-yellow-600">
                      {summary.warningCount}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              {/* Issues table */}
              <Card>
                <CardHeader>
                  <CardTitle>Issues Found</CardTitle>
                  <CardDescription>
                    Issues grouped by column — review before cleaning.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {analysis.issues.length === 0 ? (
                    <div className="flex flex-col items-center py-8 text-center">
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                      <p className="mt-2 text-sm font-medium">No issues found!</p>
                      <p className="text-xs text-muted-foreground">Your data looks clean.</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Original</TableHead>
                          <TableHead>Suggested Fix</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analysis.issues.slice(0, 50).map((issue, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs">{issue.row}</TableCell>
                            <TableCell className="text-xs">
                              {analysis.fieldReports[issue.column]?.columnName ??
                                `Col ${issue.column}`}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {issue.type}
                              </Badge>
                            </TableCell>
                            <TableCell>{severityBadge(issue.severity)}</TableCell>
                            <TableCell className="max-w-[150px] truncate font-mono text-xs">
                              {issue.originalValue}
                            </TableCell>
                            <TableCell className="max-w-[150px] truncate font-mono text-xs text-green-600">
                              {issue.suggestedFix || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {analysis.issues.length > 50 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing 50 of {analysis.issues.length} issues.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Upload Different File
                </Button>
                <Button onClick={handleClean}>
                  <FileText className="mr-2 h-4 w-4" />
                  Run Cleaning
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (jobId) {
                      aiAnalyzeMutation.mutate(jobId, {
                        onSuccess: () => {
                          setAiPanelOpen(true);
                          toast({ title: "AI Analysis started", description: "Analyzing data quality with AI..." });
                        },
                        onError: (err) => {
                          toast({ title: "AI Analysis failed", description: err.message, variant: "destructive" });
                        },
                      });
                    }
                  }}
                  disabled={aiAnalyzeMutation.isPending}
                >
                  {aiAnalyzeMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  AI Quality Report
                </Button>
              </div>

              {/* AI Quality Report Panel */}
              {(aiPanelOpen || aiReportQuery.data) && (
                <AIReportPanel
                  report={aiReportQuery.data?.report as AIQualityReport | undefined}
                  status={aiReportQuery.data?.status}
                  errorMsg={aiReportQuery.data?.errorMsg}
                  expandedGroups={expandedGroups}
                  onToggleGroup={(idx) => {
                    setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx);
                      else next.add(idx);
                      return next;
                    });
                  }}
                  onApplyFix={(fixes) => {
                    if (!jobId) return;
                    aiFixMutation.mutate(
                      { importJobId: jobId, fixes },
                      {
                        onSuccess: (data) => {
                          toast({
                            title: "Fixes applied",
                            description: `${data.applied} of ${data.total} fixes applied successfully`,
                          });
                        },
                        onError: (err) => {
                          toast({ title: "Fix failed", description: err.message, variant: "destructive" });
                        },
                      }
                    );
                  }}
                  isFixing={aiFixMutation.isPending}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ─── STEP: Cleaning in progress ──────────────── */}
      {step === "cleaning" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm font-medium">Running cleaning pipeline...</p>
            <Progress indeterminate className="mt-4 w-64" />
          </CardContent>
        </Card>
      )}

      {/* ─── STEP: Review Diff ───────────────────────── */}
      {step === "review" && cleanResult && (
        <>
          {/* Cleaning summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Rows</CardDescription>
                <CardTitle className="text-2xl">{cleanResult.summary.totalRows}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Cleaned</CardDescription>
                <CardTitle className="text-2xl text-green-600">
                  {cleanResult.summary.cleanedRows}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Rejected</CardDescription>
                <CardTitle className="text-2xl text-red-600">
                  {cleanResult.summary.rejectedRows}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Unchanged</CardDescription>
                <CardTitle className="text-2xl text-muted-foreground">
                  {cleanResult.summary.unchangedRows}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Diff viewer with tabs */}
          <Card>
            <CardHeader>
              <CardTitle>Diff Report</CardTitle>
              <CardDescription>
                Review changes before approving the import.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={diffTab} onValueChange={setDiffTab}>
                <TabsList>
                  <TabsTrigger value="diffs">
                    Cell Changes ({cleanResult.diffReport.length})
                  </TabsTrigger>
                  <TabsTrigger value="operations">Operations</TabsTrigger>
                </TabsList>
                <TabsContent value="diffs">
                  {cleanResult.diffReport.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No cell-level changes were made.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Original</TableHead>
                          <TableHead>Cleaned</TableHead>
                          <TableHead>Operations</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cleanResult.diffReport.slice(0, 100).map((diff, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-xs">{diff.row}</TableCell>
                            <TableCell className="text-xs">{diff.columnName}</TableCell>
                            <TableCell className="max-w-[200px] truncate font-mono text-xs">
                              <span className="rounded bg-red-100 px-1 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                {diff.originalValue || "(empty)"}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate font-mono text-xs">
                              <span className="rounded bg-green-100 px-1 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                {diff.cleanedValue || "(empty)"}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {diff.operations.map((op, oi) => (
                                  <Badge key={oi} variant="secondary" className="text-xs">
                                    {op}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {cleanResult.diffReport.length > 100 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing 100 of {cleanResult.diffReport.length} changes.
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="operations">
                  <div className="space-y-2 py-4">
                    {Object.entries(cleanResult.summary.operationCounts).map(([op, count]) => (
                      <div key={op} className="flex items-center justify-between rounded-md border px-4 py-2">
                        <span className="text-sm font-medium">{op}</span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    ))}
                    {Object.keys(cleanResult.summary.operationCounts).length === 0 && (
                      <p className="text-center text-sm text-muted-foreground">No operations recorded.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => jobId && triggerDownload(jobId, "cleaned")}>
              <Download className="mr-2 h-4 w-4" />
              Download Cleaned CSV
            </Button>
            {cleanResult.rejectedRows > 0 && (
              <Button variant="outline" onClick={() => jobId && triggerDownload(jobId, "rejects")}>
                <Download className="mr-2 h-4 w-4" />
                Download Rejects CSV
              </Button>
            )}
            <Button onClick={() => setApproveDialogOpen(true)} disabled={approveMutation.isPending}>
              {approveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Approve &amp; Import
            </Button>
          </div>

          {/* Approve confirmation dialog */}
          <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
            <DialogContent onClose={() => setApproveDialogOpen(false)}>
              <DialogHeader>
                <DialogTitle>Confirm Import</DialogTitle>
                <DialogDescription>
                  This will import {cleanResult.cleanedRows} cleaned rows into the system.
                  {cleanResult.rejectedRows > 0 &&
                    ` ${cleanResult.rejectedRows} rows will be rejected.`}{" "}
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleApprove}>Confirm Import</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* ─── STEP: Approved ──────────────────────────── */}
      {step === "approved" && (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <h2 className="mt-4 text-lg font-semibold">Import Complete!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your data has been successfully imported.
            </p>
            <div className="mt-6 flex gap-3">
              <Button variant="outline" onClick={() => router.push("/dashboard/data-hygiene/history")}>
                View History
              </Button>
              <Button
                onClick={() => {
                  setStep("upload");
                  setJobId(null);
                  setCleanResult(null);
                }}
              >
                Import Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}



// ─── AI Report Panel Component ──────────────────────────────

function AIReportPanel({
  report,
  status,
  errorMsg,
  expandedGroups,
  onToggleGroup,
  onApplyFix,
  isFixing,
}: {
  report?: AIQualityReport;
  status?: string;
  errorMsg?: string | null;
  expandedGroups: Set<number>;
  onToggleGroup: (idx: number) => void;
  onApplyFix: (fixes: Array<{ row: number; column: string; suggestedValue: string }>) => void;
  isFixing: boolean;
}) {
  if (status === "RUNNING" || status === "PENDING") {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-3 text-sm">AI is analyzing your data...</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "FAILED") {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <XCircle className="mx-auto h-6 w-6 text-destructive" />
          <p className="mt-2 text-sm text-destructive">
            AI analysis failed: {errorMsg ?? "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  const scoreColor =
    report.qualityScore >= 80
      ? "text-green-600"
      : report.qualityScore >= 50
        ? "text-yellow-600"
        : "text-red-600";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>AI Quality Report</CardTitle>
          </div>
          <div className={`text-3xl font-bold ${scoreColor}`}>
            {report.qualityScore}/100
          </div>
        </div>
        <CardDescription>{report.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Issue Groups */}
        {report.issueGroups.map((group, idx) => (
          <div key={idx} className="rounded-lg border">
            <button
              onClick={() => onToggleGroup(idx)}
              className="flex w-full items-center justify-between p-3 text-left hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    group.severity === "ERROR"
                      ? "destructive"
                      : group.severity === "WARNING"
                        ? "outline"
                        : "secondary"
                  }
                >
                  {group.severity}
                </Badge>
                <span className="text-sm font-medium">{group.groupName}</span>
                <span className="text-xs text-muted-foreground">({group.count} issues)</span>
              </div>
              {expandedGroups.has(idx) ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {expandedGroups.has(idx) && (
              <div className="border-t p-3 space-y-3">
                <p className="text-sm text-muted-foreground">{group.explanation}</p>

                {group.suggestedFixes.length > 0 && (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Column</TableHead>
                          <TableHead>Original</TableHead>
                          <TableHead>Suggested Fix</TableHead>
                          <TableHead>Confidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.suggestedFixes.slice(0, 10).map((fix, fIdx) => (
                          <TableRow key={fIdx}>
                            <TableCell className="font-mono text-xs">{fix.row}</TableCell>
                            <TableCell className="text-xs">{fix.column}</TableCell>
                            <TableCell className="max-w-[120px] truncate font-mono text-xs text-red-500">
                              {fix.originalValue}
                            </TableCell>
                            <TableCell className="max-w-[120px] truncate font-mono text-xs text-green-600">
                              {fix.suggestedValue}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-xs">
                                {Math.round(fix.confidence * 100)}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isFixing}
                      onClick={() =>
                        onApplyFix(
                          group.suggestedFixes.map((f) => ({
                            row: f.row,
                            column: f.column,
                            suggestedValue: f.suggestedValue,
                          }))
                        )
                      }
                    >
                      {isFixing ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-3 w-3" />
                      )}
                      Apply {group.suggestedFixes.length} Fixes
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Recommendations */}
        {report.recommendations.length > 0 && (
          <div className="rounded-lg border p-3">
            <h4 className="text-sm font-medium mb-2">Recommendations</h4>
            <ul className="list-disc list-inside space-y-1">
              {report.recommendations.map((rec, idx) => (
                <li key={idx} className="text-sm text-muted-foreground">{rec}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Bulk Apply All */}
        {report.issueGroups.some((g) => g.suggestedFixes.length > 0) && (
          <Button
            disabled={isFixing}
            onClick={() => {
              const allFixes = report.issueGroups.flatMap((g) =>
                g.suggestedFixes.map((f) => ({
                  row: f.row,
                  column: f.column,
                  suggestedValue: f.suggestedValue,
                }))
              );
              onApplyFix(allFixes);
            }}
          >
            {isFixing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Apply All AI Fixes
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
