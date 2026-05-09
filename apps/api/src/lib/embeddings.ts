import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

export const EMBEDDING_MODEL = 'text-embedding-004';
export const EMBEDDING_DIMENSIONS = 768;

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
  }
  return genAI;
}

export async function embedText(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = getGenAI().getGenerativeModel({ model: EMBEDDING_MODEL });

  // Google's batchEmbedContents accepts up to 100 requests at once
  const BATCH_LIMIT = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
    const slice = texts.slice(i, i + BATCH_LIMIT);
    const response = await model.batchEmbedContents({
      requests: slice.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { role: 'user', parts: [{ text }] },
      })),
    });
    results.push(...response.embeddings.map((e) => e.values));
  }

  return results;
}
