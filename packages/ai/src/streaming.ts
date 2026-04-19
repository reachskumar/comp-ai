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
  | 'tool:start'
  | 'tool:end'
  | 'action:confirm'
  | 'graph:end'
  | 'conversation:id'
  | 'progress:start'
  | 'progress:step'
  | 'progress:result'
  | 'progress:error'
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

  /** Action tool names that emit confirmation events */
  const ACTION_TOOLS = new Set([
    'approve_recommendation',
    'reject_recommendation',
    'request_letter',
  ]);

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
      } else if (eventType === 'on_chat_model_stream' || eventType === 'on_llm_stream') {
        const chunk = event.data?.chunk;
        let content = typeof chunk === 'string' ? chunk : (chunk?.content ?? chunk?.text ?? '');
        // Claude returns content as array of blocks: [{type:"text", text:"..."}]
        if (Array.isArray(content)) {
          content = content
            .filter((b: Record<string, unknown>) => b.type === 'text' || typeof b === 'string')
            .map((b: Record<string, unknown>) => (typeof b === 'string' ? b : (b.text ?? '')))
            .join('');
        }
        if (typeof content !== 'string') content = '';
        if (content) {
          yield {
            event: 'message:chunk',
            data: { content, timestamp: Date.now() },
          };
        }
      } else if (eventType === 'on_tool_start') {
        const toolName = event.name ?? 'unknown';
        yield {
          event: 'tool:start',
          data: {
            tool: toolName,
            isAction: ACTION_TOOLS.has(toolName),
            timestamp: Date.now(),
          },
        };
      } else if (eventType === 'on_tool_end') {
        const toolName = event.name ?? 'unknown';
        const output = event.data?.output;
        const isAction = ACTION_TOOLS.has(toolName);

        yield {
          event: 'tool:end',
          data: {
            tool: toolName,
            isAction,
            timestamp: Date.now(),
          },
        };

        // Emit action confirmation for write actions
        if (isAction && output) {
          const result = typeof output === 'string' ? JSON.parse(output) : output;
          if (result?.success) {
            yield {
              event: 'action:confirm',
              data: {
                tool: toolName,
                message: result.message ?? `Action ${toolName} completed`,
                result: result,
                timestamp: Date.now(),
              },
            };
          }
        }
      }
    }
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : 'Unknown error';
    // Detect Azure OpenAI / OpenAI rate limit errors and return a
    // human-readable message instead of a raw stack trace URL.
    const is429 =
      rawMsg.includes('429') ||
      rawMsg.includes('Rate limit') ||
      rawMsg.includes('Too Many Requests') ||
      rawMsg.includes('MODEL_RATE_LIMIT');
    const userMessage = is429
      ? 'The AI service is temporarily busy. Please wait a moment and try again.'
      : rawMsg;
    yield {
      event: 'error',
      data: {
        message: userMessage,
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
