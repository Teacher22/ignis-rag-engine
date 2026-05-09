import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env';

export const COLLECTION_NAME = 'ignis_chunks';
export const VECTOR_SIZE = 768; // text-embedding-004

let client: QdrantClient | null = null;

export function getQdrant(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: env.QDRANT_URL });
  }
  return client;
}

export interface ChunkPayload {
  tenant_id: string;
  namespace_id: string;
  namespace_slug: string;
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  page: number | null;
  token_count: number;
  source_file: string;
}
