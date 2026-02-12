/**
 * Streaming adapter — converts LangGraph stream events to SSE format
 * for consumption by NestJS SSE endpoints.
 */

/**
 * SSE event types emitted by the streaming adapter.
 */
export type SSEEventType =
  | 'graph:start'
  | 'node:start'
  | 'node:end'
  | 'message:chunk'
  | 'graph:end'
  | 'error';

/**
 * An SSE event as emitted by the streaming adapter.
 */
export interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
}

/**
 * Format an SSEEvent into the Server-Sent Events wire format.
 *
 * @example
 * ```
 * event: message:chunk
 * data: {"content":"Hello"}
 * ```
 */
export function formatSSE(event: SSEEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Convert a LangGraph stream into an async generator of SSE events.
 *
 * This maps LangGraph's internal event types to a simplified set of
 * SSE events suitable for frontend consumption:
 *
 * - `graph:start` — emitted once at the beginning
 * - `node:start` / `node:end` — emitted for each graph node execution
 * - `message:chunk` — emitted for streamed LLM token chunks
 * - `graph:end` — emitted once at the end
 * - `error` — emitted if the graph throws
 *
 * @param stream - A LangGraph `.streamEvents()` async iterable
 * @param options - Optional metadata to include in events
 *
 * @example
 * ```ts
 * // NestJS SSE controller
 * @Sse('stream')
 * async stream(): Promise<Observable<MessageEvent>> {
 *   const stream = graph.streamEvents(input, { version: 'v2' });
 *   const sseStream = streamGraphToSSE(stream);
 *   return from(sseStream).pipe(
 *     map(event => ({ data: JSON.stringify(event) })),
 *   );
 * }
 * ```
 */
export async function* streamGraphToSSE(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: AsyncIterable<any>,
  options: { graphName?: string; runId?: string } = {},
): AsyncGenerator<SSEEvent> {
  const { graphName, runId } = options;

  yield {
    event: 'graph:start',
    data: { graphName: graphName ?? 'unknown', runId: runId ?? null, timestamp: Date.now() },
  };

  try {
    for await (const event of stream) {
      const eventType: string = event.event ?? '';

      if (eventType === 'on_chain_start' && event.name) {
        yield {
          event: 'node:start',
          data: { node: event.name, timestamp: Date.now() },
        };
      } else if (eventType === 'on_chain_end' && event.name) {
        yield {
          event: 'node:end',
          data: {
            node: event.name,
            output: event.data?.output ?? null,
            timestamp: Date.now(),
          },
        };
      } else if (
        eventType === 'on_chat_model_stream' ||
        eventType === 'on_llm_stream'
      ) {
        const chunk = event.data?.chunk;
        const content =
          typeof chunk === 'string'
            ? chunk
            : chunk?.content ?? chunk?.text ?? '';
        if (content) {
          yield {
            event: 'message:chunk',
            data: { content, timestamp: Date.now() },
          };
        }
      }
    }
  } catch (error) {
    yield {
      event: 'error',
      data: {
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
    };
  }

  yield {
    event: 'graph:end',
    data: { graphName: graphName ?? 'unknown', runId: runId ?? null, timestamp: Date.now() },
  };
}

/**
 * Convert the SSE async generator into a ReadableStream for direct use
 * with web-standard streaming responses.
 */
export function sseToReadableStream(
  sseGenerator: AsyncGenerator<SSEEvent>,
): ReadableStream<string> {
  return new ReadableStream<string>({
    async pull(controller) {
      const { value, done } = await sseGenerator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(formatSSE(value));
    },
  });
}

