import {
  register,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import { FastifyInstance } from 'fastify';

collectDefaultMetrics({ register });

// ─── Ingestion metrics ────────────────────────────────────────────────────────

export const ingestionJobStarted = new Counter({
  name: 'ignis_ingestion_jobs_started_total',
  help: 'Total ingestion jobs enqueued',
  labelNames: ['tenant_id', 'namespace_id'],
});

export const ingestionJobFailed = new Counter({
  name: 'ignis_ingestion_jobs_failed_total',
  help: 'Total ingestion jobs that failed permanently',
  labelNames: ['tenant_id'],
});

export const ingestionDuration = new Histogram({
  name: 'ignis_ingestion_duration_seconds',
  help: 'Ingestion job duration in seconds',
  labelNames: ['tenant_id'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
});

export const ingestionChunksTotal = new Counter({
  name: 'ignis_ingestion_chunks_total',
  help: 'Total chunks produced by ingestion',
  labelNames: ['tenant_id'],
});

export const schemaRejectCounter = new Counter({
  name: 'ignis_schema_rejects_total',
  help: 'Documents rejected by namespace schema validation',
  labelNames: ['tenant_id', 'namespace_id'],
});

// ─── Query pipeline metrics ───────────────────────────────────────────────────

export const queryDuration = new Histogram({
  name: 'ignis_query_duration_seconds',
  help: 'End-to-end query duration in seconds',
  labelNames: ['tenant_id'],
  buckets: [0.1, 0.5, 1, 2, 3, 5, 10],
});

export const ttftHistogram = new Histogram({
  name: 'ignis_query_ttft_seconds',
  help: 'Time to first token in seconds',
  labelNames: ['tenant_id'],
  buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 3],
});

export const queryChunksRetrieved = new Histogram({
  name: 'ignis_query_chunks_retrieved',
  help: 'Chunks retrieved before reranking',
  labelNames: ['tenant_id'],
  buckets: [0, 5, 10, 20, 30, 50],
});

export const queryChunksAfterRerank = new Histogram({
  name: 'ignis_query_chunks_after_rerank',
  help: 'Chunks remaining after reranking',
  labelNames: ['tenant_id'],
  buckets: [0, 1, 3, 5, 10],
});

// ─── MCP metrics ──────────────────────────────────────────────────────────────

export const mcpToolCallTotal = new Counter({
  name: 'ignis_mcp_tool_calls_total',
  help: 'Total MCP tool calls',
  labelNames: ['tenant_id', 'tool'],
});

// ─── Metrics endpoint ─────────────────────────────────────────────────────────

export async function metricsRoute(app: FastifyInstance) {
  app.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
}
