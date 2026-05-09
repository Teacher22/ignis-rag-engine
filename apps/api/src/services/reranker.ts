import { getCohere } from '../lib/cohere';
import { env } from '../config/env';
import { logger } from '../middleware/logger';

export interface RerankResult {
  index: number;
  relevanceScore: number;
}

export async function rerankDocuments(
  query: string,
  documents: string[],
  topN: number
): Promise<RerankResult[]> {
  // Prefer Cohere when API key is configured
  if (env.COHERE_API_KEY) {
    return rerankWithCohere(query, documents, topN);
  }
  return rerankWithSidecar(query, documents, topN);
}

async function rerankWithCohere(
  query: string,
  documents: string[],
  topN: number
): Promise<RerankResult[]> {
  const cohere = getCohere();
  const response = await cohere.rerank({
    model: 'rerank-v3.5',
    query,
    documents,
    topN,
  });

  return response.results.map((r) => ({
    index: r.index,
    relevanceScore: r.relevanceScore,
  }));
}

async function rerankWithSidecar(
  query: string,
  documents: string[],
  topN: number
): Promise<RerankResult[]> {
  try {
    const response = await fetch(`${env.RERANKER_URL}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents, top_n: topN }),
    });

    if (!response.ok) {
      throw new Error(`Reranker returned ${response.status}`);
    }

    const data = (await response.json()) as { results: RerankResult[] };
    return data.results;
  } catch (err) {
    logger.warn({ err }, 'Reranker sidecar failed, returning original order');
    // Fallback: return documents in original order with placeholder scores
    return documents.slice(0, topN).map((_, i) => ({ index: i, relevanceScore: 1 - i * 0.1 }));
  }
}
