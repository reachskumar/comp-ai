"use client";

import { useState, useEffect, type KeyboardEvent } from "react";
import {
  FileBarChart,
  Send,
  Square,
  Loader2,
  Sparkles,
  Download,
  Save,
  BarChart3,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Table as TableIcon,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useReports, type ReportChartConfig } from "@/hooks/use-reports";
import { ReportChart } from "@/components/reports/report-chart";
import { ReportTable } from "@/components/reports/report-table";

const SUGGESTED_PROMPTS = [
  "Show average salary by department",
  "How many employees per level?",
  "Total compensation spend by department",
  "Salary range analysis across locations",
  "List top 20 highest-paid employees",
  "Show compensation cycle budgets",
];

const CHART_TYPES: { value: ReportChartConfig["type"]; label: string; icon: typeof BarChart3 }[] = [
  { value: "bar", label: "Bar", icon: BarChart3 },
  { value: "line", label: "Line", icon: LineChartIcon },
  { value: "pie", label: "Pie", icon: PieChartIcon },
  { value: "table", label: "Table", icon: TableIcon },
];

export default function ReportsPage() {
  const {
    isStreaming,
    activeNode,
    error,
    streamedContent,
    report,
    savedReports,
    generateReport,
    stopStreaming,
    saveReport,
    loadSavedReports,
    exportReport,
    clearReport,
  } = useReports();

  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("chart");
  const [chartType, setChartType] = useState<ReportChartConfig["type"]>("bar");

  useEffect(() => {
    void loadSavedReports();
  }, [loadSavedReports]);

  useEffect(() => {
    if (report?.chartConfig?.type) {
      setChartType(report.chartConfig.type);
    }
  }, [report]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    void generateReport(input);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSave = async () => {
    if (!report) return;
    await saveReport({
      title: report.title,
      prompt: input,
      queryType: report.queryType,
      results: report.data,
      chartConfig: { ...report.chartConfig, type: chartType },
      narrative: report.narrative,
    });
    void loadSavedReports();
  };

  const effectiveChartConfig: ReportChartConfig = report?.chartConfig
    ? { ...report.chartConfig, type: chartType }
    : { type: chartType };

  const hasReport = report !== null;
  const showWelcome = !hasReport && !isStreaming && !streamedContent;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <FileBarChart className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Report Builder</h1>
            <p className="text-xs text-muted-foreground">
              {isStreaming
                ? activeNode === "tools"
                  ? "Querying data…"
                  : "Generating report…"
                : "Describe the report you need in natural language"}
            </p>
          </div>
        </div>
        {hasReport && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void handleSave()}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
            <Button variant="ghost" size="sm" onClick={clearReport}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Report Area */}
        <div className="flex flex-1 flex-col">
          {showWelcome ? (
            <WelcomeScreen onPromptClick={(p) => { setInput(p); void generateReport(p); }} />
          ) : (
            <div className="flex-1 overflow-auto p-4">
              {isStreaming && !report && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {activeNode === "tools" ? "Querying your data…" : "Analyzing and building report…"}
                  </p>
                  {streamedContent && (
                    <Card className="mx-auto mt-4 max-w-2xl">
                      <CardContent className="p-4 text-sm whitespace-pre-wrap">
                        {streamedContent}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {error && (
                <div className="mx-auto max-w-2xl rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {hasReport && (
                <div className="mx-auto max-w-4xl space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle>{report.title}</CardTitle>
                        <div className="flex gap-1">
                          {CHART_TYPES.map(({ value, label, icon: Icon }) => (
                            <Button
                              key={value}
                              variant={chartType === value ? "default" : "ghost"}
                              size="sm"
                              onClick={() => setChartType(value)}
                            >
                              <Icon className="mr-1 h-3 w-3" /> {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList>
                          <TabsTrigger value="chart">Chart</TabsTrigger>
                          <TabsTrigger value="table">Table</TabsTrigger>
                          <TabsTrigger value="narrative">Summary</TabsTrigger>
                        </TabsList>
                        <TabsContent value="chart" className="pt-4">
                          {chartType === "table" ? (
                            <ReportTable data={report.data} columns={report.columns} />
                          ) : (
                            <ReportChart data={report.data} config={effectiveChartConfig} />
                          )}
                        </TabsContent>
                        <TabsContent value="table" className="pt-4">
                          <ReportTable data={report.data} columns={report.columns} />
                        </TabsContent>
                        <TabsContent value="narrative" className="pt-4">
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {report.narrative || "No narrative summary available."}
                          </p>
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Input Area */}
          <div className="border-t px-4 py-3">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <Card className="flex flex-1 items-end overflow-hidden p-0">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe the report you want…"
                  disabled={isStreaming}
                  rows={1}
                  className="flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                />
              </Card>
              {isStreaming ? (
                <Button size="icon" variant="destructive" onClick={stopStreaming}>
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Saved Reports */}
        {savedReports.length > 0 && (
          <div className="hidden w-64 border-l lg:block">
            <div className="p-3">
              <h3 className="mb-2 text-sm font-medium flex items-center gap-1">
                <Clock className="h-3 w-3" /> Saved Reports
              </h3>
              <div className="space-y-1">
                {savedReports.slice(0, 10).map((r) => (
                  <button
                    key={r.id}
                    className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent transition-colors"
                    onClick={() => setInput(r.prompt)}
                  >
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-muted-foreground truncate">{r.prompt}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WelcomeScreen({ onPromptClick }: { onPromptClick: (p: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold">AI Report Builder</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          Describe the report you need in plain English. We&apos;ll query your data,
          generate charts, and provide insights.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            onClick={() => onPromptClick(prompt)}
            className="rounded-lg border bg-card px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

