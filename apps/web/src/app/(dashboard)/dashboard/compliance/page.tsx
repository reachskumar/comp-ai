"use client";

import { useState } from "react";
import { ShieldCheck, Play, Loader2, FileText, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ComplianceScoreGauge,
  ComplianceFindingsList,
  ComplianceRiskBreakdown,
  ComplianceScoreTrend,
} from "@/components/compliance";
import {
  useComplianceScore,
  useComplianceScoreHistory,
  useComplianceScans,
  useComplianceScan,
  useRunComplianceScan,
} from "@/hooks/use-compliance";

export default function ComplianceDashboardPage() {
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  const { data: scoreData, isLoading: scoreLoading } = useComplianceScore();
  const { data: history = [] } = useComplianceScoreHistory();
  const { data: scansData } = useComplianceScans(1, 5);
  const { data: activeScan } = useComplianceScan(activeScanId);
  const runScan = useRunComplianceScan();

  const isScanning = activeScan?.status === "PENDING" || activeScan?.status === "RUNNING";

  const handleRunScan = () => {
    runScan.mutate(undefined, {
      onSuccess: (data) => {
        setActiveScanId(data.id);
        setTab("overview");
      },
    });
  };

  const riskSummary = activeScan?.riskSummary ?? scoreData?.riskSummary ?? null;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Compliance Scanner</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered audit for compensation compliance
            </p>
          </div>
        </div>
        <Button
          onClick={handleRunScan}
          disabled={runScan.isPending || isScanning}
        >
          {runScan.isPending || isScanning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isScanning ? "Scanning…" : "Run Scan"}
        </Button>
      </div>

      {/* Scanning status banner */}
      {isScanning && (
        <Card className="flex items-center gap-3 border-primary/30 bg-primary/5 p-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">Compliance scan in progress</p>
            <p className="text-xs text-muted-foreground">
              Analyzing rules, decisions, compensation data, and benefits…
            </p>
          </div>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Left column: Score + Trend */}
            <div className="space-y-6">
              <Card className="flex flex-col items-center p-6">
                <h3 className="text-sm font-semibold mb-3">Compliance Score</h3>
                {scoreLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                ) : (
                  <ComplianceScoreGauge
                    score={activeScan?.overallScore ?? scoreData?.overallScore ?? null}
                    size="lg"
                  />
                )}
              </Card>
              <ComplianceScoreTrend history={history} />
            </div>

            {/* Right columns: Risk Breakdown */}
            <div className="md:col-span-2">
              <ComplianceRiskBreakdown
                riskSummary={
                  riskSummary
                    ? (riskSummary as { total: number; critical: number; warning: number; info: number; byCategory: Record<string, number>; riskLevel: string })
                    : null
                }
              />

              {/* AI Report */}
              {activeScan?.aiReport && (
                <Card className="mt-6 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">AI Report</h3>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {activeScan.aiReport}
                  </p>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="findings" className="mt-4">
          {activeScan?.findings ? (
            <ComplianceFindingsList findings={activeScan.findings} />
          ) : (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Run a compliance scan to view findings
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="space-y-2">
            {(scansData?.items ?? []).map((scan) => (
              <Card
                key={scan.id}
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setActiveScanId(scan.id)}
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      Score: {scan.overallScore ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {scan.completedAt
                        ? new Date(scan.completedAt).toLocaleString()
                        : scan.createdAt
                          ? new Date(scan.createdAt).toLocaleString()
                          : "In progress"}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    scan.status === "COMPLETED"
                      ? "default"
                      : scan.status === "FAILED"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {scan.status}
                </Badge>
              </Card>
            ))}
            {(!scansData?.items || scansData.items.length === 0) && (
              <Card className="p-8 text-center text-sm text-muted-foreground">
                No scans yet. Click &quot;Run Scan&quot; to start your first compliance audit.
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

