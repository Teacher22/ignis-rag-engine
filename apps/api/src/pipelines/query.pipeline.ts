import { getDb } from '../lib/db';
import { getQdrant, COLLECTION_NAME, ChunkPayload } from '../lib/qdrant';
import { embedText } from '../lib/embeddings';
import { cosineSimilarity } from '../services/cosine';
import { rerankDocuments } from '../services/reranker';
import { env } from '../config/env';
import { Citation } from '@ignis/shared';
import { encode } from 'tiktoken';

// ─── Token utilities ──────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  const enc = encode(text);
  const n = enc.length;
  if (typeof (enc as unknown as { free?: () => void }).free === 'function') {
    (enc as unknown as { free: () => void }).free();
  }
  return n;
}

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(context: string): string {
  return `You are a precise knowledge assistant with access to verified source documents.
Answer ONLY based on the provided sources below.
If the answer is not in the sources, explicitly say: "I could not find this in the available documents."
Do not infer, extrapolate, or use prior knowledge beyond what is stated.
When citing information, reference the source number e.g. [SOURCE 1].

KNOWLEDGE SOURCES:
${context}`;
}

// ─── Context builder ──────────────────────────────────────────────────────────

const MODEL_CONTEXT_LIMIT = 200000;
const OUTPUT_RESERVE = 4000;

interface ContextResult {
  context: string;
  citations: Citation[];
  tokenCount: number;
}

export function buildContext(
  chunks: Array<{ payload: ChunkPayload; score?: number }>,
  systemPromptTokens: number,
  queryTokens: number
): ContextResult {
  const totalBudget = MODEL_CONTEXT_LIMIT - systemPromptTokens - queryTokens - OUTPUT_RESERVE;
  const chunkBudget = Math.floor(totalBudget * 0.75);

  let context = '';
  let tokenCount = 0;
  const citations: Citation[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const p = chunk.payload;
    const chunkTokens = estimateTokens(p.chunk_text);
    if (tokenCount + chunkTokens > chunkBudget) break;

    const sourceBlock = [
      `[SOURCE ${i + 1}]`,
      `Namespace: ${p.namespace_slug}`,
      `Document: ${p.source_file}`,
      p.page ? `Page: ${p.page}` : '',
      '---',
      p.chunk_text,
      '',
    ]
      .filter(Boolean)
      .join('\n');

    context += sourceBlock;
    tokenCount += chunkTokens;
    citations.push({
      sourceId: i + 1,
      namespaceSlug: p.namespace_slug,
      sourceFile: p.source_file,
      page: p.page,
      chunkIndex: p.chunk_index,
      chunkText: p.chunk_text,
      documentId: p.document_id,
      namespaceId: p.namespace_id,
      tenantId: p.tenant_id,
    });
  }

  return { context, citations, tokenCount };
}

// ─── Deduplication ────────────────────────────────────────────────────────────

export function deduplicateChunks<T extends { vector: number[] }>(
  chunks: T[],
  threshold = 0.92
): T[] {
  const kept: T[] = [];
  for (const chunk of chunks) {
    const isDup = kept.some((k) => cosineSimilarity(k.vector, chunk.vector) > threshold);
    if (!isDup) kept.push(chunk);
  }
  return kept;
}

// ─── Pipeline types ───────────────────────────────────────────────────────────

export interface QueryPipelineResult {
  context: string;
  citations: Citation[];
  namespacesSelected: string[];
  nsRoutingScores: number[];
  chunksRetrieved: number;
  chunksAfterRerank: number;
  contextTokens: number;
  queryVector: number[];
}

export interface QueryPipelineOptions {
  tenantId: string;
  query: string;
  namespaceIds?: string[];
  topKNamespaces: number;
  topNChunks: number;
  rerankTopK: number;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runQueryPipeline(
  opts: QueryPipelineOptions
): Promise<QueryPipelineResult> {
  const { tenantId, query, namespaceIds, topKNamespaces, topNChunks, rerankTopK } = opts;
  const db = getDb();
  const qdrant = getQdrant();

  // Step 1: Embed query
  const queryVector = await embedText(query);

  // Step 2: Namespace routing
  let targetNamespaces: Array<{ id: string; slug: string; score: number }>;

  if (namespaceIds?.length) {
    // Caller explicitly chose namespaces — skip routing
    const result = await db.query(
      `SELECT id, slug FROM namespaces WHERE id = ANY($1) AND tenant_id = $2 AND active = true`,
      [namespaceIds, tenantId]
    );
    targetNamespaces = result.rows.map((r) => ({ id: r.id, slug: r.slug, score: 1 }));
  } else {
    // Cosine similarity against description embeddings
    const result = await db.query(
      `SELECT id, slug, description_embedding::text AS embedding_text
       FROM namespaces
       WHERE tenant_id = $1 AND active = true AND description_embedding IS NOT NULL`,
      [tenantId]
    );

    const scored = result.rows.map((ns) => {
      const vec: number[] = JSON.parse(ns.embedding_text);
      return { id: ns.id, slug: ns.slug, score: cosineSimilarity(queryVector, vec) };
    });

    targetNamespaces = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topKNamespaces)
      .filter((ns) => ns.score > env.NS_ROUTING_THRESHOLD);
  }

  // Step 3: Parallel chunk retrieval per namespace
  const chunkResultsPerNS = await Promise.all(
    targetNamespaces.map((ns) =>
      qdrant.search(COLLECTION_NAME, {
        vector: queryVector,
        limit: topNChunks,
        filter: {
          must: [
            { key: 'tenant_id', match: { value: tenantId } },
            { key: 'namespace_id', match: { value: ns.id } },
          ],
        },
        with_payload: true,
        with_vector: true,
      })
    )
  );

  const allChunks = chunkResultsPerNS
    .flat()
    .map((r) => ({
      payload: r.payload as ChunkPayload,
      vector: r.vector as number[],
      score: r.score,
    }));

  // Step 4: Rerank
  let finalChunks: typeof allChunks = [];
  if (allChunks.length > 0) {
    const reranked = await rerankDocuments(
      query,
      allChunks.map((c) => c.payload.chunk_text),
      rerankTopK
    );

    finalChunks = reranked
      .filter((r) => r.relevanceScore > env.RERANK_THRESHOLD)
      .map((r) => allChunks[r.index]);
  }

  // Step 5: Deduplication
  const deduplicated = deduplicateChunks(finalChunks);

  // Step 6: Context builder
  const systemPromptTokens = estimateTokens(buildSystemPrompt(''));
  const queryTokens = estimateTokens(query);
  const { context, citations, tokenCount } = buildContext(
    deduplicated,
    systemPromptTokens,
    queryTokens
  );

  return {
    context,
    citations,
    namespacesSelected: targetNamespaces.map((n) => n.slug),
    nsRoutingScores: targetNamespaces.map((n) => n.score),
    chunksRetrieved: allChunks.length,
    chunksAfterRerank: deduplicated.length,
    contextTokens: tokenCount,
    queryVector,
  };
}
