/**
 * Policy RAG graph — LangGraph state machine for answering questions
 * grounded in company policy documents.
 *
 * Flow: START → agent (tool-calling LLM with search_policies + list_policies)
 *       ←→ tools → END
 *
 * The agent uses semantic search to find relevant policy chunks, then
 * generates an answer with citations referencing specific documents.
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  createPolicyRagTools,
  type PolicyRagDbAdapter,
  type EmbedFunction,
} from '../tools/policy-rag-tools.js';

const SYSTEM_PROMPT = `You are the Policy AI Assistant for the Compport platform. You help HR professionals find and understand company compensation policies.

You have access to tools that search the company's uploaded policy documents using semantic search.

Guidelines:
- ALWAYS use the search_policies tool to find relevant policy content before answering
- Ground your answers in the actual policy text — never make up policy details
- Include citations referencing the source document title and relevant section
- Format citations as [Source: Document Title] at the end of each referenced statement
- If no relevant policies are found, say so clearly and suggest uploading the relevant policy
- Present information clearly with formatting (bullet points, bold for key terms)
- If a question is ambiguous, search for multiple interpretations
- Keep responses concise but complete
- You can use list_policies to show what documents are available`;

export interface PolicyRagGraphInput {
  tenantId: string;
  userId: string;
  message: string;
  conversationId?: string;
}

export interface PolicyRagGraphOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/**
 * Build and compile the policy RAG graph.
 */
export async function buildPolicyRagGraph(
  db: PolicyRagDbAdapter,
  embedFn: EmbedFunction,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createPolicyRagTools(tenantId, db, embedFn);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'policy-rag'),
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
      name: 'policy-rag-graph',
      graphType: 'policy-rag',
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
 * Convenience function to invoke the policy RAG graph.
 */
export async function invokePolicyRagGraph(
  input: PolicyRagGraphInput,
  db: PolicyRagDbAdapter,
  embedFn: EmbedFunction,
  options: CreateGraphOptions = {},
): Promise<PolicyRagGraphOutput> {
  const { graph } = await buildPolicyRagGraph(db, embedFn, input.tenantId, options);

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
