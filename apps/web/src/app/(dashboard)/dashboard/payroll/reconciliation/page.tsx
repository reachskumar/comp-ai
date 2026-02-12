"use client";

import * as React from "react";
import {
  FileCheck,
  Download,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Shield,
  ArrowRight,
  GitCommitHorizontal,
  Gavel,
  ThumbsUp,
  DollarSign,
  Database,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  usePayrollRuns,
  useReconciliationReport,
  useResolveAnomaly,
  triggerExport,
  type PayrollAnomaly,
  type AnomalySeverity,
  type AnomalyType,
  type TraceStep,
  type TraceReport,
} from "@/hooks/use-payroll";

// ─── Helpers ────────────────────────────────────────────────────

function severityBadge(severity: AnomalySeverity) {
  const map: Record<AnomalySeverity, { variant: "destructive" | "default" | "secondary" | "outline"; className: string }> = {
    CRITICAL: { variant: "destructive", className: "" },
    HIGH: { variant: "default", className: "bg-orange-500 hover:bg-orange-500/80" },
    MEDIUM: { variant: "secondary", className: "bg-yellow-500/20 text-yellow-700" },
    LOW: { variant: "outline", className: "text-blue-600 border-blue-300" },
  };
  const cfg = map[severity];
  return <Badge variant={cfg.variant} className={cfg.className}>{severity}</Badge>;
}

function typeLabel(type: AnomalyType): string {
  const labels: Record<AnomalyType, string> = {
    NEGATIVE_NET: "Negative Net",
    SPIKE: "Spike",
    DROP: "Drop",
    UNUSUAL_DEDUCTION: "Unusual Deduction",
    MISSING_COMPONENT: "Missing Component",
    DUPLICATE: "Duplicate",
    CUSTOM: "Custom",
  };
  return labels[type] ?? type;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
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

const STEP_ICONS: Record<TraceStep["type"], React.ReactNode> = {
  DATA_CHANGE: <Database className="h-4 w-4" />,
  RULE_APPLIED: <Gavel className="h-4 w-4" />,
  RECOMMENDATION: <GitCommitHorizontal className="h-4 w-4" />,
  APPROVAL: <ThumbsUp className="h-4 w-4" />,
  PAYROLL_IMPACT: <DollarSign className="h-4 w-4" />,
};

const STEP_COLORS: Record<TraceStep["type"], string> = {
  DATA_CHANGE: "border-blue-400 bg-blue-50",
  RULE_APPLIED: "border-purple-400 bg-purple-50",
  RECOMMENDATION: "border-yellow-400 bg-yellow-50",
  APPROVAL: "border-green-400 bg-green-50",
  PAYROLL_IMPACT: "border-red-400 bg-red-50",
};


// ─── Trace Viewer Component ─────────────────────────────────────

function TraceViewer({ trace }: { trace: TraceReport }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold">{trace.employeeName}</h4>
        {trace.component && (
          <Badge variant="outline" className="text-xs">{trace.component}</Badge>
        )}
        {!trace.isComplete && (
          <Badge variant="secondary" className="text-xs bg-yellow-500/20 text-yellow-700">Partial</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">{trace.summary}</p>
      {trace.warnings.length > 0 && (
        <div className="mb-4 space-y-1">
          {trace.warnings.map((w, i) => (
            <p key={i} className="text-xs text-orange-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {w}
            </p>
          ))}
        </div>
      )}
      {/* Vertical timeline */}
      <div className="relative ml-4">
        {/* Connector line */}
        <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
        <div className="space-y-4">
          {trace.steps
            .sort((a, b) => a.order - b.order)
            .map((step, idx) => (
            <div key={idx} className="relative flex gap-3">
              {/* Dot */}
              <div className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${STEP_COLORS[step.type]}`}>
                {STEP_ICONS[step.type]}
              </div>
              {/* Card */}
              <Card className={`flex-1 border-l-2 ${STEP_COLORS[step.type]}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{step.type.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(step.timestamp)}</span>
                  </div>
                  <p className="text-sm">{step.action}</p>
                  {step.actor && (
                    <p className="text-xs text-muted-foreground mt-1">Actor: {step.actor}</p>
                  )}
                  {(step.beforeValue || step.afterValue) && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      {step.beforeValue && (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-red-700">{step.beforeValue}</span>
                      )}
                      {step.beforeValue && step.afterValue && <ArrowRight className="h-3 w-3" />}
                      {step.afterValue && (
                        <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">{step.afterValue}</span>
                      )}
                    </div>
                  )}
                  {step.explanation && (
                    <p className="mt-1 text-xs italic text-muted-foreground">{step.explanation}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Anomaly Detail + Resolution Component ──────────────────────

function AnomalyRow({
  anomaly,
  trace,
  runId,
}: {
  anomaly: PayrollAnomaly;
  trace: TraceReport | undefined;
  runId: string;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const resolveMutation = useResolveAnomaly(runId);

  const handleResolve = () => {
    if (!notes.trim()) return;
    resolveMutation.mutate(
      { anomalyId: anomaly.id, resolutionNotes: notes },
      {
        onSuccess: () => {
          toast({ title: "Anomaly resolved", description: `Anomaly ${anomaly.id.slice(0, 8)} marked as resolved.` });
          setNotes("");
          setExpanded(false);
        },
        onError: (err) => {
          toast({ title: "Resolution failed", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="border rounded-lg">
      {/* Collapsed row */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {severityBadge(anomaly.severity)}
          <span className="font-medium text-sm">{typeLabel(anomaly.anomalyType)}</span>
          <span className="font-mono text-xs text-muted-foreground">{anomaly.employeeId.slice(0, 8)}…</span>
        </div>
        <div className="flex items-center gap-3">
          {anomaly.resolved ? (
            <Badge variant="secondary" className="bg-green-500/20 text-green-700">Resolved</Badge>
          ) : (
            <Badge variant="outline" className="text-orange-600 border-orange-300">Open</Badge>
          )}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4">
          {/* Details JSON */}
          <div>
            <p className="text-xs font-semibold mb-1">Details</p>
            <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">
              {JSON.stringify(anomaly.details, null, 2)}
            </pre>
          </div>

          {/* Trace viewer */}
          {trace && (
            <div>
              <p className="text-xs font-semibold mb-2">Trace</p>
              <TraceViewer trace={trace} />
            </div>
          )}

          {/* Resolution workflow */}
          {!anomaly.resolved && (
            <div className="space-y-2 pt-2 border-t">
              <Label htmlFor={`resolve-${anomaly.id}`} className="text-xs font-semibold">
                Resolution Notes
              </Label>
              <Textarea
                id={`resolve-${anomaly.id}`}
                placeholder="Describe the resolution..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
              <Button
                size="sm"
                onClick={handleResolve}
                disabled={resolveMutation.isPending || !notes.trim()}
              >
                {resolveMutation.isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Resolve Anomaly
              </Button>
            </div>
          )}

          {anomaly.resolved && anomaly.resolvedAt && (
            <p className="text-xs text-muted-foreground">
              Resolved on {formatDate(anomaly.resolvedAt)} by {anomaly.resolvedBy ?? "unknown"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────────

export default function ReconciliationPage() {
  const { toast } = useToast();
  const [selectedRunId, setSelectedRunId] = React.useState("");

  // Load runs for selector
  const runsQuery = usePayrollRuns(1, 100);
  const runs = runsQuery.data?.data ?? [];

  React.useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      const withAnomalies = runs.find((r) => (r._count?.anomalies ?? 0) > 0);
      setSelectedRunId(withAnomalies?.id ?? runs[0]?.id ?? "");
    }
  }, [runs, selectedRunId]);

  const reportQuery = useReconciliationReport(selectedRunId || null);
  const report = reportQuery.data;
  const summary = report?.summary;

  // Build a map: employeeId -> TraceReport for quick lookup
  const traceMap = React.useMemo(() => {
    const m = new Map<string, TraceReport>();
    if (report?.traces) {
      for (const t of report.traces) {
        m.set(t.employeeId, t);
      }
    }
    return m;
  }, [report?.traces]);

  const handleExport = (format: "csv" | "pdf") => {
    if (!selectedRunId) return;
    triggerExport(selectedRunId, format);
    toast({ title: "Export started", description: `Downloading ${format.toUpperCase()} report...` });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reconciliation Report</h1>
          <p className="text-muted-foreground">Review anomalies, traces, and resolve issues.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")} disabled={!selectedRunId}>
            <Download className="mr-1 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("pdf")} disabled={!selectedRunId}>
            <Download className="mr-1 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {/* Run Selector */}
      <div className="flex items-center gap-4">
        <div className="w-64">
          <Select
            options={[
              { value: "", label: "Select a payroll run..." },
              ...runs.map((r) => ({
                value: r.id,
                label: `${r.period} — ${r.status}`,
              })),
            ]}
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
          />
        </div>
      </div>

      {/* Loading / Error / Empty */}
      {!selectedRunId ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center">
              <FileCheck className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No run selected</p>
              <p className="text-xs text-muted-foreground">Choose a payroll run to view its reconciliation report.</p>
            </div>
          </CardContent>
        </Card>
      ) : reportQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : reportQuery.isError ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center">
              <XCircle className="h-8 w-8 text-red-500" />
              <p className="mt-2 text-sm font-medium">Failed to load report</p>
              <p className="text-xs text-muted-foreground">{reportQuery.error?.message}</p>
            </div>
          </CardContent>
        </Card>
      ) : report && summary ? (
        <>
          {/* Summary Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" /> Report Summary
              </CardTitle>
              <CardDescription>
                Generated {formatDate(report.generatedAt)} • Period: {summary.period}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Employees</p>
                  <p className="text-xl font-bold">{summary.totalEmployees}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Gross</p>
                  <p className="text-xl font-bold">{formatCurrency(summary.totalGross)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Net</p>
                  <p className="text-xl font-bold">{formatCurrency(summary.totalNet)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount at Risk</p>
                  <p className="text-xl font-bold text-red-600">{formatCurrency(summary.totalAmountAtRisk)}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Anomalies</p>
                  <p className="text-lg font-semibold">{summary.totalAnomalies}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Unresolved</p>
                  <p className="text-lg font-semibold text-orange-600">{summary.unresolvedCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Resolved</p>
                  <p className="text-lg font-semibold text-green-600">{summary.resolvedCount}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Has Blockers</p>
                  <p className="text-lg font-semibold">
                    {summary.hasBlockers ? (
                      <span className="text-red-600 flex items-center gap-1"><AlertCircle className="h-4 w-4" /> Yes</span>
                    ) : (
                      <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> No</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Severity breakdown */}
              {Object.keys(summary.anomaliesBySeverity).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(summary.anomaliesBySeverity).map(([sev, count]) => (
                    <Badge key={sev} variant="outline" className="text-xs">
                      {sev}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Anomalies List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> Anomalies ({report.anomalies.length})
              </CardTitle>
              <CardDescription>Click an anomaly to view details, trace, and resolve.</CardDescription>
            </CardHeader>
            <CardContent>
              {report.anomalies.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                  <p className="mt-2 text-sm font-medium">All clear!</p>
                  <p className="text-xs text-muted-foreground">No anomalies detected for this run.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {report.anomalies.map((a) => (
                    <AnomalyRow
                      key={a.id}
                      anomaly={a}
                      trace={traceMap.get(a.employeeId)}
                      runId={selectedRunId}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}