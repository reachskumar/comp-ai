/**
 * Pay Equity Analysis graph — LangGraph agent that generates executive-ready
 * narrative reports from statistical pay equity analysis results.
 *
 * Flow: START → analyze → narrate → END
 *
 * The analyze node processes statistical data, and the narrate node uses GPT-4o
 * to generate an executive summary, key findings, and remediation recommendations.
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';

const SYSTEM_PROMPT = `You are a Pay Equity Analysis AI for the Compport compensation platform. You generate executive-ready narrative reports from statistical pay equity analysis results.

Your reports must be:
- Clear and actionable for HR executives and compensation committees
- Backed by the statistical data provided (never fabricate numbers)
- Compliant with pay transparency regulations (EU Pay Transparency Directive, US Equal Pay Act)
- Structured with: Executive Summary, Key Findings, Risk Assessment, Remediation Recommendations

Guidelines:
- Reference specific regression coefficients and p-values when discussing gaps
- Classify gaps as: Statistically Significant (p < 0.05), Marginally Significant (0.05 ≤ p < 0.10), Not Significant (p ≥ 0.10)
- For significant gaps, always recommend specific remediation actions with estimated costs
- Use professional, neutral language appropriate for board-level presentations
- Include compliance risk ratings: HIGH (gap > 5%, p < 0.05), MEDIUM (gap 2-5%, p < 0.10), LOW (gap < 2%)
- Format currency values with proper symbols and commas`;

export interface PayEquityAnalysisInput {
  tenantId: string;
  userId: string;
  analysisData: {
    dimensions: string[];
    regressionResults: Array<{
      dimension: string;
      group: string;
      coefficient: number;
      standardError: number;
      tStatistic: number;
      pValue: number;
      confidenceInterval: [number, number];
      sampleSize: number;
    }>;
    compaRatios: Array<{
      dimension: string;
      group: string;
      avgCompaRatio: number;
      medianCompaRatio: number;
      count: number;
    }>;
    overallStats: {
      totalEmployees: number;
      rSquared: number;
      adjustedRSquared: number;
      fStatistic: number;
      controlVariables: string[];
    };
    remediationEstimate?: {
      totalCost: number;
      affectedEmployees: number;
      avgAdjustment: number;
    };
  };
}

export interface PayEquityAnalysisOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  narrative: string;
}

/**
 * Build and compile the pay equity analysis graph.
 */
export async function buildPayEquityGraph(
  options: CreateGraphOptions = {},
) {
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'pay-equity'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  // Narrate node: generates executive report from analysis data
  async function narrateNode(
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const response = await model.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  return createAgentGraph(
    {
      name: 'pay-equity-graph',
      graphType: 'pay-equity',
      stateSchema: BaseAgentState,
      nodes: {
        narrate: narrateNode,
      },
      edges: [
        [START, 'narrate'],
        ['narrate', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the pay equity graph.
 */
export async function invokePayEquityGraph(
  input: PayEquityAnalysisInput,
  options: CreateGraphOptions = {},
): Promise<PayEquityAnalysisOutput> {
  const { graph } = await buildPayEquityGraph(options);

  const prompt = `Analyze the following pay equity statistical results and generate an executive-ready report:

${JSON.stringify(input.analysisData, null, 2)}

Generate a comprehensive report with:
1. Executive Summary (2-3 paragraphs)
2. Key Findings (bullet points with statistical backing)
3. Risk Assessment (compliance risk rating per dimension)
4. Remediation Recommendations (specific actions with cost estimates)
5. Methodology Note (brief description of statistical approach)`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(prompt)],
    metadata: { analysisType: 'pay-equity' },
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const narrative =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    messages,
    narrative,
  };
}

