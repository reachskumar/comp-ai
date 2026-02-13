"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Plus, Trash2, Pencil, Play, Wand2, Upload,
  CheckCircle2, XCircle, Code, Eye, ChevronUp, ChevronDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────
interface RuleCondition {
  field: string;
  operator: string;
  value: unknown;
}

interface RuleAction {
  type: string;
  params: Record<string, unknown>;
}

interface Rule {
  id: string;
  name: string;
  description?: string;
  type: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  enabled: boolean;
}

interface RuleSetDetail {
  id: string;
  name: string;
  description?: string;
  status: string;
  version: number;
  effectiveDate: string | null;
  rules: Rule[];
  createdAt: string;
  updatedAt: string;
}

interface ExtractedRule {
  name: string;
  description: string;
  type: string;
  ruleType?: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  confidence: number;
  needsReview?: boolean;
  sourceText?: string;
}

type ConfidenceLevel = "high" | "medium" | "low";

function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function getConfidenceBadgeVariant(level: ConfidenceLevel) {
  switch (level) {
    case "high": return "default" as const;
    case "medium": return "secondary" as const;
    case "low": return "destructive" as const;
  }
}

interface ConvertResponse {
  rules: ExtractedRule[];
  summary: string;
  conversionId?: string;
  totalRules: number;
  needsReviewCount: number;
}

interface SimulationResult {
  id: string;
  summary: {
    totalEmployees: number;
    affectedEmployees: number;
    averageChange: number;
    minChange: number;
    maxChange: number;
  };
  departmentBreakdown: { department: string; avgChange: number; count: number }[];
  distribution: { range: string; count: number }[];
  details: {
    employeeId: string;
    employeeName: string;
    department: string;
    before: number;
    after: number;
    change: number;
    changePercent: number;
  }[];
}

interface TestCase {
  id: string;
  name: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  actualOutput?: Record<string, unknown>;
  passed?: boolean;
  ruleId?: string;
}

interface TestRunResult {
  total: number;
  passed: number;
  failed: number;
  coverage: number;
  results: TestCase[];
}

// ── Constants ──────────────────────────────────────────────────
const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "greater or equal" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "less or equal" },
  { value: "in", label: "in" },
  { value: "notIn", label: "not in" },
  { value: "between", label: "between" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "matches", label: "matches (regex)" },
];

const ACTION_TYPES = [
  { value: "setMerit", label: "Set Merit" },
  { value: "setBonus", label: "Set Bonus" },
  { value: "setLTI", label: "Set LTI" },
  { value: "applyMultiplier", label: "Apply Multiplier" },
  { value: "applyFloor", label: "Apply Floor" },
  { value: "applyCap", label: "Apply Cap" },
  { value: "flag", label: "Flag" },
  { value: "block", label: "Block" },
];

const RULE_TYPES = [
  { value: "MERIT", label: "Merit" },
  { value: "BONUS", label: "Bonus" },
  { value: "LTI", label: "LTI" },
  { value: "PRORATION", label: "Proration" },
  { value: "CAP", label: "Cap" },
  { value: "FLOOR", label: "Floor" },
  { value: "ELIGIBILITY", label: "Eligibility" },
  { value: "CUSTOM", label: "Custom" },
];

const FIELDS = [
  "department", "level", "title", "location", "baseSalary",
  "performanceRating", "hireDate", "employeeCode",
];

export default function RuleSetDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = React.useState("rules");
  const [ruleDialogOpen, setRuleDialogOpen] = React.useState(false);
  const [editingRule, setEditingRule] = React.useState<Rule | null>(null);
  const [jsonView, setJsonView] = React.useState(false);

  // Rule form state
  const [ruleName, setRuleName] = React.useState("");
  const [ruleDescription, setRuleDescription] = React.useState("");
  const [ruleType, setRuleType] = React.useState("MERIT");
  const [conditions, setConditions] = React.useState<RuleCondition[]>([
    { field: "department", operator: "eq", value: "" },
  ]);
  const [actions, setActions] = React.useState<RuleAction[]>([
    { type: "setMerit", params: { percentage: 0 } },
  ]);
  const [rulePriority, setRulePriority] = React.useState(10);

  // Policy converter state
  const [policyText, setPolicyText] = React.useState("");
  const [extractedRules, setExtractedRules] = React.useState<ExtractedRule[]>([]);
  const [convertSummary, setConvertSummary] = React.useState("");

  // Simulation state
  const [simResult, setSimResult] = React.useState<SimulationResult | null>(null);
  const [simRunning, setSimRunning] = React.useState(false);

  // Test cases state
  const [testResult, setTestResult] = React.useState<TestRunResult | null>(null);
  const [testsRunning, setTestsRunning] = React.useState(false);
  const [expandedTest, setExpandedTest] = React.useState<string | null>(null);

  // ── Queries ──
  const { data: ruleSet, isLoading } = useQuery<RuleSetDetail>({
    queryKey: ["rule-set", id],
    queryFn: () => apiClient.fetch<RuleSetDetail>(`/api/v1/rules/rule-sets/${id}`),
  });

  // ── Mutations ──
  const createRuleMutation = useMutation({
    mutationFn: (body: Omit<Rule, "id">) =>
      apiClient.fetch(`/api/v1/rules/rule-sets/${id}/rules`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-set", id] });
      toast({ title: "Rule created" });
      closeRuleDialog();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateRuleMutation = useMutation({
    mutationFn: ({ ruleId, body }: { ruleId: string; body: Partial<Rule> }) =>
      apiClient.fetch(`/api/v1/rules/rule-sets/${id}/rules/${ruleId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-set", id] });
      toast({ title: "Rule updated" });
      closeRuleDialog();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) =>
      apiClient.fetch(`/api/v1/rules/rule-sets/${id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rule-set", id] });
      toast({ title: "Rule deleted" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: (body: { text: string }) =>
      apiClient.fetch<ConvertResponse>("/api/v1/rules/convert-policy", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setExtractedRules(data.rules);
      setConvertSummary(data.summary);
      toast({ title: "Policy converted", description: `${data.rules.length} rules extracted. ${data.needsReviewCount} need review.` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Helpers ──
  function openCreateRule() {
    setEditingRule(null);
    setRuleName("");
    setRuleDescription("");
    setRuleType("MERIT");
    setConditions([{ field: "department", operator: "eq", value: "" }]);
    setActions([{ type: "setMerit", params: { percentage: 0 } }]);
    setRulePriority(10);
    setRuleDialogOpen(true);
  }

  function openEditRule(rule: Rule) {
    setEditingRule(rule);
    setRuleName(rule.name);
    setRuleDescription(rule.description || "");
    setRuleType(rule.type);
    setConditions(rule.conditions.length > 0 ? rule.conditions : [{ field: "department", operator: "eq", value: "" }]);
    setActions(rule.actions.length > 0 ? rule.actions : [{ type: "setMerit", params: { percentage: 0 } }]);
    setRulePriority(rule.priority);
    setRuleDialogOpen(true);
  }

  function closeRuleDialog() {
    setRuleDialogOpen(false);
    setEditingRule(null);
  }

  function handleSaveRule() {
    const body = {
      name: ruleName,
      description: ruleDescription || undefined,
      type: ruleType,
      conditions,
      actions,
      priority: rulePriority,
      enabled: true,
    };
    if (editingRule) {
      updateRuleMutation.mutate({ ruleId: editingRule.id, body });
    } else {
      createRuleMutation.mutate(body as Omit<Rule, "id">);
    }
  }

  function addCondition() {
    setConditions([...conditions, { field: "department", operator: "eq", value: "" }]);
  }

  function removeCondition(idx: number) {
    setConditions(conditions.filter((_, i) => i !== idx));
  }

  function updateCondition(idx: number, patch: Partial<RuleCondition>) {
    setConditions(conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function addAction() {
    setActions([...actions, { type: "setMerit", params: { percentage: 0 } }]);
  }

  function removeAction(idx: number) {
    setActions(actions.filter((_, i) => i !== idx));
  }

  function updateAction(idx: number, patch: Partial<RuleAction>) {
    setActions(actions.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  async function runSimulation() {
    setSimRunning(true);
    try {
      const result = await apiClient.fetch<SimulationResult>(
        `/api/v1/rules/rule-sets/${id}/simulate`,
        { method: "POST", body: JSON.stringify({}) }
      );
      setSimResult(result);
      toast({ title: "Simulation complete" });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSimRunning(false);
    }
  }

  async function generateTests() {
    setTestsRunning(true);
    try {
      const result = await apiClient.fetch<TestRunResult>(
        `/api/v1/rules/rule-sets/${id}/generate-tests`,
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
    setTestsRunning(true);
    try {
      const result = await apiClient.fetch<TestRunResult>(
        `/api/v1/rules/rule-sets/${id}/test-cases/run`,
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

  async function acceptExtractedRule(rule: ExtractedRule) {
    try {
      await apiClient.fetch(`/api/v1/rules/rule-sets/${id}/rules`, {
        method: "POST",
        body: JSON.stringify({
          name: rule.name,
          description: rule.description,
          type: rule.type,
          conditions: rule.conditions,
          actions: rule.actions,
          priority: 10,
          enabled: true,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["rule-set", id] });
      setExtractedRules(extractedRules.filter((r) => r !== rule));
      toast({ title: "Rule accepted and added" });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!ruleSet) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Rule set not found.</p>
        <Button variant="outline" onClick={() => router.push("/dashboard/rules/rule-sets")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Rule Sets
        </Button>
      </div>
    );
  }

  const sortedRules = [...(ruleSet.rules || [])].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/rules/rule-sets")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{ruleSet.name}</h1>
            <Badge>{ruleSet.status}</Badge>
            <Badge variant="outline">v{ruleSet.version}</Badge>
          </div>
          {ruleSet.description && (
            <p className="text-muted-foreground mt-1">{ruleSet.description}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="rules">Rules ({sortedRules.length})</TabsTrigger>
          <TabsTrigger value="converter">Policy Converter</TabsTrigger>
          <TabsTrigger value="simulator">Simulator</TabsTrigger>
          <TabsTrigger value="tests">Test Cases</TabsTrigger>
        </TabsList>

        {/* ── Rules Tab ── */}
        <TabsContent value="rules">
          <RulesTab
            rules={sortedRules}
            jsonView={jsonView}
            setJsonView={setJsonView}
            onAdd={openCreateRule}
            onEdit={openEditRule}
            onDelete={(ruleId) => deleteRuleMutation.mutate(ruleId)}
          />
        </TabsContent>

        {/* ── Policy Converter Tab ── */}
        <TabsContent value="converter">
          <PolicyConverterTab
            policyText={policyText}
            setPolicyText={setPolicyText}
            extractedRules={extractedRules}
            setExtractedRules={setExtractedRules}
            convertSummary={convertSummary}
            isConverting={convertMutation.isPending}
            onConvert={() => convertMutation.mutate({ text: policyText })}
            onAccept={acceptExtractedRule}
          />
        </TabsContent>

        {/* ── Simulator Tab ── */}
        <TabsContent value="simulator">
          <SimulatorTab
            simResult={simResult}
            simRunning={simRunning}
            onRun={runSimulation}
          />
        </TabsContent>

        {/* ── Test Cases Tab ── */}
        <TabsContent value="tests">
          <TestCasesTab
            testResult={testResult}
            testsRunning={testsRunning}
            expandedTest={expandedTest}
            setExpandedTest={setExpandedTest}
            onGenerate={generateTests}
            onRunAll={runAllTests}
          />
        </TabsContent>
      </Tabs>

      {/* ── Rule Editor Dialog ── */}
      <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
        <DialogContent onClose={closeRuleDialog} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Rule" : "Add Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Rule name" />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  options={RULE_TYPES}
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={ruleDescription} onChange={(e) => setRuleDescription(e.target.value)} placeholder="Optional description" />
            </div>
            <div className="space-y-2">
              <Label>Priority (lower = higher priority)</Label>
              <Input type="number" value={rulePriority} onChange={(e) => setRulePriority(Number(e.target.value))} />
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Conditions</Label>
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    options={FIELDS.map((f) => ({ value: f, label: f }))}
                    value={cond.field}
                    onChange={(e) => updateCondition(idx, { field: e.target.value })}
                    className="w-36"
                  />
                  <Select
                    options={OPERATORS}
                    value={cond.operator}
                    onChange={(e) => updateCondition(idx, { operator: e.target.value })}
                    className="w-36"
                  />
                  <Input
                    value={String(cond.value ?? "")}
                    onChange={(e) => updateCondition(idx, { value: e.target.value })}
                    placeholder="Value"
                    className="flex-1"
                  />
                  {conditions.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeCondition(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Actions</Label>
                <Button variant="outline" size="sm" onClick={addAction}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {actions.map((action, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select
                    options={ACTION_TYPES}
                    value={action.type}
                    onChange={(e) => updateAction(idx, { type: e.target.value })}
                    className="w-40"
                  />
                  <Input
                    value={JSON.stringify(action.params)}
                    onChange={(e) => {
                      try {
                        updateAction(idx, { params: JSON.parse(e.target.value) });
                      } catch { /* ignore parse errors while typing */ }
                    }}
                    placeholder='{"percentage": 5}'
                    className="flex-1"
                  />
                  {actions.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeAction(idx)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRuleDialog}>Cancel</Button>
            <Button onClick={handleSaveRule} disabled={!ruleName.trim()}>
              {editingRule ? "Update" : "Create"} Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Rules Tab Component ──
function RulesTab({
  rules,
  jsonView,
  setJsonView,
  onAdd,
  onEdit,
  onDelete,
}: {
  rules: Rule[];
  jsonView: boolean;
  setJsonView: (v: boolean) => void;
  onAdd: () => void;
  onEdit: (rule: Rule) => void;
  onDelete: (ruleId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Rules</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setJsonView(!jsonView)}>
              {jsonView ? <Eye className="mr-1 h-4 w-4" /> : <Code className="mr-1 h-4 w-4" />}
              {jsonView ? "Visual" : "JSON"}
            </Button>
            <Button size="sm" onClick={onAdd}>
              <Plus className="mr-1 h-4 w-4" /> Add Rule
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No rules yet. Add rules manually or use the Policy Converter.</p>
          </div>
        ) : jsonView ? (
          <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-[600px]">
            {JSON.stringify(rules, null, 2)}
          </pre>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Priority</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Actions</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-center">{rule.priority}</TableCell>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell><Badge variant="outline">{rule.type}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {rule.conditions.map((c) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`).join(", ")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {rule.actions.map((a) => `${a.type}(${JSON.stringify(a.params)})`).join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.enabled ? "default" : "secondary"}>
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => onEdit(rule)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(rule.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}


// ── Policy Converter Tab ──
function PolicyConverterTab({
  policyText,
  setPolicyText,
  extractedRules,
  setExtractedRules,
  convertSummary,
  isConverting,
  onConvert,
  onAccept,
}: {
  policyText: string;
  setPolicyText: (v: string) => void;
  extractedRules: ExtractedRule[];
  setExtractedRules: (rules: ExtractedRule[]) => void;
  convertSummary: string;
  isConverting: boolean;
  onConvert: () => void;
  onAccept: (rule: ExtractedRule) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const [editForm, setEditForm] = React.useState<{ name: string; description: string } | null>(null);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPolicyText(ev.target?.result as string);
    };
    reader.readAsText(file);
  }

  function startEdit(idx: number) {
    const rule = extractedRules[idx];
    if (!rule) return;
    setEditingIdx(idx);
    setEditForm({ name: rule.name, description: rule.description });
  }

  function saveEdit() {
    if (editingIdx === null || !editForm) return;
    const updated = [...extractedRules];
    const existing = updated[editingIdx];
    if (!existing) return;
    updated[editingIdx] = { ...existing, name: editForm.name, description: editForm.description };
    setExtractedRules(updated);
    setEditingIdx(null);
    setEditForm(null);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditForm(null);
  }

  const hasResults = extractedRules.length > 0 || convertSummary;

  return (
    <div className="space-y-4">
      {/* Side-by-side layout when results exist */}
      <div className={hasResults ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
        {/* Left: Policy Input */}
        <Card>
          <CardHeader>
            <CardTitle>Policy Text</CardTitle>
            <CardDescription>
              Paste your compensation policy document or upload a PDF/TXT file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              placeholder="Paste your compensation policy text here..."
              rows={hasResults ? 16 : 10}
            />
            <div className="flex items-center gap-2">
              <Button onClick={onConvert} disabled={!policyText.trim() || isConverting}>
                <Wand2 className="mr-2 h-4 w-4" />
                {isConverting ? "Converting..." : "Convert to Rules"}
              </Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Upload File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,application/pdf,text/plain"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right: Extracted Rules (shown only when results exist) */}
        {hasResults && (
          <div className="space-y-4">
            {convertSummary && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Conversion Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{convertSummary}</p>
                </CardContent>
              </Card>
            )}

            {extractedRules.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Extracted Rules ({extractedRules.length})
                  </CardTitle>
                  <CardDescription>
                    Review each rule. Edit before accepting, or reject to discard.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 max-h-[600px] overflow-y-auto">
                  {extractedRules.map((rule, idx) => {
                    const level = getConfidenceLevel(rule.confidence);
                    const isEditing = editingIdx === idx;

                    return (
                      <div
                        key={idx}
                        className={`border rounded-lg p-4 space-y-2 ${
                          level === "low" ? "border-destructive/30 bg-destructive/5" :
                          level === "medium" ? "border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-900/10" :
                          "border-green-500/30 bg-green-50/50 dark:bg-green-900/10"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isEditing ? (
                              <Input
                                value={editForm?.name ?? ""}
                                onChange={(e) => setEditForm({ ...editForm!, name: e.target.value })}
                                className="h-7 text-sm font-medium w-48"
                              />
                            ) : (
                              <span className="font-medium">{rule.name}</span>
                            )}
                            <Badge variant={getConfidenceBadgeVariant(level)}>
                              {level} ({Math.round(rule.confidence * 100)}%)
                            </Badge>
                            <Badge variant="outline">{rule.ruleType || rule.type}</Badge>
                            {rule.needsReview && (
                              <Badge variant="secondary">Needs Review</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {isEditing ? (
                              <>
                                <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                                <Button size="sm" onClick={saveEdit}>Save</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => startEdit(idx)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button size="sm" onClick={() => onAccept(rule)}>
                                  <CheckCircle2 className="mr-1 h-4 w-4" /> Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setExtractedRules(extractedRules.filter((_, i) => i !== idx))}
                                >
                                  <XCircle className="mr-1 h-4 w-4" /> Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          <Textarea
                            value={editForm?.description ?? ""}
                            onChange={(e) => setEditForm({ ...editForm!, description: e.target.value })}
                            rows={2}
                            className="text-sm"
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">{rule.description}</p>
                        )}

                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">Conditions:</span>{" "}
                          {rule.conditions.length > 0
                            ? rule.conditions.map((c) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`).join("; ")
                            : "None"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">Actions:</span>{" "}
                          {rule.actions.length > 0
                            ? rule.actions.map((a) => `${a.type}(${JSON.stringify(a.params)})`).join("; ")
                            : "None"}
                        </div>

                        {rule.sourceText && (
                          <details className="text-xs">
                            <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                              Source text
                            </summary>
                            <p className="mt-1 p-2 bg-muted/50 rounded text-muted-foreground italic">
                              {rule.sourceText}
                            </p>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Simulator Tab ──
function SimulatorTab({
  simResult,
  simRunning,
  onRun,
}: {
  simResult: SimulationResult | null;
  simRunning: boolean;
  onRun: () => void;
}) {
  // Dynamic import for recharts to avoid SSR issues
  const [RechartsComponents, setRechartsComponents] = React.useState<{
    BarChart: React.ComponentType<Record<string, unknown>>;
    Bar: React.ComponentType<Record<string, unknown>>;
    XAxis: React.ComponentType<Record<string, unknown>>;
    YAxis: React.ComponentType<Record<string, unknown>>;
    CartesianGrid: React.ComponentType<Record<string, unknown>>;
    Tooltip: React.ComponentType<Record<string, unknown>>;
    ResponsiveContainer: React.ComponentType<Record<string, unknown>>;
  } | null>(null);

  React.useEffect(() => {
    import("recharts").then((mod) => {
      setRechartsComponents({
        BarChart: mod.BarChart as unknown as React.ComponentType<Record<string, unknown>>,
        Bar: mod.Bar as unknown as React.ComponentType<Record<string, unknown>>,
        XAxis: mod.XAxis as unknown as React.ComponentType<Record<string, unknown>>,
        YAxis: mod.YAxis as unknown as React.ComponentType<Record<string, unknown>>,
        CartesianGrid: mod.CartesianGrid as unknown as React.ComponentType<Record<string, unknown>>,
        Tooltip: mod.Tooltip as unknown as React.ComponentType<Record<string, unknown>>,
        ResponsiveContainer: mod.ResponsiveContainer as unknown as React.ComponentType<Record<string, unknown>>,
      });
    });
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Run Simulation</CardTitle>
              <CardDescription>Simulate the impact of this rule set on your employee population.</CardDescription>
            </div>
            <Button onClick={onRun} disabled={simRunning}>
              <Play className="mr-2 h-4 w-4" />
              {simRunning ? "Running..." : "Run Simulation"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {simResult && (
        <>
          {/* Impact Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{simResult.summary.affectedEmployees}</div>
                <p className="text-xs text-muted-foreground">Employees Affected</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{simResult.summary.averageChange.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Average Change</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{simResult.summary.minChange.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Min Change</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{simResult.summary.maxChange.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground">Max Change</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          {RechartsComponents && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Impact by Department</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ width: "100%", height: 300 }}>
                    <RechartsComponents.ResponsiveContainer width="100%" height="100%">
                      <RechartsComponents.BarChart data={simResult.departmentBreakdown}>
                        <RechartsComponents.CartesianGrid strokeDasharray="3 3" />
                        <RechartsComponents.XAxis dataKey="department" />
                        <RechartsComponents.YAxis />
                        <RechartsComponents.Tooltip />
                        <RechartsComponents.Bar dataKey="avgChange" fill="hsl(var(--primary))" name="Avg Change %" />
                      </RechartsComponents.BarChart>
                    </RechartsComponents.ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Change Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ width: "100%", height: 300 }}>
                    <RechartsComponents.ResponsiveContainer width="100%" height="100%">
                      <RechartsComponents.BarChart data={simResult.distribution}>
                        <RechartsComponents.CartesianGrid strokeDasharray="3 3" />
                        <RechartsComponents.XAxis dataKey="range" />
                        <RechartsComponents.YAxis />
                        <RechartsComponents.Tooltip />
                        <RechartsComponents.Bar dataKey="count" fill="hsl(var(--secondary))" name="Employees" />
                      </RechartsComponents.BarChart>
                    </RechartsComponents.ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Before/After Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Before / After Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">After</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-right">Change %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simResult.details.slice(0, 50).map((d) => (
                    <TableRow key={d.employeeId}>
                      <TableCell className="font-medium">{d.employeeName}</TableCell>
                      <TableCell>{d.department}</TableCell>
                      <TableCell className="text-right">${d.before.toLocaleString()}</TableCell>
                      <TableCell className="text-right">${d.after.toLocaleString()}</TableCell>
                      <TableCell className="text-right">${d.change.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className={d.changePercent >= 0 ? "text-green-600" : "text-red-600"}>
                          {d.changePercent >= 0 ? "+" : ""}{d.changePercent.toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Test Cases Tab ──
function TestCasesTab({
  testResult,
  testsRunning,
  expandedTest,
  setExpandedTest,
  onGenerate,
  onRunAll,
}: {
  testResult: TestRunResult | null;
  testsRunning: boolean;
  expandedTest: string | null;
  setExpandedTest: (id: string | null) => void;
  onGenerate: () => void;
  onRunAll: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Test Cases</CardTitle>
              <CardDescription>Auto-generate test cases from rules or run existing tests.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onGenerate} disabled={testsRunning}>
                <Wand2 className="mr-2 h-4 w-4" />
                Auto-Generate
              </Button>
              <Button onClick={onRunAll} disabled={testsRunning || !testResult}>
                <Play className="mr-2 h-4 w-4" />
                {testsRunning ? "Running..." : "Run All"}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {testResult && (
        <>
          {/* Summary */}
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
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold">{testResult.coverage.toFixed(0)}%</div>
                </div>
                <Progress value={testResult.coverage} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">Coverage</p>
              </CardContent>
            </Card>
          </div>

          {/* Test List */}
          <Card>
            <CardContent className="pt-6">
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
                      {expandedTest === tc.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    {expandedTest === tc.id && (
                      <div className="border-t p-3 space-y-2 bg-muted/30">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Input</p>
                          <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto">
                            {JSON.stringify(tc.input, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Expected Output</p>
                          <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto">
                            {JSON.stringify(tc.expectedOutput, null, 2)}
                          </pre>
                        </div>
                        {tc.actualOutput && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Actual Output</p>
                            <pre className="text-xs bg-background p-2 rounded mt-1 overflow-auto">
                              {JSON.stringify(tc.actualOutput, null, 2)}
                            </pre>
                          </div>
                        )}
                        <div>
                          <Badge variant={tc.passed ? "default" : tc.passed === false ? "destructive" : "outline"}>
                            {tc.passed === true ? "PASSED" : tc.passed === false ? "FAILED" : "NOT RUN"}
                          </Badge>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}