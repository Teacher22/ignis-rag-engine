import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLLM } from '../lib/llm';
import { requireTenantAccess } from '../middleware/auth';
import { runQueryPipeline, buildSystemPrompt } from '../pipelines/query.pipeline';
import { logger } from '../middleware/logger';
import {
  queryDuration,
  ttftHistogram,
  queryChunksRetrieved,
  queryChunksAfterRerank,
} from '../observability/metrics';

const QuerySchema = z.object({
  query: z.string().min(1).max(4000),
  namespaceIds: z.array(z.string().uuid()).optional(),
  topKNamespaces: z.number().int().min(1).max(10).default(3),
  topNChunks: z.number().int().min(1).max(50).default(15),
  rerankTopK: z.number().int().min(1).max(20).default(5),
  stream: z.boolean().default(true),
});

export async function queryRoutes(app: FastifyInstance) {
  app.post(
    '/api/v1/tenants/:tenantId/query',
    { preHandler: requireTenantAccess },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const requestId = request.id;
      const body = QuerySchema.parse(request.body);
      const start = Date.now();

      // Run retrieval pipeline
      const pipeline = await runQueryPipeline({
        tenantId,
        query: body.query,
        namespaceIds: body.namespaceIds,
        topKNamespaces: body.topKNamespaces,
        topNChunks: body.topNChunks,
        rerankTopK: body.rerankTopK,
      });

      queryChunksRetrieved.observe({ tenant_id: tenantId }, pipeline.chunksRetrieved);
      queryChunksAfterRerank.observe({ tenant_id: tenantId }, pipeline.chunksAfterRerank);

      const model = getLLM();
      const systemPrompt = buildSystemPrompt(pipeline.context);

      if (body.stream) {
        // ── SSE streaming ────────────────────────────────────────────────────
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');

        let firstTokenTime: number | null = null;
        let totalTokens = 0;

        const result = await model.generateContentStream({
          systemInstruction: systemPrompt,
          contents: [{ role: 'user', parts: [{ text: body.query }] }],
        });

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (!text) continue;

          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
            ttftHistogram.observe({ tenant_id: tenantId }, (firstTokenTime - start) / 1000);
          }

          reply.raw.write(`data: ${JSON.stringify({ token: text })}\n\n`);
        }

        const finalResponse = await result.response;
        totalTokens = finalResponse.usageMetadata?.totalTokenCount ?? 0;

        const duration = Date.now() - start;
        queryDuration.observe({ tenant_id: tenantId }, duration / 1000);

        logger.info({
          event: 'query_pipeline_complete',
          tenant_id: tenantId,
          request_id: requestId,
          namespaces_selected: pipeline.namespacesSelected,
          ns_routing_scores: pipeline.nsRoutingScores,
          chunks_retrieved: pipeline.chunksRetrieved,
          chunks_after_rerank: pipeline.chunksAfterRerank,
          context_tokens: pipeline.contextTokens,
          ttft_ms: firstTokenTime ? firstTokenTime - start : null,
          total_tokens: totalTokens,
          duration_ms: duration,
        });

        reply.raw.write(
          `data: ${JSON.stringify({ done: true, citations: pipeline.citations })}\n\n`
        );
        reply.raw.end();
      } else {
        // ── Non-streaming ────────────────────────────────────────────────────
        const result = await model.generateContent({
          systemInstruction: systemPrompt,
          contents: [{ role: 'user', parts: [{ text: body.query }] }],
        });

        const answer = result.response.text();
        const totalTokens = result.response.usageMetadata?.totalTokenCount ?? 0;
        const duration = Date.now() - start;
        queryDuration.observe({ tenant_id: tenantId }, duration / 1000);

        return {
          answer,
          citations: pipeline.citations,
          namespacesSelected: pipeline.namespacesSelected,
          chunksRetrieved: pipeline.chunksRetrieved,
          chunksAfterRerank: pipeline.chunksAfterRerank,
          totalTokens,
          durationMs: duration,
        };
      }
    }
  );
}
