/**
 * Pay Equity — Outlier Explainer graph (Phase 1.5).
 *
 * For a single outlier employee within a statistically-significant cohort,
 * produce a one-paragraph "why is this person here" explanation plus a
 * concrete action recommendation. Cheap call (small input, short output);
 * intended to be invoked on-demand from the Diagnose tab's outlier list.
 *
 * Output is wrapped in a thin envelope with citations to the cohort row +
 * the employee row, so the recommendation is auditor-defensible.
 */

import { START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { buildResult, type Citation, type PayEquityAgentResult } from '../types/pay-equity.js';

const SYSTEM_PROMPT = `You are a Pay Equity Outlier Explainer for the Compport compensation platform. Given one underpaid employee inside a statistically-significant cohort, produce a one-paragraph plain-English explanation and a concrete next action.

## Output

Return ONLY a JSON object with these keys:
- \`paragraph\`: 2-4 sentences. Plain English. Cite the actual numbers. No first-person, no "As an AI", no LLM filler.
- \`recommendedAction\`: ONE concrete action ("Adjust salary by X%", "Investigate level placement", "Review with HRBP", "Add to remediation list").
- \`severity\`: "low" | "medium" | "high" — your assessment of how urgent this case is.

## Rules

1. NEVER fabricate numbers. Every percent, dollar figure, or count you cite MUST appear in the input.
2. Tie the explanation to the cohort context — this person isn't just below market, they're below market in a cohort with a measured statistical gap.
3. Be specific about the action. "Adjust salary" alone is too vague; "Adjust to $X (compa-ratio 0.95)" is concrete.
4. Severity rule of thumb:
   - high: compa-ratio < 0.85 in a significant cohort
   - medium: 0.85 ≤ CR < 0.95 in a significant cohort
   - low: CR ≥ 0.95 (probably not really an outlier)

Return ONLY the JSON. No markdown, no preamble, no trailing notes.`;

// ─── Public types ───────────────────────────────────────────────────────────

export interface OutlierExplainInput {
  tenantId: string;
  userId: string;
  employee: {
    id: string;
    employeeCode: string;
    name: string;
    level: string;
    department: string;
    location: string | null;
    hireDate: string;
    baseSalary: number;
    currency: string;
    compaRatio: number;
    performanceRating: number | null;
  };
  cohort: {
    dimension: string;
    group: string;
    referenceGroup: string;
    gapPercent: number;
    pValue: number;
    sampleSize: number;
  };
  /** Mean comp + compa-ratio in the same level + department for context. */
  peerContext: {
    peerCount: number;
    peerMeanSalary: number;
    peerMeanCompaRatio: number | null;
  };
  methodology: {
    name: string;
    version: string;
    controls: string[];
    sampleSize: number;
  };
}

export interface OutlierExplainOutput {
  employeeId: string;
  paragraph: string;
  recommendedAction: string;
  severity: 'low' | 'medium' | 'high';
}

interface RawLLM {
  paragraph: string;
  recommendedAction: string;
  severity: string;
}

// ─── Graph ──────────────────────────────────────────────────────────────────

export async function buildOutlierExplainerGraph(options: CreateGraphOptions = {}) {
  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'pay-equity'),
    ...options.modelConfig,
  };
  const model = await createChatModel(aiConfig, modelConfig);

  async function explain(state: BaseAgentStateType): Promise<{ messages: BaseMessage[] }> {
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    return { messages: [response] };
  }

  return createAgentGraph(
    {
      name: 'pay-equity-outlier-explainer-graph',
      graphType: 'pay-equity',
      stateSchema: BaseAgentState,
      nodes: { explain },
      edges: [
        [START, 'explain'],
        ['explain', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

export async function invokeOutlierExplainerGraph(
  input: OutlierExplainInput,
  options: CreateGraphOptions = {},
): Promise<PayEquityAgentResult<OutlierExplainOutput>> {
  const { loadAIConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const { graph } = await buildOutlierExplainerGraph({ ...options, config: aiConfig });

  const userPrompt = `Explain why this employee is an outlier and recommend an action. Return ONLY JSON.

## Employee
- id: ${input.employee.id}
- code: ${input.employee.employeeCode}
- name: ${input.employee.name}
- level: ${input.employee.level}
- department: ${input.employee.department}
- location: ${input.employee.location ?? 'n/a'}
- hire date: ${input.employee.hireDate}
- base salary: ${formatMoney(input.employee.baseSalary, input.employee.currency)}
- compa-ratio: ${input.employee.compaRatio.toFixed(2)}
- performance rating: ${input.employee.performanceRating !== null ? input.employee.performanceRating.toFixed(1) : 'n/a'}

## Cohort context (${input.cohort.dimension}/${input.cohort.group} vs ${input.cohort.referenceGroup})
- adjusted gap: ${input.cohort.gapPercent}%
- p-value: ${input.cohort.pValue}
- cohort sample size: ${input.cohort.sampleSize}

## Peer context (same level + department, any group)
- peers: ${input.peerContext.peerCount}
- peer mean salary: ${formatMoney(input.peerContext.peerMeanSalary, input.employee.currency)}
- peer mean compa-ratio: ${input.peerContext.peerMeanCompaRatio !== null ? input.peerContext.peerMeanCompaRatio.toFixed(2) : 'n/a'}

## Methodology
${input.methodology.name}@${input.methodology.version} controlling for ${input.methodology.controls.join(', ')} on n=${input.methodology.sampleSize}.

Return the JSON now.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(userPrompt)],
    metadata: { analysisType: 'pay-equity-outlier-explainer' },
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const raw =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const parsed = parseLLMOutput(raw);

  const citations: Citation[] = [
    {
      type: 'employee_row',
      ref: input.employee.id,
      excerpt: `${input.employee.employeeCode} CR=${input.employee.compaRatio.toFixed(2)}`,
    },
    {
      type: 'regression_coefficient',
      ref: `${input.cohort.dimension}.${input.cohort.group}.vs.${input.cohort.referenceGroup}`,
      excerpt: `gap=${input.cohort.gapPercent}%, p=${input.cohort.pValue}, n=${input.cohort.sampleSize}`,
    },
    {
      type: 'cohort_query',
      ref: `peers:level=${input.employee.level};dept=${input.employee.department}`,
      excerpt: `n=${input.peerContext.peerCount}, mean CR=${input.peerContext.peerMeanCompaRatio?.toFixed(2) ?? 'n/a'}`,
    },
  ];

  // The LLM picks severity but we sanity-check it against the rule of thumb.
  const cr = input.employee.compaRatio;
  const expectedSeverity: 'low' | 'medium' | 'high' =
    cr < 0.85 ? 'high' : cr < 0.95 ? 'medium' : 'low';
  const severity =
    parsed.severity === 'low' || parsed.severity === 'medium' || parsed.severity === 'high'
      ? parsed.severity
      : expectedSeverity;

  const confidence: 'high' | 'medium' | 'low' =
    input.cohort.sampleSize >= 100 && parsed.paragraph.length > 50 ? 'high' : 'medium';

  const output: OutlierExplainOutput = {
    employeeId: input.employee.id,
    paragraph: parsed.paragraph,
    recommendedAction: parsed.recommendedAction,
    severity,
  };

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
      parsed.paragraph.length === 0
        ? [{ code: 'model_unavailable', message: 'LLM returned empty paragraph' }]
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
    return {
      paragraph: '',
      recommendedAction: 'Re-run analysis (LLM output could not be parsed).',
      severity: 'medium',
    };
  }
  return {
    paragraph: typeof parsed.paragraph === 'string' ? parsed.paragraph : '',
    recommendedAction: typeof parsed.recommendedAction === 'string' ? parsed.recommendedAction : '',
    severity: typeof parsed.severity === 'string' ? parsed.severity : 'medium',
  };
}

function formatMoney(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}
