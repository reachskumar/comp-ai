/**
 * Pay Equity — Manager Equity Copilot graph (Phase 6.3).
 *
 * Bounded Q&A: a manager asks a question about their team or the org's pay
 * equity state and the agent answers using ONLY facts the calling service
 * pre-resolved (the manager's direct reports + the latest narrative run's
 * envelope). Out-of-scope questions are refused, not answered.
 *
 * The narrative is the only LLM-generated content; numbers and employee
 * names come from the input, never the model.
 *
 * Output is wrapped in PayEquityAgentResult<CopilotOutput>.
 */

import { START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  buildResult,
  type Citation,
  type CopilotOutput,
  type PayEquityAgentResult,
} from '../types/pay-equity.js';

const SYSTEM_PROMPT = `You are the Pay Equity Manager Copilot for the Compport compensation platform. A people-manager is asking a question about their team's compensation equity. You answer using ONLY the facts in the input — never invent numbers, names, or claims. If the question is out of scope, you refuse politely.

## What's in scope
- Questions about the named manager's direct reports (compa-ratio, salary, level, gap from cohort mean)
- Questions about the org-wide pay equity findings the workspace already produced (worst cohort, methodology, significant gaps)
- Questions about how a remediation or hiring action would affect this team's equity

## What's out of scope (refuse with refusalReason)
- Performance management, firing, hiring, headcount planning unrelated to equity
- Specific salary figures for employees NOT in the manager's team
- Legal advice ("can I be sued for...?")
- Anything not derivable from the input data

## Output

Return ONLY a JSON object with EXACTLY these keys:
- \`answer\`: 2-5 sentences. Direct, plain English. Cite specific employees by employeeCode (e.g. "EMP-1234"), specific cohorts (e.g. "gender/Female"), specific compa-ratios.
- \`scope\`: "team" | "org" | "out_of_scope" — which input source the answer drew from.
- \`refused\`: boolean — true when the question is out of scope (then \`answer\` should explain why briefly).
- \`refusalReason\`: present only when refused=true.
- \`highlights\`: 0-4 items, each { label, value, detail? } — key facts the answer used. Pull values from the input verbatim.
- \`followUpSuggestions\`: 0-3 short questions the manager could ask next. Don't be salesy ("ask me more!"); these should be concrete questions like "How does this compare to the rest of L4?".

## Rules
1. **NEVER fabricate.** Every percent, dollar, name, code, or cohort label MUST appear in the input.
2. **Refuse cleanly.** Out-of-scope = refused: true + a one-sentence reason. Don't try to be helpful in a domain you don't have data for.
3. **Specific over general.** "EMP-1234 sits at 0.87 compa-ratio, 8% below the L4 cohort mean" beats "Some employees may be underpaid".
4. **No first-person.** No "As an AI", no "I think". Direct, neutral, manager-grade.
5. **Privacy.** Do not name specific salaries for any employee outside the manager's listed team.

Return ONLY the JSON. No markdown, no preamble.`;

// ─── Public types ───────────────────────────────────────────────────────────

export interface CopilotAgentInput {
  tenantId: string;
  userId: string;
  question: string;

  /** The manager asking. Resolved from the JWT user → Employee row by email. */
  manager: {
    employeeId: string | null;
    name: string;
    email: string;
    level: string | null;
    department: string | null;
  };

  /**
   * Manager's direct reports + their cohort context. Only these employees'
   * salaries / compa-ratios are in scope for team-level questions.
   */
  team: Array<{
    employeeId: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    level: string;
    department: string;
    gender: string | null;
    compaRatio: number | null;
    baseSalary: number;
    currency: string;
  }>;

  /**
   * Latest org-wide narrative-run summary. Bounded: just the headline
   * findings, not the full envelope, so the agent can answer "what's the
   * worst cohort across the company" without exposing per-row data.
   */
  orgState: {
    runId: string | null;
    runAt: string | null;
    methodology: string | null;
    sampleSize: number;
    significantGaps: number;
    worstCohort: { dimension: string; group: string; gapPercent: number } | null;
    confidence: 'high' | 'medium' | 'low' | null;
  };

  methodology: {
    name: string;
    version: string;
    controls: string[];
    sampleSize: number;
  };
}

interface RawLLM {
  answer: string;
  scope: 'team' | 'org' | 'out_of_scope';
  refused: boolean;
  refusalReason?: string;
  highlights: Array<{ label: string; value: string; detail?: string }>;
  followUpSuggestions: string[];
}

// ─── Graph ──────────────────────────────────────────────────────────────────

export async function buildPayEquityCopilotGraph(options: CreateGraphOptions = {}) {
  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'pay-equity'),
    ...options.modelConfig,
  };
  const model = await createChatModel(aiConfig, modelConfig);

  async function answer(state: BaseAgentStateType): Promise<{ messages: BaseMessage[] }> {
    const response = await model.invoke([new SystemMessage(SYSTEM_PROMPT), ...state.messages]);
    return { messages: [response] };
  }

  return createAgentGraph(
    {
      name: 'pay-equity-copilot-graph',
      graphType: 'pay-equity',
      stateSchema: BaseAgentState,
      nodes: { answer },
      edges: [
        [START, 'answer'],
        ['answer', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

export async function invokePayEquityCopilotGraph(
  input: CopilotAgentInput,
  options: CreateGraphOptions = {},
): Promise<PayEquityAgentResult<CopilotOutput>> {
  const { loadAIConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const { graph } = await buildPayEquityCopilotGraph({ ...options, config: aiConfig });

  const teamSummary =
    input.team.length === 0
      ? 'No direct reports linked to this manager.'
      : input.team
          .map(
            (e) =>
              `- ${e.employeeCode} ${e.firstName} ${e.lastName}  L=${e.level} ${e.department}  CR=${e.compaRatio?.toFixed(2) ?? 'n/a'}  ${e.currency} ${e.baseSalary.toLocaleString()}  gender=${e.gender ?? 'n/a'}`,
          )
          .join('\n');

  const orgSummary = input.orgState.runId
    ? `Latest org PE run ${input.orgState.runId} at ${input.orgState.runAt?.slice(0, 10) ?? 'n/a'}, methodology ${input.orgState.methodology}, n=${input.orgState.sampleSize}, ${input.orgState.significantGaps} significant gaps. Worst cohort: ${
        input.orgState.worstCohort
          ? `${input.orgState.worstCohort.dimension}/${input.orgState.worstCohort.group} at ${input.orgState.worstCohort.gapPercent.toFixed(1)}%`
          : 'none'
      }. Confidence: ${input.orgState.confidence ?? 'n/a'}.`
    : 'No completed narrative runs yet — org-wide questions cannot be answered.';

  const userPrompt = `Answer the manager's question using ONLY these facts. Return ONLY JSON.

## Manager
${input.manager.name} <${input.manager.email}> · L=${input.manager.level ?? 'n/a'} · ${input.manager.department ?? 'n/a'}

## Manager's direct reports (this team is the team-scope source of truth)
${teamSummary}

## Org pay equity state (this is the org-scope source of truth)
${orgSummary}

## Methodology
${input.methodology.name}@${input.methodology.version} controlling for ${input.methodology.controls.join(', ') || 'none'} on n=${input.methodology.sampleSize}.

## Question
${input.question}

Return the JSON now.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(userPrompt)],
    metadata: { analysisType: 'pay-equity-copilot' },
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const raw =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  const parsed = parseLLMOutput(raw);

  // Citations: every employee referenced in the team list + the org run.
  const citations: Citation[] = [
    ...input.team.map(
      (e): Citation => ({
        type: 'employee_row',
        ref: e.employeeId,
        excerpt: `${e.employeeCode} CR=${e.compaRatio?.toFixed(2) ?? 'n/a'}`,
      }),
    ),
  ];
  if (input.orgState.runId) {
    citations.push({
      type: 'cohort_query',
      ref: input.orgState.runId,
      excerpt: input.orgState.worstCohort
        ? `worst=${input.orgState.worstCohort.dimension}/${input.orgState.worstCohort.group}@${input.orgState.worstCohort.gapPercent.toFixed(1)}%`
        : 'no significant cohorts',
    });
  }

  const output: CopilotOutput = {
    answer: parsed.answer,
    scope: parsed.scope,
    refused: parsed.refused,
    refusalReason: parsed.refusalReason,
    highlights: parsed.highlights.slice(0, 4),
    followUpSuggestions: parsed.followUpSuggestions.slice(0, 3),
  };

  const confidence: 'high' | 'medium' | 'low' = parsed.refused
    ? 'medium'
    : input.team.length >= 1 && parsed.answer.length > 0
      ? 'high'
      : 'medium';

  const warnings =
    parsed.answer.length === 0
      ? [{ code: 'model_unavailable' as const, message: 'LLM returned empty answer' }]
      : input.team.length === 0 && parsed.scope === 'team'
        ? [
            {
              code: 'data_quality' as const,
              message: 'Question asked about a team but the manager has no direct reports linked',
            },
          ]
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
    return {
      answer: '',
      scope: 'out_of_scope',
      refused: true,
      refusalReason: 'Could not parse LLM response',
      highlights: [],
      followUpSuggestions: [],
    };
  }

  const isScope = (v: unknown): v is 'team' | 'org' | 'out_of_scope' =>
    v === 'team' || v === 'org' || v === 'out_of_scope';

  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    scope: isScope(parsed.scope) ? parsed.scope : 'out_of_scope',
    refused: typeof parsed.refused === 'boolean' ? parsed.refused : false,
    refusalReason: typeof parsed.refusalReason === 'string' ? parsed.refusalReason : undefined,
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights.filter(
          (h): h is { label: string; value: string; detail?: string } =>
            typeof h === 'object' &&
            h !== null &&
            typeof (h as { label?: unknown }).label === 'string' &&
            typeof (h as { value?: unknown }).value === 'string',
        )
      : [],
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions)
      ? parsed.followUpSuggestions.filter((s): s is string => typeof s === 'string')
      : [],
  };
}
