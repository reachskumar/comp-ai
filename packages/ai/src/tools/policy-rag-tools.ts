/**
 * Policy RAG tools — LangGraph tools for searching and listing policy documents.
 *
 * Each tool receives a tenantId injected at graph construction time
 * to enforce multi-tenant isolation.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Database adapter for policy RAG operations.
 * Decouples tools from Prisma so the AI package stays DB-agnostic.
 */
export interface PolicyRagDbAdapter {
  searchPolicyChunks(
    tenantId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<
    Array<{
      id: string;
      content: string;
      chunkIndex: number;
      similarity: number;
      documentId: string;
      documentTitle: string;
      metadata: Record<string, unknown>;
    }>
  >;

  listPolicyDocuments(
    tenantId: string,
    filters: { status?: string; limit?: number },
  ): Promise<
    Array<{
      id: string;
      title: string;
      fileName: string;
      status: string;
      chunkCount: number;
      createdAt: string;
    }>
  >;
}

/**
 * Embedding function type — injected so tools can embed queries.
 */
export type EmbedFunction = (text: string) => Promise<number[]>;

/**
 * Create all policy RAG tools bound to a specific tenant.
 */
export function createPolicyRagTools(
  tenantId: string,
  db: PolicyRagDbAdapter,
  embedFn: EmbedFunction,
): StructuredToolInterface[] {
  const searchPolicies = createDomainTool({
    name: 'search_policies',
    description:
      'Search company policy documents using semantic search. Returns the most relevant policy chunks with similarity scores. Use this to find specific policy information to answer questions.',
    schema: z.object({
      query: z.string().describe('The search query — what policy information to find'),
      topK: z
        .number()
        .optional()
        .default(5)
        .describe('Number of top results to return (default 5)'),
    }),
    func: async (input) => {
      const queryEmbedding = await embedFn(input.query);
      return db.searchPolicyChunks(tenantId, queryEmbedding, input.topK);
    },
  });

  const listPolicies = createDomainTool({
    name: 'list_policies',
    description:
      'List all uploaded policy documents for this tenant. Returns document titles, status, and chunk counts.',
    schema: z.object({
      status: z
        .string()
        .optional()
        .describe('Filter by status: UPLOADING, PROCESSING, READY, FAILED'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    }),
    func: async (input) => db.listPolicyDocuments(tenantId, input),
  });

  return [searchPolicies, listPolicies] as StructuredToolInterface[];
}
