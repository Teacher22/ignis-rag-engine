// ─── Core Domain Types ────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: string;
}

export interface Namespace {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string;
  schemaConfig?: NamespaceSchemaConfig | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NamespaceSchemaConfig {
  allowed_types?: string[];
  required_metadata?: string[];
  max_file_size_mb?: number;
  custom_rules?: Array<{ field: string; type: string; required?: boolean }>;
}

export interface Document {
  id: string;
  tenantId: string;
  namespaceId: string;
  filename: string;
  s3Key: string;
  status: 'pending' | 'processing' | 'indexed' | 'failed';
  chunkCount?: number | null;
  error?: string | null;
  createdAt: string;
}

export interface IngestionJob {
  id: string;
  documentId: string;
  bullmqJobId?: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  createdAt: string;
}

// ─── Query Types ──────────────────────────────────────────────────────────────

export interface QueryRequest {
  query: string;
  namespaceIds?: string[];
  topKNamespaces?: number;
  topNChunks?: number;
  rerankTopK?: number;
  stream?: boolean;
}

export interface Citation {
  sourceId: number;
  namespaceSlug: string;
  sourceFile: string;
  page?: number | null;
  chunkIndex: number;
  chunkText: string;
  documentId: string;
  namespaceId: string;
  tenantId: string;
  /** Reranker relevance score 0–1 (higher = more relevant) */
  score?: number;
}

export interface QueryResponse {
  answer: string;
  citations: Citation[];
  namespacesSelected: string[];
  chunksRetrieved: number;
  chunksAfterRerank: number;
  totalTokens?: number;
  durationMs: number;
  /** Mean reranker score across all returned citations (0–1) */
  overallConfidence?: number;
}

// ─── SSE Event Types ──────────────────────────────────────────────────────────

export type SSEEvent =
  | { type: 'token'; token: string }
  | { type: 'done'; citations: Citation[] }
  | { type: 'error'; message: string };

// ─── API Request / Response Bodies ───────────────────────────────────────────

export interface CreateTenantBody {
  name: string;
  plan?: 'free' | 'pro' | 'enterprise';
}

export interface CreateTenantResponse {
  tenant: Tenant;
  apiKey: string; // returned only once at creation
}

export interface CreateNamespaceBody {
  name: string;
  slug: string;
  description: string;
  schemaConfig?: NamespaceSchemaConfig;
}

export interface UpdateNamespaceBody {
  name?: string;
  description?: string;
  schemaConfig?: NamespaceSchemaConfig;
  active?: boolean;
}

export interface UploadDocumentResponse {
  document: Document;
  jobId: string;
}

export interface JobStatusResponse {
  jobId: string;
  documentId: string;
  status: IngestionJob['status'];
  attempts: number;
  document: Document;
}

// ─── MCP Types ────────────────────────────────────────────────────────────────

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; default?: unknown }>;
    required: string[];
  };
}

export interface MCPToolCallInput {
  query: string;
  top_k?: number;
}

export interface MCPToolCallResult {
  answer: string;
  citations: Citation[];
}

// ─── Observability Types ──────────────────────────────────────────────────────

export interface QueryPipelineLog {
  event: 'query_pipeline_complete';
  tenantId: string;
  requestId: string;
  namespacesSelected: string[];
  nsRoutingScores: number[];
  chunksRetrieved: number;
  chunksAfterRerank: number;
  contextTokens: number;
  ttftMs: number;
  totalTokens: number;
  durationMs: number;
}

export interface IngestionPipelineLog {
  event: 'ingestion_complete' | 'ingestion_failed';
  tenantId: string;
  documentId: string;
  namespaceId: string;
  chunkCount?: number;
  durationMs: number;
  error?: string;
}
