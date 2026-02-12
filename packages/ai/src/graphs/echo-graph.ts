/**
 * Echo graph — proof-of-concept LangGraph agent that takes a user message,
 * calls OpenAI to echo/rephrase it, and returns the result.
 *
 * Demonstrates the full pipeline: state → model → checkpointer → response.
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';

/**
 * Input required to invoke the echo graph.
 */
export interface EchoGraphInput {
  tenantId: string;
  userId: string;
  message: string;
}

/**
 * Output from the echo graph invocation.
 */
export interface EchoGraphOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/**
 * Create the echo agent node.
 * This closure captures the model instance so the node can call it.
 */
function createEchoNode(model: ChatOpenAI) {
  return async (
    state: BaseAgentStateType,
  ): Promise<{ messages: BaseMessage[] }> => {
    const response = await model.invoke(state.messages);
    return { messages: [response] };
  };
}

/**
 * Build and compile the echo graph.
 *
 * @param options - Optional overrides for config, checkpointer, etc.
 * @returns The compiled graph and model
 *
 * @example
 * ```ts
 * const { graph } = await buildEchoGraph();
 * const result = await graph.invoke({
 *   tenantId: 'tenant-1',
 *   userId: 'user-1',
 *   messages: [new HumanMessage('Hello!')],
 *   metadata: {},
 * });
 * ```
 */
export async function buildEchoGraph(options: CreateGraphOptions = {}) {
  // We need the model before defining nodes, so resolve config first
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');

  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'echo'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  const echoNode = createEchoNode(model);

  return createAgentGraph(
    {
      name: 'echo-graph',
      graphType: 'echo',
      stateSchema: BaseAgentState,
      nodes: {
        echo: echoNode,
      },
      edges: [
        [START, 'echo'],
        ['echo', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the echo graph with simple string input.
 */
export async function invokeEchoGraph(
  input: EchoGraphInput,
  options: CreateGraphOptions = {},
): Promise<EchoGraphOutput> {
  const { graph } = await buildEchoGraph(options);

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage(input.message)],
    metadata: {},
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

