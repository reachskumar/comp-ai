/**
 * Tool base utilities — helpers for creating typed LangGraph tools.
 */

import { tool } from '@langchain/core/tools';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { z } from 'zod';

/**
 * Options for creating a domain tool.
 */
export interface DomainToolOptions<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput,
> {
  /** Unique tool name (used by LLM for tool calling) */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Zod schema for input validation */
  schema: TInput;
  /** The service function to execute when the tool is called */
  func: (input: z.infer<TInput>) => Promise<TOutput>;
}

/**
 * Factory to create a typed LangGraph tool that wraps a domain service function.
 *
 * This standardises tool creation across all graphs, ensuring:
 * - Input is validated via Zod schema
 * - Output is serialized to string for LLM consumption
 * - Consistent naming and description patterns
 *
 * @example
 * ```ts
 * import { z } from 'zod';
 * import { createDomainTool } from '@compensation/ai';
 *
 * const lookupEmployee = createDomainTool({
 *   name: 'lookup_employee',
 *   description: 'Look up employee compensation data by ID',
 *   schema: z.object({ employeeId: z.string() }),
 *   func: async ({ employeeId }) => {
 *     return await employeeService.findById(employeeId);
 *   },
 * });
 * ```
 */
export function createDomainTool<
  TInput extends z.ZodObject<z.ZodRawShape>,
  TOutput,
>(
  options: DomainToolOptions<TInput, TOutput>,
): DynamicStructuredTool<TInput> {
  return tool(
    async (input: z.infer<TInput>): Promise<string> => {
      const result = await options.func(input);
      return JSON.stringify(result);
    },
    {
      name: options.name,
      description: options.description,
      schema: options.schema,
    },
  ) as DynamicStructuredTool<TInput>;
}

