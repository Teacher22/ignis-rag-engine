import { env } from '../config/env';

export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = 3072;

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

async function callEmbedAPI(text: string): Promise<number[]> {
  const url = `${BASE_URL}/${EMBEDDING_MODEL}:embedContent?key=${env.GOOGLE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values;
}

export async function embedText(text: string): Promise<number[]> {
  return callEmbedAPI(text);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // gemini-embedding-2 only supports embedContent (not batchEmbedContents)
  // Run in parallel with a concurrency limit to avoid rate limits
  const CONCURRENCY = 10;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const batch = texts.slice(i, i + CONCURRENCY);
    const embeddings = await Promise.all(batch.map(callEmbedAPI));
    results.push(...embeddings);
  }

  return results;
}
