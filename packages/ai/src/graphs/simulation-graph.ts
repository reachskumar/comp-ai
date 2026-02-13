/**
 * Simulation graph — multi-node LangGraph agent for the Compensation Simulation AI.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 *
 * The agent uses tools to:
 * 1. Parse the natural language scenario
 * 2. Identify the affected employee population
 * 3. Run rules engine simulation
 * 4. Calculate budget impact
 * 5. Generate a structured report
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { createSimulationTools, type SimulationDbAdapter } from '../tools/simulation-tools.js';

const SYSTEM_PROMPT = `You are the AI Compensation Simulation Engine for the Compport platform. You help HR professionals run "what-if" scenarios to understand the impact of compensation changes.

You have access to tools that query employee data, run rules simulations, calculate budget impact, and fetch market benchmarks.

## Your Process
1. **Parse the scenario**: Understand what the user wants to simulate (merit increase, bonus cap, etc.)
2. **Identify population**: Use query_employees_for_scenario to find affected employees
3. **Run simulation**: Use run_rules_simulation to apply the compensation change
4. **Calculate impact**: Use calculate_budget_impact to determine budget implications
5. **Get market context**: Optionally use get_market_data for benchmarking

## Output Format
Always provide a structured summary with:
- **Scenario**: What was simulated
- **Affected Employees**: Count and breakdown by department/level
- **Cost Impact**: Total cost delta, per-employee average, budget utilization %
- **Distribution**: Before vs after salary distribution summary
- **Risks/Flags**: Any employees hitting caps, floors, or outlier thresholds
- **Market Context**: How the change compares to market benchmarks (if relevant)

## Guidelines
- Always query data before answering — never guess numbers
- Format currency with $ and commas
- Show percentages to 1 decimal place
- If a scenario is ambiguous, ask for clarification
- Respect multi-tenant isolation — all data is scoped to the user's tenant
- Be concise but thorough in your analysis`;

export interface SimulationGraphInput {
  tenantId: string;
  userId: string;
  message: string;
  conversationId?: string;
}

export interface SimulationGraphOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/**
 * Build and compile the simulation graph.
 */
export async function buildSimulationGraph(
  db: SimulationDbAdapter,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createSimulationTools(tenantId, db);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'simulation'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  const modelWithTools = model.bindTools(tools);

  async function agentNode(
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const response = await modelWithTools.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(tools);

  async function toolExecutor(
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> {
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
      name: 'simulation-graph',
      graphType: 'simulation',
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
 * Convenience function to invoke the simulation graph.
 */
export async function invokeSimulationGraph(
  input: SimulationGraphInput,
  db: SimulationDbAdapter,
  options: CreateGraphOptions = {},
): Promise<SimulationGraphOutput> {
  const { graph } = await buildSimulationGraph(db, input.tenantId, options);

  const config = input.conversationId
    ? { configurable: { thread_id: input.conversationId } }
    : undefined;

  const result = await graph.invoke(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      messages: [new HumanMessage(input.message)],
      metadata: {},
    },
    config,
  );

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const response =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    messages,
    response,
  };
}

