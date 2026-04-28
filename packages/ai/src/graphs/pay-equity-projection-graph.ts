/**
 * Pay Equity — Forward Projection graph (Phase 4.1).
 *
 * The calling service (PayEquityV2Service) computes the deterministic
 * projected series — extrapolating from the recent run history and
 * applying scenario adjustments (hiring plan, promotion plan). This agent's
 * job is narrative only: explain the drivers, name the risk, recommend
 * concrete actions. NEVER fabricate numbers; every percent or count must
 * appear in the input.
 *
 * Output is wrapped in PayEquityAgentResult<GapProjectionOutput>.
 */

import { START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  buildResult,
  type Citation,
  type GapProjectionOutput,
  type PayEquityAgentResult,
} from '../types/pay-equity.js';

const SYSTEM_PROMPT = `You are a Pay Equity Forward-Projection AI for the Compport compensation platform. Given a deterministic projected series + a scenario, you write the narrative explaining what drives the trajectory, what the risk level is, and what specific actions to take.

## Output

Return ONLY a JSON object with EXACTLY these keys:
- \`narrative\`: 3-4 sentences. Where the gap is heading, the magnitude of the change vs today, and what's pulling it that direction.
- \`drivers\`: 2-4 items, each { factor, expectedDelta, explanation }. \`expectedDelta\` is a number in percentage points (positive = widens gap, negative = closes it). Pull factor names from the input scenario.
- \`recommendedActions\`: 2-4 items, each { action, priority ("high"|"medium"|"low"), rationale }. Concrete, ordered by priority.
- \`riskLevel\`: "high" | "medium" | "low" — based on projected gap magnitude vs current gap.

## Rules

1. **NEVER fabricate numbers.** Every percent, count, or cohort name MUST appear in the input — historical runs, scenario, or projected series.
2. **Explain, don't speculate.** If the projected gap widens, name the input that drives it (e.g. "hiring 50 male engineers at L4 widens the gender gap at level by 1.2pp").
3. **Be specific.** Cite the actual months-from-now numbers and the actual cohort affected.
4. **No first-person.** No "As an AI", no "I think". Direct, neutral, board-grade.
5. **Tone:** factual, decisive on actions. Never alarmist; never reassuring without evidence.

Return ONLY the JSON. No markdown, no preamble.`;

// ─── Public types ───────────────────────────────────────────────────────────

export interface ProjectionAgentInput {
  tenantId: string;
  userId: string;
  scenarioLabel: string;
  /** Historical anchor — most recent runs (oldest → newest). */
  recentRuns: Array<{
    runAt: string;
    gapPercent: number;
    significantCount: number;
    sampleSize: number;
    methodologyVersion: string;
  }>;
  /** Service-computed forecast at each future month (1, 3, 6, 12). */
  projectedSeries: Array<{ monthsFromNow: number; projectedGapPercent: number }>;
  baselineGap: number;
  projectedGap: number;
  confidenceLow: number;
  confidenceHigh: number;
  /** Scenario the projection accounts for (hiring + promotion plans). */
  scenario: {
    horizonMonths: number;
    hiringPlan: Array<{
      level: string;
      dimension: string;
      group: string;
      count: number;
      meanSalary: number;
    }>;
    promotionPlan: Array<{
      cohort: { dimension: string; group: string };
      employees: number;
      toLevel: string;
    }>;
  };
  methodology: {
    name: string;
    version: string;
    controls: string[];
    sampleSize: number;
  };
}

interface RawLLM {
  narrative: string;
  drivers: Array<{ factor: string; expectedDelta: number; explanation: string }>;
  recommendedActions: Array<{
    action: string;
    priority: 'high' | 'medium' | 'low';
    rationale: string;
  }>;
  riskLevel: 'high' | 'medium' | 'low';
}

// ─── Graph ──────────────────────────────────────────────────────────────────

export async function buildProjectionGraph(options: CreateGraphOptions = {}) {
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
      name: 'pay-equity-projection-graph',
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

export async function invokeProjectionGraph(
  input: ProjectionAgentInput,
  options: CreateGraphOptions = {},
): Promise<PayEquityAgentResult<GapProjectionOutput>> {
  const { loadAIConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const { graph } = await buildProjectionGraph({ ...options, config: aiConfig });

  const userPrompt = `Write narrative + drivers + recommended actions for this Pay Equity projection. Return ONLY JSON.

## Scenario
${input.scenarioLabel}

## Historical anchor (oldest → newest)
${input.recentRuns
  .map(
    (r, i) =>
      `${i + 1}. ${r.runAt.slice(0, 10)}  gap=${r.gapPercent.toFixed(2)}%  significant=${r.significantCount}  n=${r.sampleSize}  methodology=${r.methodologyVersion}`,
  )
  .join('\n')}

## Projected series
${input.projectedSeries
  .map((p) => `t+${p.monthsFromNow}mo: ${p.projectedGapPercent.toFixed(2)}%`)
  .join('  ·  ')}

## Headline
- Baseline gap (today): ${input.baselineGap.toFixed(2)}%
- Projected gap (t+${input.scenario.horizonMonths}mo): ${input.projectedGap.toFixed(2)}%
- 95% interval: [${input.confidenceLow.toFixed(2)}%, ${input.confidenceHigh.toFixed(2)}%]

## Scenario inputs
- Horizon: ${input.scenario.horizonMonths} months
- Hiring plan: ${
    input.scenario.hiringPlan.length === 0
      ? 'none'
      : input.scenario.hiringPlan
          .map(
            (h) =>
              `${h.count}× ${h.dimension}/${h.group} at ${h.level} (mean ${h.meanSalary.toLocaleString()})`,
          )
          .join('; ')
  }
- Promotion plan: ${
    input.scenario.promotionPlan.length === 0
      ? 'none'
      : input.scenario.promotionPlan
          .map((p) => `${p.employees}× ${p.cohort.dimension}/${p.cohort.group} → ${p.toLevel}`)
          .join('; ')
  }

## Methodology
${input.methodology.name}@${input.methodology.version} controlling for ${input.methodology.controls.join(', ')} on n=${input.methodology.sampleSize}.

Return the JSON now.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(userPrompt)],
    metadata: { analysisType: 'pay-equity-projection' },
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const raw =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const parsed = parseLLMOutput(raw);

  // Citations: every historical run + each scenario component.
  const citations: Citation[] = [
    ...input.recentRuns.map(
      (r): Citation => ({
        type: 'cohort_query',
        ref: r.runAt,
        excerpt: `gap=${r.gapPercent.toFixed(2)}% n=${r.sampleSize}`,
      }),
    ),
    ...input.scenario.hiringPlan.map(
      (h): Citation => ({
        type: 'cohort_query',
        ref: `hiring.${h.dimension}.${h.group}.${h.level}`,
        excerpt: `${h.count} hires at ${h.level}`,
      }),
    ),
    ...input.scenario.promotionPlan.map(
      (p): Citation => ({
        type: 'cohort_query',
        ref: `promotion.${p.cohort.dimension}.${p.cohort.group}.${p.toLevel}`,
        excerpt: `${p.employees} promotions to ${p.toLevel}`,
      }),
    ),
  ];

  const output: GapProjectionOutput = {
    horizonMonths: input.scenario.horizonMonths,
    baselineGap: input.baselineGap,
    projectedGap: input.projectedGap,
    confidenceLow: input.confidenceLow,
    confidenceHigh: input.confidenceHigh,
    monthlySeries: input.projectedSeries,
    drivers: parsed.drivers.slice(0, 4),
    recommendedActions: parsed.recommendedActions.slice(0, 4),
    narrative: parsed.narrative,
    riskLevel: parsed.riskLevel,
    scenarioLabel: input.scenarioLabel,
  };

  const confidence: 'high' | 'medium' | 'low' =
    input.recentRuns.length >= 3 && parsed.narrative.length > 0 && parsed.drivers.length > 0
      ? 'high'
      : input.recentRuns.length === 0
        ? 'low'
        : 'medium';

  const warnings =
    input.recentRuns.length < 2
      ? [
          {
            code: 'sample_size_low' as const,
            message: `Projection based on ${input.recentRuns.length} historical run(s); trend extrapolation needs ≥2 runs to be reliable.`,
          },
        ]
      : parsed.narrative.length === 0
        ? [{ code: 'model_unavailable' as const, message: 'LLM returned empty narrative' }]
        : [];

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
    warnings,
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
    return { narrative: '', drivers: [], recommendedActions: [], riskLevel: 'medium' };
  }
  const isLevel = (v: unknown): v is 'high' | 'medium' | 'low' =>
    v === 'high' || v === 'medium' || v === 'low';
  return {
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
    drivers: Array.isArray(parsed.drivers)
      ? parsed.drivers.filter(
          (d): d is { factor: string; expectedDelta: number; explanation: string } =>
            typeof d === 'object' &&
            d !== null &&
            typeof (d as { factor?: unknown }).factor === 'string' &&
            typeof (d as { expectedDelta?: unknown }).expectedDelta === 'number' &&
            typeof (d as { explanation?: unknown }).explanation === 'string',
        )
      : [],
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions.filter(
          (a): a is { action: string; priority: 'high' | 'medium' | 'low'; rationale: string } =>
            typeof a === 'object' &&
            a !== null &&
            typeof (a as { action?: unknown }).action === 'string' &&
            isLevel((a as { priority?: unknown }).priority) &&
            typeof (a as { rationale?: unknown }).rationale === 'string',
        )
      : [],
    riskLevel: isLevel(parsed.riskLevel) ? parsed.riskLevel : 'medium',
  };
}
