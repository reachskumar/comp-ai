/**
 * Pay Equity — Remediation Justification graph (Phase 2.3).
 *
 * The calling service (PayEquityV2Service) produces the deterministic list
 * of proposed adjustments — it knows each employee's current salary, the
 * cohort context, and the math (raise underpaid people in significant
 * cohorts toward the cohort mean within a budget).
 *
 * This agent's job is narrative only: write a one-line plain-English
 * justification per adjustment + a one-paragraph plan summary. NEVER
 * fabricate numbers; every percent/dollar figure must appear in the input.
 *
 * Output is wrapped in PayEquityAgentResult<RemediationOptimizationOutput>.
 */

import { START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  buildResult,
  type Citation,
  type PayEquityAgentResult,
  type RemediationOptimizationOutput,
} from '../types/pay-equity.js';

const SYSTEM_PROMPT = `You are a Pay Equity Remediation Narrative AI for the Compport compensation platform. Given a list of proposed per-employee adjustments and the cohort context they were drawn from, you write one-line justifications per adjustment plus a one-paragraph plan summary.

## Output

Return ONLY a JSON object with EXACTLY these keys:
- \`adjustmentJustifications\`: array of { employeeId, justification }
  - one line per input adjustment, in the same order, plain English, citing actual numbers
- \`planSummary\`: 2-3 sentences. Total adjustments, total cost, primary cohorts addressed, projected gap impact.
- \`alternativeScenarios\`: array of up to 3 { label, summary }
  - e.g. "Close to 1% gap (more aggressive)", "Phased over 4 quarters", "Department-by-department"
  - Brief 1-sentence summaries, no per-employee detail.

## Rules

1. **NEVER fabricate numbers.** Every percent, dollar figure, employee count, or cohort name MUST appear in the input.
2. **Order preserved.** The justifications array must be in the same order as the input adjustments — same length, same employee IDs.
3. **Be specific.** "Adjust to bring closer to cohort median" beats "fair adjustment". Cite the from→to + the cohort the employee belongs to.
4. **One line each.** Justifications are short (<= 25 words). Don't pad.
5. **Plan summary** must include: # of adjustments, total cost, # of cohorts addressed, gap-target the plan closes to.
6. **No first-person.** No "As an AI", no "I think", no "Hopefully this addresses". Direct, neutral, board-grade.
7. **Tone:** factual and constructive. Never alarmist.

Return ONLY the JSON. No markdown, no preamble.`;

// ─── Public types ───────────────────────────────────────────────────────────

export interface RemediationAgentInput {
  tenantId: string;
  userId: string;
  /** The deterministic adjustments computed by the calling service. */
  adjustments: Array<{
    employeeId: string;
    employeeCode: string;
    name: string;
    level: string;
    department: string;
    cohort: { dimension: string; group: string };
    currentSalary: number;
    proposedSalary: number;
    currency: string;
    currentCompaRatio: number | null;
    cohortMeanSalary: number;
  }>;
  /** Aggregate budget + target so the agent can describe the plan. */
  plan: {
    targetGapPercent: number;
    totalCost: number;
    affectedEmployees: number;
    cohortsAddressed: Array<{ dimension: string; group: string; gapPercent: number }>;
    currentWorstGap: number;
  };
  methodology: {
    name: string;
    version: string;
    controls: string[];
    sampleSize: number;
  };
}

interface RawLLM {
  adjustmentJustifications: Array<{ employeeId: string; justification: string }>;
  planSummary: string;
  alternativeScenarios: Array<{ label: string; summary: string }>;
}

// ─── Graph ──────────────────────────────────────────────────────────────────

export async function buildRemediationGraph(options: CreateGraphOptions = {}) {
  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'pay-equity'),
    ...options.modelConfig,
  };
  const model = await createChatModel(aiConfig, modelConfig);

  async function narrate(state: BaseAgentStateType): Promise<{ messages: BaseMessage[] }> {
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    return { messages: [response] };
  }

  return createAgentGraph(
    {
      name: 'pay-equity-remediation-graph',
      graphType: 'pay-equity',
      stateSchema: BaseAgentState,
      nodes: { narrate },
      edges: [
        [START, 'narrate'],
        ['narrate', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

export async function invokeRemediationGraph(
  input: RemediationAgentInput,
  options: CreateGraphOptions = {},
): Promise<PayEquityAgentResult<RemediationOptimizationOutput>> {
  const { loadAIConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const { graph } = await buildRemediationGraph({ ...options, config: aiConfig });

  const userPrompt = `Write justifications + plan summary for these proposed adjustments. Return ONLY JSON.

## Plan
- Target gap: ${input.plan.targetGapPercent}%
- Current worst-cohort gap: ${input.plan.currentWorstGap}%
- Total cost: ${formatMoney(input.plan.totalCost, input.adjustments[0]?.currency ?? 'USD')}
- Affected employees: ${input.plan.affectedEmployees}
- Cohorts addressed: ${input.plan.cohortsAddressed
    .map((c) => `${c.dimension}/${c.group} (${c.gapPercent}%)`)
    .join(', ')}

## Adjustments (preserve this order in adjustmentJustifications[])
${input.adjustments
  .map(
    (a, i) =>
      `${i + 1}. ${a.employeeId}  ${a.employeeCode}  ${a.name}  L=${a.level} D=${a.department}  cohort=${a.cohort.dimension}/${a.cohort.group}  from=${formatMoney(a.currentSalary, a.currency)}  to=${formatMoney(a.proposedSalary, a.currency)}  CR=${a.currentCompaRatio?.toFixed(2) ?? 'n/a'}  cohort-mean=${formatMoney(a.cohortMeanSalary, a.currency)}`,
  )
  .join('\n')}

## Methodology
${input.methodology.name}@${input.methodology.version} controlling for ${input.methodology.controls.join(', ')} on n=${input.methodology.sampleSize}.

Return the JSON now.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(userPrompt)],
    metadata: { analysisType: 'pay-equity-remediation' },
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const raw =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const parsed = parseLLMOutput(raw);

  // Match justifications back to adjustments by employeeId. If LLM lost the
  // order or skipped employees, fall back to a deterministic justification
  // so each adjustment has SOMETHING auditor-defensible.
  const justByEmp = new Map(
    parsed.adjustmentJustifications.map((j) => [j.employeeId, j.justification]),
  );

  const adjustmentsOut = input.adjustments.map((a) => ({
    employeeId: a.employeeId,
    fromValue: a.currentSalary,
    toValue: a.proposedSalary,
    justification:
      justByEmp.get(a.employeeId) ??
      `Adjustment to ${formatMoney(a.proposedSalary, a.currency)} (cohort ${a.cohort.dimension}/${a.cohort.group}, gap ${input.plan.currentWorstGap}%).`,
  }));

  // Citations: every cohort + each adjusted employee.
  const citations: Citation[] = [
    ...input.plan.cohortsAddressed.map(
      (c): Citation => ({
        type: 'regression_coefficient',
        ref: `${c.dimension}.${c.group}`,
        excerpt: `gap=${c.gapPercent}%`,
      }),
    ),
    ...input.adjustments.slice(0, 20).map(
      (a): Citation => ({
        type: 'employee_row',
        ref: a.employeeId,
        excerpt: `${a.employeeCode} ${formatMoney(a.currentSalary, a.currency)} → ${formatMoney(a.proposedSalary, a.currency)}`,
      }),
    ),
  ];

  const output: RemediationOptimizationOutput = {
    targetGap: input.plan.targetGapPercent,
    totalCost: input.plan.totalCost,
    affectedEmployees: input.plan.affectedEmployees,
    adjustments: adjustmentsOut,
    alternativeScenarios: parsed.alternativeScenarios.slice(0, 3).map((s) => ({
      label: s.label,
      targetGap: input.plan.targetGapPercent,
      cost: input.plan.totalCost,
      summary: s.summary,
    })),
  };

  const confidence: 'high' | 'medium' | 'low' =
    input.adjustments.length >= 5 &&
    input.plan.cohortsAddressed.length > 0 &&
    parsed.planSummary.length > 0
      ? 'high'
      : 'medium';

  return buildResult({
    output,
    citations,
    methodology: {
      name: input.methodology.name,
      version: input.methodology.version,
      controls: input.methodology.controls,
      dependentVariable: 'log_salary',
      sampleSize: input.methodology.sampleSize,
      confidenceInterval: 0.95,
    },
    confidence,
    warnings:
      parsed.planSummary.length === 0
        ? [{ code: 'model_unavailable', message: 'LLM returned empty plan summary' }]
        : [],
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseLLMOutput(raw: string): RawLLM {
  const cleaned = raw
    .replace(/```json?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  let parsed: Partial<RawLLM>;
  try {
    parsed = JSON.parse(cleaned) as Partial<RawLLM>;
  } catch {
    return { adjustmentJustifications: [], planSummary: '', alternativeScenarios: [] };
  }
  return {
    adjustmentJustifications: Array.isArray(parsed.adjustmentJustifications)
      ? parsed.adjustmentJustifications.filter(
          (j): j is { employeeId: string; justification: string } =>
            typeof j === 'object' &&
            j !== null &&
            typeof (j as { employeeId?: unknown }).employeeId === 'string' &&
            typeof (j as { justification?: unknown }).justification === 'string',
        )
      : [],
    planSummary: typeof parsed.planSummary === 'string' ? parsed.planSummary : '',
    alternativeScenarios: Array.isArray(parsed.alternativeScenarios)
      ? parsed.alternativeScenarios.filter(
          (s): s is { label: string; summary: string } =>
            typeof s === 'object' &&
            s !== null &&
            typeof (s as { label?: unknown }).label === 'string' &&
            typeof (s as { summary?: unknown }).summary === 'string',
        )
      : [],
  };
}

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}
