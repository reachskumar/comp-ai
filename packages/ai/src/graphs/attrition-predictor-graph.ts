/**
 * Attrition Predictor graph — generates natural language retention
 * recommendations for HIGH/CRITICAL risk employees via GPT-4o.
 *
 * Only invoked for employees with risk score >= 51 (cost optimization).
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { createAttritionTools, type AttritionDbAdapter } from '../tools/attrition-tools.js';

// ─── State ──────────────────────────────────────────────────

export const AttritionPredictorState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  employeeId: Annotation<string>,
  metadata: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

export type AttritionPredictorStateType = typeof AttritionPredictorState.State;

// ─── System Prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are the AI Retention Advisor for the Compport compensation platform. You analyze employee attrition risk factors and generate actionable retention recommendations.

When given employee risk data, you should:
1. Analyze the risk factors (compa-ratio, tenure, performance-pay gap, market position, etc.)
2. Identify the top contributing factors to flight risk
3. Generate 2-4 specific, actionable retention recommendations
4. Prioritize recommendations by impact and feasibility
5. Include estimated cost/effort for each recommendation

Format your response as a clear, concise recommendation that HR can act on immediately.
Keep recommendations practical and specific to the employee's situation.`;

// ─── Input/Output Types ─────────────────────────────────────

export interface AttritionPredictorInput {
  tenantId: string;
  userId: string;
  employeeId: string;
  riskData: {
    employeeName: string;
    department: string;
    level: string;
    riskScore: number;
    riskLevel: string;
    factors: Record<string, unknown>;
  };
}

export interface AttritionPredictorOutput {
  recommendation: string;
  employeeId: string;
}

// ─── Graph Builder ──────────────────────────────────────────

export async function buildAttritionPredictorGraph(
  db: AttritionDbAdapter,
  options: CreateGraphOptions = {},
) {
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');

  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'attrition-predictor'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  async function agentNode(
    state: AttritionPredictorStateType,
  ): Promise<Partial<AttritionPredictorStateType>> {
    const messages: BaseMessage[] = [new SystemMessage(SYSTEM_PROMPT), ...state.messages];
    const response = await model.invoke(messages);
    return { messages: [response] };
  }

  return createAgentGraph(
    {
      name: 'attrition-predictor-graph',
      graphType: 'attrition-predictor',
      stateSchema: AttritionPredictorState,
      nodes: { agent: agentNode },
      edges: [
        [START, 'agent'],
        ['agent', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Invoke the attrition predictor graph to generate a recommendation.
 */
export async function invokeAttritionPredictor(
  input: AttritionPredictorInput,
  db: AttritionDbAdapter,
  options: CreateGraphOptions = {},
): Promise<AttritionPredictorOutput> {
  const { graph } = await buildAttritionPredictorGraph(db, options);

  const prompt = `Analyze the following employee's attrition risk and provide retention recommendations:

Employee: ${input.riskData.employeeName}
Department: ${input.riskData.department}
Level: ${input.riskData.level}
Risk Score: ${input.riskData.riskScore}/100 (${input.riskData.riskLevel})

Risk Factors:
${JSON.stringify(input.riskData.factors, null, 2)}

Provide specific, actionable retention recommendations for this employee.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    employeeId: input.employeeId,
    messages: [new HumanMessage(prompt)],
    metadata: {},
  });

  const messages = result.messages as BaseMessage[];
  const lastMessage = messages[messages.length - 1];
  const recommendation =
    lastMessage && 'content' in lastMessage
      ? String(lastMessage.content)
      : 'Unable to generate recommendation.';

  return {
    recommendation,
    employeeId: input.employeeId,
  };
}
