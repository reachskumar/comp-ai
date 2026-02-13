/**
 * Anomaly Explainer graph — multi-node LangGraph agent that generates
 * natural language explanations, root cause analysis, and actionable
 * recommendations for payroll anomalies.
 *
 * Flow: START → contextualize → analyze_root_cause → generate_explanation → suggest_actions → END
 */

import { Annotation } from '@langchain/langgraph';
import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';

// ─── State ──────────────────────────────────────────────────

export interface AnomalyData {
  id: string;
  anomalyType: string;
  severity: string;
  employeeId: string;
  details: Record<string, unknown>;
  payrollRunId: string;
}

export interface AnomalyExplainerResult {
  explanation: string;
  rootCause: string;
  contributingFactors: string[];
  recommendedAction: 'approve' | 'flag' | 'block';
  confidence: number;
  reasoning: string;
}

const AnomalyExplainerState = Annotation.Root({
  ...BaseAgentState.spec,
  anomalyData: Annotation<AnomalyData | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  context: Annotation<string>({
    reducer: (_c, u) => u,
    default: () => '',
  }),
  rootCauseAnalysis: Annotation<string>({
    reducer: (_c, u) => u,
    default: () => '',
  }),
  explanationText: Annotation<string>({
    reducer: (_c, u) => u,
    default: () => '',
  }),
  result: Annotation<AnomalyExplainerResult | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
});

type ExplainerState = typeof AnomalyExplainerState.State;

// ─── Input / Output ─────────────────────────────────────────

export interface AnomalyExplainerInput {
  tenantId: string;
  userId: string;
  anomalyData: AnomalyData;
}

export interface AnomalyExplainerOutput {
  tenantId: string;
  userId: string;
  result: AnomalyExplainerResult;
}

// ─── Prompts ────────────────────────────────────────────────

const CONTEXTUALIZE_PROMPT = `You are a payroll anomaly analyst. Given the following anomaly data, provide a concise context summary describing what happened, including the anomaly type, severity, and key data points. Be factual and precise.

Anomaly Data:
{anomalyData}

Respond with ONLY a context summary paragraph. No headers, no bullet points.`;

const ROOT_CAUSE_PROMPT = `You are a payroll root cause analyst. Given the context below, analyze the most likely root causes for this payroll anomaly.

Context: {context}

Anomaly Data: {anomalyData}

Provide a concise root cause analysis. Consider: data entry errors, policy changes, system glitches, legitimate compensation changes, seasonal variations, or calculation errors. Respond with ONLY the analysis text.`;

const EXPLANATION_PROMPT = `You are a payroll communication specialist. Write a clear, plain-English explanation of this payroll anomaly for an HR professional.

Context: {context}
Root Cause Analysis: {rootCause}
Anomaly Data: {anomalyData}

Write a 2-3 sentence explanation that a non-technical HR person can understand. Be specific about what happened and why. Respond with ONLY the explanation text.`;

const ACTION_PROMPT = `You are a payroll compliance advisor. Based on the analysis below, recommend an action and provide your reasoning.

Context: {context}
Root Cause: {rootCause}
Explanation: {explanation}
Anomaly Type: {anomalyType}
Severity: {severity}

Respond in EXACTLY this JSON format (no markdown, no code fences):
{
  "recommendedAction": "approve" | "flag" | "block",
  "confidence": <number 0-1>,
  "contributingFactors": ["factor1", "factor2"],
  "reasoning": "brief reasoning for the recommendation"
}

Guidelines:
- "approve": Low risk, likely legitimate (e.g. small variance, known policy change)
- "flag": Medium risk, needs human review (e.g. unusual but explainable)
- "block": High risk, should not proceed without investigation (e.g. large unexplained spike, potential error)`;

// ─── Graph Builder ──────────────────────────────────────────

export async function buildAnomalyExplainerGraph(
  options: CreateGraphOptions = {},
) {
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'anomaly-explainer'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  // Node 1: Contextualize the anomaly
  async function contextualize(state: ExplainerState): Promise<Partial<ExplainerState>> {
    const anomaly = state.anomalyData;
    if (!anomaly) throw new Error('No anomaly data provided');

    const prompt = CONTEXTUALIZE_PROMPT.replace('{anomalyData}', JSON.stringify(anomaly, null, 2));
    const response = await model.invoke([
      new SystemMessage('You are a payroll anomaly analyst.'),
      new HumanMessage(prompt),
    ]);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return { context: content };
  }

  // Node 2: Analyze root cause
  async function analyzeRootCause(state: ExplainerState): Promise<Partial<ExplainerState>> {
    const anomaly = state.anomalyData;
    const prompt = ROOT_CAUSE_PROMPT
      .replace('{context}', state.context)
      .replace('{anomalyData}', JSON.stringify(anomaly, null, 2));

    const response = await model.invoke([
      new SystemMessage('You are a payroll root cause analyst.'),
      new HumanMessage(prompt),
    ]);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return { rootCauseAnalysis: content };
  }

  // Node 3: Generate plain-English explanation
  async function generateExplanation(state: ExplainerState): Promise<Partial<ExplainerState>> {
    const anomaly = state.anomalyData;
    const prompt = EXPLANATION_PROMPT
      .replace('{context}', state.context)
      .replace('{rootCause}', state.rootCauseAnalysis)
      .replace('{anomalyData}', JSON.stringify(anomaly, null, 2));

    const response = await model.invoke([
      new SystemMessage('You are a payroll communication specialist.'),
      new HumanMessage(prompt),
    ]);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return { explanationText: content };
  }

  // Node 4: Suggest actions
  async function suggestActions(state: ExplainerState): Promise<Partial<ExplainerState>> {
    const anomaly = state.anomalyData;
    const prompt = ACTION_PROMPT
      .replace('{context}', state.context)
      .replace('{rootCause}', state.rootCauseAnalysis)
      .replace('{explanation}', state.explanationText)
      .replace('{anomalyType}', anomaly?.anomalyType ?? 'UNKNOWN')
      .replace('{severity}', anomaly?.severity ?? 'UNKNOWN');

    const response = await model.invoke([
      new SystemMessage('You are a payroll compliance advisor. Respond only in valid JSON.'),
      new HumanMessage(prompt),
    ]);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    let parsed: { recommendedAction?: string; confidence?: number; contributingFactors?: string[]; reasoning?: string };
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { recommendedAction: 'flag', confidence: 0.5, contributingFactors: [], reasoning: content };
    }

    const action = (['approve', 'flag', 'block'].includes(parsed.recommendedAction ?? '')
      ? parsed.recommendedAction
      : 'flag') as 'approve' | 'flag' | 'block';

    const result: AnomalyExplainerResult = {
      explanation: state.explanationText,
      rootCause: state.rootCauseAnalysis,
      contributingFactors: Array.isArray(parsed.contributingFactors) ? parsed.contributingFactors : [],
      recommendedAction: action,
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      reasoning: parsed.reasoning ?? content,
    };

    return { result };
  }

  return createAgentGraph(
    {
      name: 'anomaly-explainer-graph',
      graphType: 'anomaly-explainer',
      stateSchema: AnomalyExplainerState,
      nodes: {
        contextualize,
        analyze_root_cause: analyzeRootCause,
        generate_explanation: generateExplanation,
        suggest_actions: suggestActions,
      },
      edges: [
        [START, 'contextualize'],
        ['contextualize', 'analyze_root_cause'],
        ['analyze_root_cause', 'generate_explanation'],
        ['generate_explanation', 'suggest_actions'],
        ['suggest_actions', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the anomaly explainer graph.
 */
export async function invokeAnomalyExplainerGraph(
  input: AnomalyExplainerInput,
  options: CreateGraphOptions = {},
): Promise<AnomalyExplainerOutput> {
  const { graph } = await buildAnomalyExplainerGraph(options);

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(`Explain anomaly: ${input.anomalyData.id}`)],
    metadata: {},
    anomalyData: input.anomalyData,
    context: '',
    rootCauseAnalysis: '',
    explanationText: '',
    result: null,
  });

  const explainerResult = result.result as AnomalyExplainerResult | null;
  if (!explainerResult) {
    throw new Error('Anomaly explainer graph did not produce a result');
  }

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    result: explainerResult,
  };
}
