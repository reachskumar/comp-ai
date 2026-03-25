'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Sparkles, Loader2, CheckCircle2, ArrowRight, ArrowLeft, Info } from 'lucide-react';

interface RuleSetSummary {
  id: string;
  name: string;
  description?: string;
  status: string;
  version: number;
}

interface RuleSetsResponse {
  data: RuleSetSummary[];
  total: number;
}

interface GeneratedRule {
  name: string;
  ruleType: string;
  priority: number;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  metadata: Record<string, unknown>;
  enabled: boolean;
  aiNote: string;
}

interface GenerateResult {
  ruleSet: { id: string; name: string; description: string };
  generatedRules: GeneratedRule[];
}

interface AiRuleWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a source rule set */
  sourceRuleSetId?: string;
}

export function AiRuleWizard({ open, onOpenChange, sourceRuleSetId }: AiRuleWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<1 | 2 | 3>(1);

  // Form state
  const [selectedSource, setSelectedSource] = React.useState(sourceRuleSetId ?? '');
  const [newName, setNewName] = React.useState('');
  const [newDescription, setNewDescription] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [budgetFactor, setBudgetFactor] = React.useState('1.0');
  const [marketFactor, setMarketFactor] = React.useState('1.0');
  const [perfDiff, setPerfDiff] = React.useState(false);

  // Result
  const [result, setResult] = React.useState<GenerateResult | null>(null);

  React.useEffect(() => {
    if (sourceRuleSetId) setSelectedSource(sourceRuleSetId);
  }, [sourceRuleSetId]);

  const { data: ruleSetsData } = useQuery<RuleSetsResponse>({
    queryKey: ['rule-sets'],
    queryFn: () => apiClient.fetch<RuleSetsResponse>('/api/v1/rules/rule-sets?page=1&limit=100'),
    enabled: open,
  });

  const ruleSets = ruleSetsData?.data ?? [];

  const generateMutation = useMutation({
    mutationFn: () =>
      apiClient.fetch<GenerateResult>(`/api/v1/rules/rule-sets/${selectedSource}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          newName,
          newDescription: newDescription || undefined,
          effectiveDate: effectiveDate || undefined,
          budgetFactor: parseFloat(budgetFactor) || 1.0,
          marketFactor: parseFloat(marketFactor) || 1.0,
          increasePerformanceDiff: perfDiff,
        }),
      }),
    onSuccess: (data) => {
      setResult(data);
      setStep(3);
      queryClient.invalidateQueries({ queryKey: ['rule-sets'] });
      toast({
        title: 'Rules generated',
        description: `${data.generatedRules.length} rules created in "${data.ruleSet.name}".`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Generation failed', description: err.message, variant: 'destructive' });
    },
  });

  function reset() {
    setStep(1);
    setSelectedSource(sourceRuleSetId ?? '');
    setNewName('');
    setNewDescription('');
    setEffectiveDate('');
    setBudgetFactor('1.0');
    setMarketFactor('1.0');
    setPerfDiff(false);
    setResult(null);
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  }

  const canProceedStep1 = selectedSource && newName.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent onClose={() => handleClose(false)} className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Rule Generator
            <Badge variant="secondary" className="text-[10px]">
              Step {step}/3
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Select source & name */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30 p-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Select an existing rule set as a template. The AI will clone it and adjust
                  percentages, caps, and thresholds based on your parameters.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Source Rule Set</Label>
              <Select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                placeholder="Select a rule set..."
                options={ruleSets.map((rs) => ({
                  value: rs.id,
                  label: `${rs.name} (v${rs.version})`,
                }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-name">New Rule Set Name</Label>
              <Input
                id="ai-name"
                placeholder="e.g., FY2027 Merit Policy"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-desc">Description (optional)</Label>
              <Input
                id="ai-desc"
                placeholder="Describe the purpose"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-date">Effective Date (optional)</Label>
              <Input
                id="ai-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 2: Adjustment parameters */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Configure how the AI should adjust rules. A factor of 1.0 means no change, 1.05
                  means +5%, 0.95 means −5%.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="budget-factor">Budget Factor</Label>
                <Input
                  id="budget-factor"
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="2.0"
                  value={budgetFactor}
                  onChange={(e) => setBudgetFactor(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Scales merit/bonus percentages and caps
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="market-factor">Market Factor</Label>
                <Input
                  id="market-factor"
                  type="number"
                  step="0.01"
                  min="0.5"
                  max="2.0"
                  value={marketFactor}
                  onChange={(e) => setMarketFactor(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">Adjusts salary-based thresholds</p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={perfDiff}
                onChange={(e) => setPerfDiff(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Increase performance differentiation</span>
              <span className="text-[11px] text-muted-foreground">
                (+15% for high performers, −15% for low)
              </span>
            </label>
          </div>
        )}

        {/* Step 3: Results */}
        {step === 3 && result && (
          <div className="space-y-3 py-2 max-h-[400px] overflow-auto">
            <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/30 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-green-700 dark:text-green-300">
                    Rule set &ldquo;{result.ruleSet.name}&rdquo; created with{' '}
                    {result.generatedRules.length} rules
                  </p>
                  <p className="text-[11px] text-green-600 dark:text-green-400 mt-0.5">
                    You can review and fine-tune individual rules in the rule set editor.
                  </p>
                </div>
              </div>
            </div>

            {result.generatedRules.map((rule, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{rule.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {rule.ruleType}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{rule.aiNote}</p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancel
              </Button>
              <Button onClick={() => setStep(2)} disabled={!canProceedStep1}>
                Next
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate Rules
                  </>
                )}
              </Button>
            </>
          )}
          {step === 3 && <Button onClick={() => handleClose(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
