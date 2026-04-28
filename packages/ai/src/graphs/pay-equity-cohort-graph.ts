/**
 * Pay Equity — Cohort Root-Cause graph (Phase 1.5).
 *
 * Given a cohort cell (e.g. gender/Female with -3.2% adjusted gap) plus the
 * cohort's internal distribution (level, tenure, department breakdowns) and
 * sibling-cohort context, the agent identifies the 3-5 most likely root
 * causes ranked by contribution and recommends a next step.
 *
 * Output conforms to PayEquityAgentResult<CohortRootCauseOutput> — every
 * factual claim must be backed by a citation pointing to a regression
 * coefficient, an in-cohort distribution row, or an employee row.
 *
 * Flow: START → analyze → END (single tool-free LLM call; the calling
 * service pre-computes the deterministic context).
 */

import { START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import type { Citation, CohortRootCauseOutput, PayEquityAgentResult } from '../types/pay-equity.js';
import { buildResult, checkSampleSize } from '../types/pay-equity.js';

// ─── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Pay Equity Cohort Diagnostic AI for the Compport compensation platform. Given a single cohort cell with a measured statistical gap, plus deterministic distribution data (level mix, tenure mix, department mix) and the gaps in sibling cohorts, you identify the 3-5 most likely root causes ranked by contribution.

## Your job

Return a JSON object with EXACTLY these keys:
- \`rootCauses\`: array of { factor, contribution, explanation }
  - \`factor\`: short identifier ("level concentration", "tenure imbalance", "manager effect", etc.)
  - \`contribution\`: a number 0..1 representing your estimate of how much this factor drives the observed gap
  - \`explanation\`: 1-2 sentences in plain English citing the actual numbers
- \`driverEmployees\`: array of employee IDs (up to 5) you believe are the strongest contributors. Empty array is allowed.
- \`recommendedNextStep\`: ONE concrete next step (e.g. "Run a sub-cohort analysis on IC2 level", "Investigate hiring patterns in the last 6 months", "Engage HRBP to review manager assignments").

## Rules

1. **NEVER fabricate numbers.** Every percent, employee count, or coefficient you cite MUST appear in the input. If the input doesn't support a claim, do not make it.
2. **Order by contribution** — highest to lowest. Contributions should sum to roughly 1.0 but don't force that — distribute according to evidence.
3. **Be concrete.** "Level concentration" beats "structural factors". Cite the level codes, the tenure brackets, the department names that appear in the input.
4. **Plain language.** No statistical jargon in the explanation field — say "this group is concentrated at lower job levels", not "level distribution variance is high".
5. **Sample-size honesty.** If a sub-distribution has < 30 in any cell, do NOT cite it as a primary driver — note it as suggestive instead.
6. **No first-person, no LLM filler.** No "As an AI...", no "I think...", no "Hopefully this helps...". Direct, third-person, declarative.
7. **Tone:** factual, board-grade, neutral. Never alarmist, never dismissive.

Return ONLY the JSON object. No markdown fences, no preamble, no trailing notes.`;

// ─── Public types ───────────────────────────────────────────────────────────

export interface CohortAnalysisInput {
  tenantId: string;
  userId: string;
  /** The cohort under analysis. */
  cohort: {
    dimension: string;
    group: string;
    referenceGroup: string;
    gapPercent: number;
    pValue: number;
    sampleSize: number;
    coefficient: number;
  };
  /** Deterministic within-cohort distributions, computed by the calling service. */
  distributions: {
    byLevel: Array<{ level: string; n: number; meanSalary: number; meanCompaRatio: number | null }>;
    byTenureBucket: Array<{ bucket: string; n: number; meanSalary: number }>;
    byDepartment: Array<{ department: string; n: number; meanSalary: number }>;
  };
  /** Sibling cohorts in the same dimension for relative context. */
  siblingCohorts: Array<{
    group: string;
    gapPercent: number;
    pValue: number;
    sampleSize: number;
  }>;
  /** Top employees in the cohort with the lowest compa-ratios (driver candidates). */
  driverCandidates: Array<{
    id: string;
    employeeCode: string;
    name: string;
    level: string;
    department: string;
    baseSalary: number;
    compaRatio: number | null;
  }>;
  /** Methodology for the parent run. */
  methodology: {
    name: string;
    version: string;
    controls: string[];
    sampleSize: number;
  };
}

export interface CohortAnalysisRawLLM {
  rootCauses: Array<{ factor: string; contribution: number; explanation: string }>;
  driverEmployees: string[];
  recommendedNextStep: string;
}

// ─── Graph builder ──────────────────────────────────────────────────────────

export async function buildCohortRootCauseGraph(options: CreateGraphOptions = {}) {
  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'pay-equity'),
    ...options.modelConfig,
  };
  const model = await createChatModel(aiConfig, modelConfig);

  async function analyze(state: BaseAgentStateType): Promise<{ messages: BaseMessage[] }> {
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    return { messages: [response] };
  }

  return createAgentGraph(
    {
      name: 'pay-equity-cohort-root-cause-graph',
      graphType: 'pay-equity',
      stateSchema: BaseAgentState,
      nodes: { analyze },
      edges: [
        [START, 'analyze'],
        ['analyze', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

// ─── Invoker ────────────────────────────────────────────────────────────────

/**
 * Invoke the cohort root-cause agent. The caller (PayEquityV2Service) is
 * responsible for computing `input.distributions`, `input.siblingCohorts`,
 * and `input.driverCandidates` — the agent doesn't query the DB itself.
 *
 * Returns the full PayEquityAgentResult envelope. The runId is set by the
 * caller after persisting; agents leave it empty.
 */
export async function invokeCohortRootCauseGraph(
  input: CohortAnalysisInput,
  options: CreateGraphOptions = {},
): Promise<PayEquityAgentResult<CohortRootCauseOutput>> {
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'pay-equity'),
    ...options.modelConfig,
  };
  const { graph } = await buildCohortRootCauseGraph({ ...options, config: aiConfig });

  const userPrompt = `Analyze the following cohort and return ONLY a JSON object as specified in your system prompt.

## Cohort under analysis
- dimension: ${input.cohort.dimension}
- group: ${input.cohort.group}
- reference group: ${input.cohort.referenceGroup}
- adjusted gap: ${input.cohort.gapPercent}%
- p-value: ${input.cohort.pValue}
- sample size: ${input.cohort.sampleSize}
- coefficient: ${input.cohort.coefficient}

## Within-cohort distributions

### By level
${input.distributions.byLevel
  .map(
    (l) =>
      `- ${l.level}: n=${l.n}, mean salary=$${Math.round(l.meanSalary).toLocaleString()}, mean CR=${l.meanCompaRatio !== null ? l.meanCompaRatio.toFixed(2) : 'n/a'}`,
  )
  .join('\n')}

### By tenure bucket
${input.distributions.byTenureBucket
  .map((t) => `- ${t.bucket}: n=${t.n}, mean salary=$${Math.round(t.meanSalary).toLocaleString()}`)
  .join('\n')}

### By department
${input.distributions.byDepartment
  .map(
    (d) => `- ${d.department}: n=${d.n}, mean salary=$${Math.round(d.meanSalary).toLocaleString()}`,
  )
  .join('\n')}

## Sibling cohorts (${input.cohort.dimension} groups other than ${input.cohort.group})
${input.siblingCohorts
  .map((s) => `- ${s.group}: gap=${s.gapPercent}%, p=${s.pValue}, n=${s.sampleSize}`)
  .join('\n')}

## Driver employee candidates (top lowest compa-ratios in the cohort)
${input.driverCandidates
  .map(
    (e) =>
      `- ${e.id}  ${e.employeeCode}  ${e.name}  level=${e.level}  dept=${e.department}  CR=${e.compaRatio?.toFixed(2) ?? 'n/a'}  salary=$${Math.round(e.baseSalary).toLocaleString()}`,
  )
  .join('\n')}

## Methodology
${input.methodology.name}@${input.methodology.version} controlling for ${input.methodology.controls.join(', ')} on n=${input.methodology.sampleSize}.

Return the JSON object now.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(userPrompt)],
    metadata: { analysisType: 'pay-equity-cohort-root-cause' },
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const raw =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const parsed = parseLLMOutput(raw);

  // ─── Build citations from the input data we passed in ────
  const citations: Citation[] = [
    {
      type: 'regression_coefficient',
      ref: `${input.cohort.dimension}.${input.cohort.group}.vs.${input.cohort.referenceGroup}`,
      excerpt: `β=${input.cohort.coefficient}, p=${input.cohort.pValue}, n=${input.cohort.sampleSize}`,
    },
    ...input.distributions.byLevel.slice(0, 5).map(
      (l): Citation => ({
        type: 'cohort_query',
        ref: `cohort:${input.cohort.dimension}/${input.cohort.group}/level=${l.level}`,
        excerpt: `n=${l.n}, mean=$${Math.round(l.meanSalary).toLocaleString()}`,
      }),
    ),
    ...parsed.driverEmployees.slice(0, 5).map(
      (id): Citation => ({
        type: 'employee_row',
        ref: id,
        excerpt: input.driverCandidates.find((e) => e.id === id)?.employeeCode ?? id,
      }),
    ),
  ];

  // ─── Warnings ────────────────────────────────────────────
  const warnings = [
    ...checkSampleSize(
      input.distributions.byLevel.map((l) => ({
        name: `level=${l.level}`,
        n: l.n,
      })),
      30,
    ),
  ];

  // ─── Confidence ──────────────────────────────────────────
  const confidence: 'high' | 'medium' | 'low' =
    input.cohort.sampleSize >= 100 && warnings.length === 0
      ? 'high'
      : input.cohort.sampleSize < 30
        ? 'low'
        : 'medium';

  const output: CohortRootCauseOutput = {
    cohort: { dimension: input.cohort.dimension, group: input.cohort.group },
    rootCauses: parsed.rootCauses,
    driverEmployees: parsed.driverEmployees,
    recommendedNextStep: parsed.recommendedNextStep,
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
      llmModel: modelConfigName(modelConfig),
    },
    confidence,
    warnings,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseLLMOutput(raw: string): CohortAnalysisRawLLM {
  // Strip markdown fences the LLM might emit despite instructions.
  const cleaned = raw
    .replace(/```json?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  let parsed: Partial<CohortAnalysisRawLLM>;
  try {
    parsed = JSON.parse(cleaned) as Partial<CohortAnalysisRawLLM>;
  } catch {
    return {
      rootCauses: [],
      driverEmployees: [],
      recommendedNextStep:
        'AI output could not be parsed; rerun with verbose logging to inspect the raw response.',
    };
  }

  return {
    rootCauses: Array.isArray(parsed.rootCauses)
      ? parsed.rootCauses
          .filter(
            (c): c is { factor: string; contribution: number; explanation: string } =>
              typeof c === 'object' &&
              c !== null &&
              typeof (c as { factor?: unknown }).factor === 'string' &&
              typeof (c as { contribution?: unknown }).contribution === 'number' &&
              typeof (c as { explanation?: unknown }).explanation === 'string',
          )
          .map((c) => ({
            factor: c.factor,
            contribution: Math.max(0, Math.min(1, c.contribution)),
            explanation: c.explanation,
          }))
      : [],
    driverEmployees: Array.isArray(parsed.driverEmployees)
      ? parsed.driverEmployees.filter((e): e is string => typeof e === 'string').slice(0, 10)
      : [],
    recommendedNextStep:
      typeof parsed.recommendedNextStep === 'string' ? parsed.recommendedNextStep : '',
  };
}

function modelConfigName(modelConfig: { model?: string } | unknown): string | undefined {
  if (typeof modelConfig === 'object' && modelConfig !== null && 'model' in modelConfig) {
    const m = (modelConfig as { model?: unknown }).model;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}
