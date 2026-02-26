/**
 * Calibration Assistant graph — LangGraph agent that analyzes compensation
 * recommendations in a calibration session and suggests adjustments based on
 * pay equity, retention risk, budget constraints, and performance-pay alignment.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { createCalibrationTools, type CalibrationDbAdapter } from '../tools/calibration-tools.js';

const SYSTEM_PROMPT = `You are the AI Calibration Assistant for the Compport compensation platform. You analyze compensation recommendations within a calibration session and suggest adjustments.

Your analysis considers these factors:
1. **Pay Equity**: Employees at the same level/department with different demographics should receive similar increases. Flag gaps.
2. **Retention Risk**: Employees with HIGH or CRITICAL attrition risk should receive above-median increases to retain them.
3. **Budget Compliance**: Total suggested increases must stay within the department/cycle budget.
4. **Performance-Pay Alignment**: Rating >= 4 should get above-median increases; rating <= 2 should get below-median.
5. **Compa-Ratio Correction**: Employees below 0.85 compa-ratio should get larger increases to close the gap.

For each recommendation you analyze, output a JSON suggestion with:
- recommendationId: the recommendation ID
- employeeName: employee name
- currentProposed: the manager's current proposed value
- suggestedValue: your recommended value
- changePercent: the percentage change from current salary
- reason: clear justification referencing specific data points
- priority: HIGH, MEDIUM, or LOW based on urgency

IMPORTANT:
- Always query data first using the available tools before making suggestions
- Be specific in your reasoning — cite actual numbers (compa-ratio, risk score, etc.)
- Only suggest changes where there is a clear data-driven reason
- Format your final response as a JSON array of suggestions wrapped in \`\`\`json code blocks
- If no adjustments are needed, return an empty array with an explanation`;

export interface CalibrationAssistantInput {
  tenantId: string;
  userId: string;
  cycleId: string;
  sessionId: string;
}

export interface CalibrationSuggestion {
  recommendationId: string;
  employeeName: string;
  currentProposed: number;
  suggestedValue: number;
  changePercent: number;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CalibrationAssistantOutput {
  tenantId: string;
  userId: string;
  suggestions: CalibrationSuggestion[];
  response: string;
}

/**
 * Build and compile the calibration assistant graph.
 */
export async function buildCalibrationAssistantGraph(
  db: CalibrationDbAdapter,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createCalibrationTools(tenantId, db);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'calibration-assistant'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  const modelWithTools = model.bindTools(tools);

  async function agentNode(state: BaseAgentStateType): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const response = await modelWithTools.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(tools);

  async function toolExecutor(state: BaseAgentStateType): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  function shouldContinue(state: BaseAgentStateType): string {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];

    if (
      lastMessage &&
      'tool_calls' in lastMessage &&
      Array.isArray((lastMessage as AIMessage).tool_calls) &&
      (lastMessage as AIMessage).tool_calls!.length > 0
    ) {
      return 'tools';
    }
    return 'end';
  }

  return createAgentGraph(
    {
      name: 'calibration-assistant-graph',
      graphType: 'calibration-assistant',
      stateSchema: BaseAgentState,
      nodes: {
        agent: agentNode,
        tools: toolExecutor,
      },
      edges: [
        [START, 'agent'],
        ['tools', 'agent'],
      ],
      conditionalEdges: [
        {
          source: 'agent',
          router: shouldContinue,
          destinations: {
            tools: 'tools',
            end: END,
          },
        },
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Invoke the calibration assistant graph to generate suggestions.
 */
export async function invokeCalibrationAssistant(
  input: CalibrationAssistantInput,
  db: CalibrationDbAdapter,
  options: CreateGraphOptions = {},
): Promise<CalibrationAssistantOutput> {
  const { graph } = await buildCalibrationAssistantGraph(db, input.tenantId, options);

  const prompt = `Analyze the calibration session and suggest adjustments.

Cycle ID: ${input.cycleId}
Session ID: ${input.sessionId}

Steps:
1. First, get all recommendations in this session using get_session_recommendations
2. Get employee details for all participants using get_employee_details
3. Get attrition risk scores using get_attrition_risk_scores
4. Get the cycle budget using get_cycle_budget
5. Analyze the data and generate suggestions based on pay equity, retention risk, budget compliance, performance-pay alignment, and compa-ratio correction

Return your suggestions as a JSON array.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(prompt)],
    metadata: {},
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const response =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  // Parse suggestions from the response
  const suggestions = parseSuggestions(response);

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    suggestions,
    response,
  };
}

/**
 * Parse JSON suggestions from the AI response text.
 */
function parseSuggestions(response: string): CalibrationSuggestion[] {
  try {
    // Try to extract JSON from code blocks
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch?.[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    }

    // Try to parse the entire response as JSON
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) return parsed;

    return [];
  } catch {
    return [];
  }
}
