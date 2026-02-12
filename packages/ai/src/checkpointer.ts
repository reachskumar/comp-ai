/**
 * PostgreSQL checkpointer setup for persistent agent state.
 * Falls back to MemorySaver when the DB connection is unavailable.
 */

import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

/**
 * Create a checkpointer for LangGraph agent graphs.
 *
 * Tries to connect to PostgreSQL using the provided connection string
 * (or DATABASE_URL from env). If the connection fails, falls back to
 * an in-memory checkpointer with a warning.
 *
 * @param connectionString - PostgreSQL connection string. Defaults to DATABASE_URL env var.
 * @returns A checkpointer instance (PostgresSaver or MemorySaver fallback).
 *
 * @example
 * ```ts
 * const checkpointer = await createCheckpointer();
 * const graph = builder.compile({ checkpointer });
 * ```
 */
export async function createCheckpointer(
  connectionString?: string,
): Promise<BaseCheckpointSaver> {
  const connStr = connectionString ?? process.env['DATABASE_URL'];

  if (!connStr) {
    console.warn(
      '[ai/checkpointer] No DATABASE_URL set — using in-memory checkpointer. State will not persist across restarts.',
    );
    return new MemorySaver();
  }

  try {
    const checkpointer = PostgresSaver.fromConnString(connStr);
    await checkpointer.setup();
    return checkpointer;
  } catch (error) {
    console.warn(
      '[ai/checkpointer] Failed to connect to PostgreSQL — falling back to in-memory checkpointer.',
      error instanceof Error ? error.message : error,
    );
    return new MemorySaver();
  }
}

