/**
 * Base state schema for all LangGraph agent graphs.
 * Uses LangGraph Annotation system with MessagesAnnotation for message handling.
 */

import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

/**
 * Metadata stored alongside graph state — arbitrary key/value pairs
 * for domain-specific context (similar to JSONB).
 */
export type GraphMetadata = Record<string, unknown>;

/**
 * Base agent state annotation that all graphs should extend.
 *
 * Includes:
 * - `tenantId` — multi-tenant isolation
 * - `userId` — the user who triggered the graph
 * - `messages` — conversation history (from MessagesAnnotation, supports reducer)
 * - `metadata` — arbitrary JSONB-like context object
 *
 * @example
 * ```ts
 * import { Annotation } from '@langchain/langgraph';
 * import { BaseAgentState } from '@compensation/ai';
 *
 * const MyGraphState = Annotation.Root({
 *   ...BaseAgentState.spec,
 *   customField: Annotation<string>,
 * });
 * ```
 */
export const BaseAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  metadata: Annotation<GraphMetadata>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

/** TypeScript type inferred from the BaseAgentState annotation */
export type BaseAgentStateType = typeof BaseAgentState.State;

/** Update type for BaseAgentState (what you pass to graph nodes) */
export type BaseAgentStateUpdate = typeof BaseAgentState.Update;

