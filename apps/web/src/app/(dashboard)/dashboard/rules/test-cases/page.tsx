"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TestTubeDiagonal, Play, Wand2, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";

interface RuleSetSummary {
  id: string;
  name: string;
  status: string;
  version: number;
}

interface RuleSetsResponse {
  data: RuleSetSummary[];
  total: number;
}

interface TestCase {
  id: string;
  name: string;
  ruleSetId: string;
  ruleSetName?: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  actualOutput?: Record<string, unknown>;
  passed?: boolean;
}

interface TestRunResult {
  total: number;
  passed: number;
  failed: number;
  coverage: number;
  results: TestCase[];
}

interface TestCasesResponse {
  data: TestCase[];
  total: number;
}

export default function TestCasesPage() {
  const { toast } = useToast();
  const [selectedRuleSet, setSelectedRuleSet] = React.useState("");
  const [testResult, setTestResult] = React.useState<TestRunResult | null>(null);
  const [testsRunning, setTestsRunning] = React.useState(false);
  const [expandedTest, setExpandedTest] = React.useState<string | null>(null);

  const { data: ruleSetsData, isLoading: loadingRuleSets } = useQuery<RuleSetsResponse>({
    queryKey: ["rule-sets"],
    queryFn: () => apiClient.fetch<RuleSetsResponse>("/api/v1/rules/rule-sets?page=1&limit=100"),
  });

  const { data: testCasesData, isLoading: loadingTests } = useQuery<TestCasesResponse>({
    queryKey: ["test-cases", selectedRuleSet],
    queryFn: () =>
      apiClient.fetch<TestCasesResponse>(
        selectedRuleSet
          ? `/api/v1/rules/rule-sets/${selectedRuleSet}/test-cases?page=1&limit=100`
          : "/api/v1/rules/rule-sets/all/test-cases?page=1&limit=100"
      ),
    enabled: true,
  });

  const ruleSets = ruleSetsData?.data ?? [];
  const testCases = testCasesData?.data ?? [];

  async function generateTests() {
    if (!selectedRuleSet) {
      toast({ title: "Select a rule set first", variant: "destructive" });
      return;
    }
    setTestsRunning(true);
    try {
      const result = await apiClient.fetch<TestRunResult>(
        `/api/v1/rules/rule-sets/${selectedRuleSet}/generate-tests`,
        { method: "POST" }
      );
      setTestResult(result);
      toast({ title: "Tests generated", description: `${result.total} test cases created.` });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setTestsRunning(false);
    }
  }

  async function runAllTests() {
    if (!selectedRuleSet) {
      toast({ title: "Select a rule set first", variant: "destructive" });
      return;
    }
    setTestsRunning(true);
    try {
      const result = await apiClient.fetch<TestRunResult>(
        `/api/v1/rules/rule-sets/${selectedRuleSet}/test-cases/run`,
        { method: "POST" }
      );
      setTestResult(result);
      toast({ title: "Tests complete", description: `${result.passed}/${result.total} passed.` });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setTestsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Test Cases</h1>
        <p className="text-muted-foreground">Create and manage test cases for compensation rules.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TestTubeDiagonal className="h-5 w-5" />
            Test Runner
          </CardTitle>
          <CardDescription>Select a rule set to generate or run test cases.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRuleSets ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Select
                  options={ruleSets.map((rs) => ({ value: rs.id, label: `${rs.name} (v${rs.version})` }))}
                  placeholder="Select a rule set..."
                  value={selectedRuleSet}
                  onChange={(e) => setSelectedRuleSet(e.target.value)}
                />
              </div>
              <Button variant="outline" onClick={generateTests} disabled={!selectedRuleSet || testsRunning}>
                <Wand2 className="mr-2 h-4 w-4" />
                Generate
              </Button>
              <Button onClick={runAllTests} disabled={!selectedRuleSet || testsRunning}>
                <Play className="mr-2 h-4 w-4" />
                {testsRunning ? "Running..." : "Run All"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Results Summary */}
      {testResult && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{testResult.total}</div>
              <p className="text-xs text-muted-foreground">Total Tests</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{testResult.passed}</div>
              <p className="text-xs text-muted-foreground">Passed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{testResult.failed}</div>
              <p className="text-xs text-muted-foreground">Failed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{testResult.coverage.toFixed(0)}%</div>
              <Progress value={testResult.coverage} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">Coverage</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Test Results Detail */}
      {testResult && testResult.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {testResult.results.map((tc) => (
                <div key={tc.id} className="border rounded-lg">
                  <button
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50"
                    onClick={() => setExpandedTest(expandedTest === tc.id ? null : tc.id)}
                  >
                    <div className="flex items-center gap-2">
                      {tc.passed === true ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : tc.passed === false ? (
                        <XCircle className="h-4 w-4 text-red-600" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />
                      )}
                      <span className="font-medium text-sm">{tc.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={tc.passed ? "default" : tc.passed === false ? "destructive" : "outline"}>
                        {tc.passed === true ? "PASS" : tc.passed === false ? "FAIL" : "PENDING"}
                      </Badge>
                      {expandedTest === tc.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>
                  {expandedTest === tc.id && (
                    <div className="border-t p-3 space-y-2 bg-muted/30">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Input</p>
                        <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto max-h-40">
                          {JSON.stringify(tc.input, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Expected</p>
                        <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto max-h-40">
                          {JSON.stringify(tc.expectedOutput, null, 2)}
                        </pre>
                      </div>
                      {tc.actualOutput && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Actual</p>
                          <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto max-h-40">
                            {JSON.stringify(tc.actualOutput, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing Test Cases Table (from API) */}
      {!testResult && testCases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Existing Test Cases</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTests ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Rule Set</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testCases.map((tc) => (
                    <TableRow key={tc.id}>
                      <TableCell className="font-medium">{tc.name}</TableCell>
                      <TableCell>{tc.ruleSetName || tc.ruleSetId}</TableCell>
                      <TableCell>
                        <Badge variant={tc.passed === true ? "default" : tc.passed === false ? "destructive" : "outline"}>
                          {tc.passed === true ? "PASS" : tc.passed === false ? "FAIL" : "NOT RUN"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!testResult && testCases.length === 0 && !loadingTests && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <TestTubeDiagonal className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No test cases yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Select a rule set and click &quot;Generate&quot; to auto-create test cases.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

