"use client";

import * as React from "react";
import {
  Sparkles,
  Loader2,
  Send,
  Users,
  DollarSign,
  TrendingUp,
  History,
  GitCompare,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiClient } from "@/lib/api-client";

/* ─── Types ────────────────────────────────────────── */

interface SimulationResult {
  id: string;
  response: string;
  affectedCount: number | null;
  totalCostDelta: number | null;
  budgetImpactPct: number | null;
}

interface CompareResult {
  scenarioA: { id: string; response: string };
  scenarioB: { id: string; response: string };
}

interface HistoryItem {
  id: string;
  name: string | null;
  prompt: string;
  status: string;
  affectedCount: number | null;
  totalCostDelta: number | null;
  budgetImpactPct: number | null;
  response: string | null;
  createdAt: string;
}

/* ─── Page ─────────────────────────────────────────── */

export default function SimulationsPage() {
  const [prompt, setPrompt] = React.useState("");
  const [promptB, setPromptB] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<SimulationResult | null>(null);
  const [compare, setCompare] = React.useState<CompareResult | null>(null);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [tab, setTab] = React.useState("simulate");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    apiClient
      .fetch<HistoryItem[]>("/api/v1/analytics/simulate/history")
      .then(setHistory)
      .catch(() => {});
  }, [result, compare]);

  async function handleSimulate() {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiClient.fetch<SimulationResult>("/api/v1/analytics/simulate", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleCompare() {
    if (!prompt.trim() || !promptB.trim()) return;
    setLoading(true);
    setError(null);
    setCompare(null);
    try {
      const res = await apiClient.fetch<CompareResult>("/api/v1/analytics/simulate/compare", {
        method: "POST",
        body: JSON.stringify({ promptA: prompt, promptB: promptB }),
      });
      setCompare(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setLoading(false);
    }
  }

  function fmt(n: number | null | undefined) {
    if (n == null) return "—";
    return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString()}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Compensation Simulations
        </h1>
        <p className="text-muted-foreground mt-1">
          Run &ldquo;what-if&rdquo; scenarios to understand the impact of compensation changes before committing.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="simulate">Simulate</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ── Simulate Tab ─────────────────────────────── */}
        <TabsContent value="simulate" className="space-y-4">
          <PromptBar
            value={prompt}
            onChange={setPrompt}
            onSubmit={handleSimulate}
            loading={loading}
            placeholder='e.g. "Give 5% merit increase to all Engineering employees"'
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          {result && <ResultCards result={result} />}
          {result && (
            <Card>
              <CardHeader><CardTitle className="text-base">AI Analysis</CardTitle></CardHeader>
              <CardContent>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{result.response}</div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Compare Tab ──────────────────────────────── */}
        <TabsContent value="compare" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Scenario A</label>
              <PromptBar
                value={prompt}
                onChange={setPrompt}
                onSubmit={handleCompare}
                loading={loading}
                placeholder='e.g. "5% merit to Engineering"'
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Scenario B</label>
              <PromptBar
                value={promptB}
                onChange={setPromptB}
                onSubmit={handleCompare}
                loading={loading}
                placeholder='e.g. "3% merit + 10% bonus to top performers"'
              />
            </div>
          </div>
          <Button onClick={handleCompare} disabled={loading || !prompt.trim() || !promptB.trim()}>
            <GitCompare className="mr-2 h-4 w-4" />
            Compare Scenarios
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {compare && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scenario A</CardTitle>
                  <CardDescription className="truncate">{prompt}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">{compare.scenarioA.response}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Scenario B</CardTitle>
                  <CardDescription className="truncate">{promptB}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">{compare.scenarioB.response}</div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── History Tab ──────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          {history.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <History className="mx-auto h-10 w-10 mb-3 opacity-40" />
                <p>No simulations yet. Run your first scenario above.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <Card key={item.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => {
                  setPrompt(item.prompt);
                  if (item.response) {
                    setResult({ id: item.id, response: item.response, affectedCount: item.affectedCount, totalCostDelta: item.totalCostDelta, budgetImpactPct: item.budgetImpactPct });
                  }
                  setTab("simulate");
                }}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{item.name || item.prompt}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(item.createdAt).toLocaleString()}</p>
                      </div>
                      <Badge variant={item.status === "COMPLETED" ? "default" : item.status === "FAILED" ? "destructive" : "secondary"}>
                        {item.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────── */

function PromptBar({ value, onChange, onSubmit, loading, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
}) {
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  }
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          className="w-full rounded-lg border bg-background px-4 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          disabled={loading}
        />
      </div>
      <Button onClick={onSubmit} disabled={loading || !value.trim()} size="icon">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function ResultCards({ result }: { result: SimulationResult }) {
  function fmt(n: number | null | undefined) {
    if (n == null) return "—";
    return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString()}`;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Affected Employees</p>
              <p className="text-xl font-bold">{result.affectedCount ?? "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Cost Delta</p>
              <p className="text-xl font-bold">{fmt(result.totalCostDelta)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
              <TrendingUp className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Budget Impact</p>
              <p className="text-xl font-bold">{result.budgetImpactPct != null ? `${result.budgetImpactPct}%` : "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

