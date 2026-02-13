/**
 * Report Builder graph — multi-node LangGraph agent for the Natural Language Report Builder.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 *
 * The agent uses tool-calling to parse user intent, query data, and generate
 * structured report output with chart configuration and narrative summary.
 *
 * SECURITY: All queries are read-only, parameterized, and tenant-scoped.
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
import { createReportBuilderTools, type ReportBuilderDbAdapter } from '../tools/report-builder-tools.js';

const SYSTEM_PROMPT = `You are the AI Report Builder for the Compport compensation platform. You help HR professionals generate data reports from natural language requests.

Your job:
1. Parse the user's natural language report request
2. Use the available tools to query data (always read-only, tenant-scoped)
3. Return a structured JSON response with report data

IMPORTANT RULES:
- ONLY use the provided tools to query data. Never fabricate data.
- All queries are automatically tenant-scoped for security.
- Return your final answer as a JSON object with this structure:
  {
    "title": "Report title",
    "queryType": "employees|compensation|cycles|payroll|rules|benefits",
    "data": [...array of data rows...],
    "columns": [...array of {key, label, type} for table display...],
    "chartConfig": {
      "type": "bar|pie|line|table",
      "xKey": "field for x-axis",
      "yKey": "field for y-axis",
      "groupKey": "optional grouping field"
    },
    "narrative": "A brief narrative summary of the findings"
  }

Available data models: Employee, CompRecommendation, CompCycle, PayrollRun, RuleSet, BenefitPlan, BenefitEnrollment.
Common fields: department, level, location, baseSalary, totalComp, hireDate, status.

When the user asks for something like "average salary by department", use aggregate_data with metric="avg_salary" and groupBy="department".
When they ask for a list, use execute_prisma_query.
Always start by understanding what data they need, then query it.`;

/** Input to the report builder graph */
export interface ReportBuilderGraphInput {
  tenantId: string;
  userId: string;
  message: string;
  conversationId?: string;
}

/** Output from the report builder graph */
export interface ReportBuilderGraphOutput {
  messages: BaseMessage[];
  response: string;
}

/**
 * Build and compile the report builder graph.
 */
export async function buildReportBuilderGraph(
  db: ReportBuilderDbAdapter,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createReportBuilderTools(tenantId, db);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'report-builder'),
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

  function shouldContinue(state: BaseAgentStateType): string {
    const lastMessage = state.messages[state.messages.length - 1];
    if (
      lastMessage &&
      'tool_calls' in lastMessage &&
      Array.isArray((lastMessage as AIMessage).tool_calls) &&
      ((lastMessage as AIMessage).tool_calls?.length ?? 0) > 0
    ) {
      return 'tools';
    }
    return 'end';
  }

  const toolNode = new ToolNode(tools);

  async function toolExecutor(
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  return createAgentGraph(
    {
      name: 'report-builder-graph',
      graphType: 'report-builder',
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
 * Convenience function to invoke the report builder graph.
 */
export async function invokeReportBuilderGraph(
  input: ReportBuilderGraphInput,
  db: ReportBuilderDbAdapter,
  options: CreateGraphOptions = {},
): Promise<ReportBuilderGraphOutput> {
  const { graph } = await buildReportBuilderGraph(db, input.tenantId, options);

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

  const messages = result.messages as BaseMessage[];
  const lastMessage = messages[messages.length - 1];
  const response = typeof lastMessage?.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage?.content ?? '');

  return { messages, response };
}

