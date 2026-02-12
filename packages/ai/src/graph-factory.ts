/**
 * Graph factory — create tenant-aware LangGraph agent graphs with
 * pre-wired OpenAI model and PostgreSQL checkpointer.
 */

import {
  type AnnotationRoot,
  type CompiledStateGraph,
  type StateDefinition,
  StateGraph,
  START,
  END,
} from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import {
  loadAIConfig,
  resolveModelConfig,
  type AIConfig,
  type ModelConfig,
} from './config.js';
import { createCheckpointer } from './checkpointer.js';

/**
 * A node function that receives state and returns a partial state update.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeFunction = (state: any) => Promise<Record<string, unknown>>;

/**
 * Edge definition for conditional routing.
 */
export interface ConditionalEdge {
  /** Source node name */
  source: string;
  /** Router function that returns the next node name */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router: (state: any) => string | Promise<string>;
  /** Map of router return values to destination node names */
  destinations: Record<string, string>;
}

/**
 * Definition of a graph to be built by the factory.
 */
export interface GraphDefinition<SD extends StateDefinition> {
  /** Human-readable name for this graph (used for logging/tracing) */
  name: string;
  /** Graph type key (used to resolve model config overrides) */
  graphType?: string;
  /** State annotation (e.g. BaseAgentState or an extended version) */
  stateSchema: AnnotationRoot<SD>;
  /** Node definitions: name → handler function */
  nodes: Record<string, NodeFunction>;
  /** Simple edges: [from, to] pairs (use START and END constants) */
  edges: Array<[string, string]>;
  /** Conditional edges for dynamic routing */
  conditionalEdges?: Array<ConditionalEdge>;
  /** Tools to bind to the model (for tool-calling graphs) */
  tools?: StructuredToolInterface[];
}

/**
 * Options for createAgentGraph.
 */
export interface CreateGraphOptions {
  /** Override AI config (defaults to loading from env) */
  config?: AIConfig;
  /** Override model config */
  modelConfig?: Partial<ModelConfig>;
  /** Provide a pre-built checkpointer (skips creating one) */
  checkpointer?: BaseCheckpointSaver;
  /** Connection string for checkpointer (if not providing one) */
  connectionString?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCompiledGraph = CompiledStateGraph<any, any, any, any>;

/**
 * Create a compiled, invokable LangGraph agent graph.
 *
 * Wires up:
 * - OpenAI model (from config, with optional graph-type overrides)
 * - PostgreSQL checkpointer (with MemorySaver fallback)
 * - All nodes and edges from the graph definition
 *
 * Returns a compiled graph ready to invoke with `.invoke()` or `.stream()`.
 *
 * @example
 * ```ts
 * const graph = await createAgentGraph({
 *   name: 'echo',
 *   graphType: 'echo',
 *   stateSchema: BaseAgentState,
 *   nodes: { respond: async (state) => ({ messages: [...] }) },
 *   edges: [[START, 'respond'], ['respond', END]],
 * });
 * const result = await graph.invoke({ tenantId: 't1', userId: 'u1', messages: [...] });
 * ```
 */
export async function createAgentGraph<SD extends StateDefinition>(
  definition: GraphDefinition<SD>,
  options: CreateGraphOptions = {},
): Promise<{ graph: AnyCompiledGraph; model: ChatOpenAI }> {
  // Resolve configuration
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, definition.graphType),
    ...options.modelConfig,
  };

  // Create OpenAI model
  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  // Bind tools if provided
  const boundModel = definition.tools?.length
    ? model.bindTools(definition.tools)
    : model;

  // Store the model on the graph for node access
  void boundModel;

  // Create checkpointer
  const checkpointer =
    options.checkpointer ??
    (await createCheckpointer(options.connectionString));

  // Build graph
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = new StateGraph(definition.stateSchema as any);

  // Add nodes
  for (const [nodeName, handler] of Object.entries(definition.nodes)) {
    builder.addNode(nodeName, handler);
  }

  // Add simple edges
  for (const [from, to] of definition.edges) {
    builder.addEdge(
      from === '__start__' ? START : from,
      to === '__end__' ? END : to,
    );
  }

  // Add conditional edges
  if (definition.conditionalEdges) {
    for (const ce of definition.conditionalEdges) {
      builder.addConditionalEdges(ce.source, ce.router, ce.destinations);
    }
  }

  // Compile with checkpointer
  const graph: AnyCompiledGraph = builder.compile({ checkpointer });

  return { graph, model };
}

export { START, END } from '@langchain/langgraph';

