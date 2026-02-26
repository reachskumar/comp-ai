/**
 * Budget Optimizer graph — LangGraph agent for AI-powered budget allocation.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 *
 * The agent uses tools to:
 * 1. Gather department stats (headcount, avg salary, compa-ratio)
 * 2. Analyze attrition risk distribution per department
 * 3. Identify equity gaps
 * 4. Review current allocations and historical utilization
 * 5. Generate 2-3 optimized allocation scenarios with reasoning
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  createBudgetOptimizerTools,
  type BudgetOptimizerDbAdapter,
} from '../tools/budget-optimizer-tools.js';

const SYSTEM_PROMPT = `You are the AI Budget Optimizer for the Compport compensation platform. You help HR professionals optimally allocate compensation cycle budgets across departments.

You have access to tools that query department statistics, attrition risk data, equity gaps, current allocations, and historical utilization.

## Your Process
1. **Gather data**: Use all available tools to collect department stats, attrition risks, equity gaps, current allocations, and historical utilization
2. **Analyze**: Identify departments with high attrition risk, equity gaps, or under-allocation
3. **Generate scenarios**: Create 2-3 allocation scenarios with different priorities

## Output Format
You MUST respond with valid JSON in this exact structure:
{
  "summary": "Brief overview of the analysis",
  "allocations": [
    {
      "department": "Department Name",
      "currentBudget": 0,
      "suggestedBudget": 0,
      "reasoning": "Why this allocation",
      "retentionImpact": "Expected impact on retention",
      "equityImpact": "Expected impact on equity"
    }
  ],
  "scenarios": [
    {
      "name": "Scenario Name (e.g., Retention-First)",
      "description": "What this scenario prioritizes",
      "allocations": [
        { "department": "Dept", "amount": 0, "percentOfTotal": 0 }
      ],
      "tradeoffs": "What you gain and lose with this approach"
    }
  ],
  "impactSummary": {
    "retentionRiskReduction": "Expected overall retention risk reduction",
    "equityGapsClosed": "Number of equity gaps addressed",
    "keyInsights": ["insight1", "insight2"]
  }
}

## Guidelines
- Always query ALL data sources before generating recommendations
- Base allocations on the total budget provided by the user
- Consider attrition risk as a primary factor — departments with high risk need more budget
- Factor in equity gaps — underpaid departments need catch-up allocations
- Use historical utilization to avoid over-allocating to departments that don't spend their budget
- Format currency with $ and commas
- Be specific about trade-offs between scenarios
- Respect multi-tenant isolation`;

export interface BudgetOptimizerInput {
  tenantId: string;
  userId: string;
  cycleId: string;
  totalBudget: number;
  constraints?: {
    minPerDept?: number;
    maxPerDept?: number;
    priorityDepartments?: string[];
  };
}

export interface BudgetOptimizerOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/**
 * Build and compile the budget optimizer graph.
 */
export async function buildBudgetOptimizerGraph(
  db: BudgetOptimizerDbAdapter,
  tenantId: string,
  cycleId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createBudgetOptimizerTools(tenantId, cycleId, db);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'budget-optimizer'),
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
      name: 'budget-optimizer-graph',
      graphType: 'budget-optimizer',
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
 * Convenience function to invoke the budget optimizer graph.
 */
export async function invokeBudgetOptimizer(
  input: BudgetOptimizerInput,
  db: BudgetOptimizerDbAdapter,
  options: CreateGraphOptions = {},
): Promise<BudgetOptimizerOutput> {
  const { graph } = await buildBudgetOptimizerGraph(db, input.tenantId, input.cycleId, options);

  const constraintText = input.constraints
    ? `\nConstraints: ${JSON.stringify(input.constraints)}`
    : '';

  const message = `Optimize budget allocation for cycle ${input.cycleId} with a total budget of $${input.totalBudget.toLocaleString()}.${constraintText}\n\nPlease gather all department data, analyze risks and equity gaps, then generate 2-3 optimized allocation scenarios.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(message)],
    metadata: { cycleId: input.cycleId, totalBudget: input.totalBudget },
  });

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
