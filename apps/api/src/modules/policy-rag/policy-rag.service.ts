import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  buildPolicyRagGraph,
  streamGraphToSSE,
  type PolicyRagDbAdapter,
  type SSEEvent,
} from '@compensation/ai';
import { HumanMessage } from '@langchain/core/messages';
import { OpenAIEmbeddings } from '@langchain/openai';

const CHUNK_SIZE = 500; // ~500 tokens target
const CHUNK_OVERLAP = 50; // ~50 token overlap
const EMBEDDING_DIMENSIONS = 1536;

@Injectable()
export class PolicyRagService implements PolicyRagDbAdapter {
  private readonly logger = new Logger(PolicyRagService.name);
  private embeddings: OpenAIEmbeddings | null = null;

  constructor(private readonly db: DatabaseService) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (apiKey) {
      this.embeddings = new OpenAIEmbeddings({
        openAIApiKey: apiKey,
        modelName: 'text-embedding-3-small',
        dimensions: EMBEDDING_DIMENSIONS,
      });
    }
  }

  // ─── Embedding ──────────────────────────────────────────

  async embedText(text: string): Promise<number[]> {
    if (!this.embeddings) {
      // Return zero vector as fallback when no API key
      return new Array(EMBEDDING_DIMENSIONS).fill(0) as number[];
    }
    return this.embeddings.embedQuery(text);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.embeddings || texts.length === 0) {
      return texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0) as number[]);
    }
    return this.embeddings.embedDocuments(texts);
  }

  // ─── Text Chunking ─────────────────────────────────────

  chunkText(text: string): string[] {
    // Split on paragraph boundaries first
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      // Estimate tokens (~4 chars per token)
      const currentTokens = Math.ceil(currentChunk.length / 4);
      const paraTokens = Math.ceil(trimmed.length / 4);

      if (currentTokens + paraTokens > CHUNK_SIZE && currentChunk) {
        chunks.push(currentChunk.trim());
        // Keep overlap from end of previous chunk
        const overlapChars = CHUNK_OVERLAP * 4;
        const overlap = currentChunk.slice(-overlapChars);
        currentChunk = overlap + '\n\n' + trimmed;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + trimmed : trimmed;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // If no paragraph breaks, split on sentences
    if (chunks.length === 0 && text.trim()) {
      chunks.push(text.trim());
    }

    return chunks;
  }

  // ─── Document Upload & Processing ──────────────────────

  async uploadDocument(
    tenantId: string,
    userId: string,
    title: string,
    fileName: string,
    content: string,
    mimeType: string,
  ) {
    const doc = await this.db.client.policyDocument.create({
      data: {
        tenantId,
        title,
        fileName,
        filePath: `uploads/policies/${tenantId}/${fileName}`,
        fileSize: Buffer.byteLength(content, 'utf-8'),
        mimeType,
        status: 'PROCESSING',
        uploadedBy: userId,
      },
    });

    // Process in background (but await for simplicity in MVP)
    try {
      await this.processDocument(doc.id, tenantId, content);
    } catch (error) {
      this.logger.error(`Failed to process document ${doc.id}`, error);
      await this.db.client.policyDocument.update({
        where: { id: doc.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Processing failed',
        },
      });
    }

    return this.db.client.policyDocument.findUnique({ where: { id: doc.id } });
  }

  private async processDocument(documentId: string, tenantId: string, content: string) {
    const chunks = this.chunkText(content);
    this.logger.log(`Document ${documentId}: ${chunks.length} chunks`);

    // Embed all chunks
    const embeddings = await this.embedTexts(chunks);

    // Store chunks with embeddings
    await this.db.client.policyChunk.createMany({
      data: chunks.map((chunkContent, index) => ({
        documentId,
        tenantId,
        chunkIndex: index,
        content: chunkContent,
        embedding: embeddings[index] as unknown as any,
        metadata: { chunkIndex: index, totalChunks: chunks.length },
      })),
    });

    await this.db.client.policyDocument.update({
      where: { id: documentId },
      data: { status: 'READY', chunkCount: chunks.length },
    });
  }

  // ─── CRUD ──────────────────────────────────────────────

  async listDocuments(tenantId: string, filters: { status?: string }) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.status) where['status'] = filters.status;

    const docs = await this.db.client.policyDocument.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
    });
    return { data: docs, total: docs.length };
  }

  async deleteDocument(tenantId: string, id: string) {
    const doc = await this.db.client.policyDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Policy document not found');

    // Cascade deletes chunks via Prisma relation
    await this.db.client.policyDocument.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── PolicyRagDbAdapter Implementation ─────────────────

  async searchPolicyChunks(tenantId: string, queryEmbedding: number[], topK: number) {
    // Fetch all chunks for this tenant (in-memory cosine similarity)
    const chunks = await this.db.client.policyChunk.findMany({
      where: { tenantId },
      include: { document: { select: { title: true } } },
    });

    // Compute cosine similarity
    const scored = chunks.map((chunk) => {
      const embedding = chunk.embedding as number[];
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return {
        id: chunk.id,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        similarity,
        documentId: chunk.documentId,
        documentTitle: chunk.document.title,
        metadata: chunk.metadata as Record<string, unknown>,
      };
    });

    // Sort by similarity descending, take top K
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }

  async listPolicyDocuments(tenantId: string, filters: { status?: string; limit?: number }) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.status) where['status'] = filters.status;

    const docs = await this.db.client.policyDocument.findMany({
      where: where as any,
      take: filters.limit ?? 20,
      orderBy: { createdAt: 'desc' },
    });

    return docs.map((d) => ({
      id: d.id,
      title: d.title,
      fileName: d.fileName,
      status: d.status,
      chunkCount: d.chunkCount,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  // ─── Graph Invocation ──────────────────────────────────

  async *streamAsk(
    tenantId: string,
    userId: string,
    question: string,
    conversationId?: string,
  ): AsyncGenerator<SSEEvent> {
    this.logger.log(
      `Policy RAG ask: tenant=${tenantId} user=${userId} conv=${conversationId ?? 'new'}`,
    );

    const embedFn = (text: string) => this.embedText(text);
    const { graph } = await buildPolicyRagGraph(this, embedFn, tenantId);

    const config = conversationId
      ? { configurable: { thread_id: conversationId } }
      : { configurable: { thread_id: `policy-rag-${tenantId}-${userId}-${Date.now()}` } };

    const stream = graph.streamEvents(
      {
        tenantId,
        userId,
        messages: [new HumanMessage(question)],
        metadata: {},
      },
      { ...config, version: 'v2' },
    );

    yield* streamGraphToSSE(stream, {
      graphName: 'policy-rag-graph',
      runId: config.configurable.thread_id,
    });
  }

  // ─── Utility ───────────────────────────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
