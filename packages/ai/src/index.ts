/**
 * @compensation/ai
 * Shared LangGraph.js infrastructure for the compensation platform.
 * Provides graph factories, state schemas, tools, streaming, and checkpointing.
 */

// Configuration
export {
  loadAIConfig,
  resolveModelConfig,
  type AIConfig,
  type ModelConfig,
} from './config.js';

// Base state schema
export {
  BaseAgentState,
  type BaseAgentStateType,
  type BaseAgentStateUpdate,
  type GraphMetadata,
} from './state.js';

// Tool utilities
export { createDomainTool, type DomainToolOptions } from './tools.js';

// Checkpointer
export { createCheckpointer } from './checkpointer.js';

// Graph factory
export {
  createAgentGraph,
  START,
  END,
  type GraphDefinition,
  type ConditionalEdge,
  type CreateGraphOptions,
  type NodeFunction,
} from './graph-factory.js';

// Streaming
export {
  streamGraphToSSE,
  formatSSE,
  sseToReadableStream,
  type SSEEvent,
  type SSEEventType,
} from './streaming.js';

// Graphs
export {
  buildEchoGraph,
  invokeEchoGraph,
  type EchoGraphInput,
  type EchoGraphOutput,
} from './graphs/echo-graph.js';

