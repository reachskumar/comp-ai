/**
 * Copilot graph — multi-node LangGraph agent for the AI Compensation Copilot.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 *
 * The agent node uses a tool-calling model that can invoke domain query tools
 * to answer compensation questions. The graph loops between agent and tools
 * until the model produces a final text response (no tool calls).
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { createCopilotTools, type CopilotDbAdapter } from '../tools/copilot-tools.js';

const SYSTEM_PROMPT = `You are the AI Compensation Copilot for the Compport platform. You help HR professionals, compensation analysts, and managers understand their compensation data.

You have access to tools that query the company's compensation database. Use them to answer questions accurately.

Guidelines:
- Always query data before answering — never guess or make up numbers
- Present data clearly with formatting (tables, bullet points, bold for emphasis)
- When showing salary data, format numbers with commas and currency symbols
- If a query returns no results, say so clearly and suggest alternative queries
- Keep responses concise but complete
- For aggregate questions (averages, totals), use the query_analytics tool
- For individual employee lookups, use query_employees
- Respect that all data is scoped to the user's tenant — you cannot access other tenants' data
- If asked about something outside compensation data, politely redirect to compensation topics`;

export interface CopilotGraphInput {
  tenantId: string;
  userId: string;
  message: string;
  conversationId?: string;
}

export interface CopilotGraphOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/**
 * Build and compile the copilot graph.
 *
 * @param db - Database adapter for domain queries
 * @param tenantId - Tenant ID for multi-tenant isolation
 * @param options - Optional overrides for config, checkpointer, etc.
 */
export async function buildCopilotGraph(
  db: CopilotDbAdapter,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createCopilotTools(tenantId, db);

  // Resolve config to create model with tools bound
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'copilot'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  const modelWithTools = model.bindTools(tools);

  // Agent node: calls the LLM (with tools bound)
  async function agentNode(
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const response = await modelWithTools.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  // Tool executor node
  const toolNode = new ToolNode(tools);

  async function toolExecutor(
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    // ToolNode returns { messages: [...] }
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  // Router: check if the last message has tool calls
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
      name: 'copilot-graph',
      graphType: 'copilot',
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
 * Convenience function to invoke the copilot graph.
 */
export async function invokeCopilotGraph(
  input: CopilotGraphInput,
  db: CopilotDbAdapter,
  options: CreateGraphOptions = {},
): Promise<CopilotGraphOutput> {
  const { graph } = await buildCopilotGraph(db, input.tenantId, options);

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
