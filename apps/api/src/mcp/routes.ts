import { FastifyInstance } from 'fastify';
import { getDb } from '../lib/db';
import { validateApiKey } from '../middleware/auth';
import { generateToolManifest } from './registry';
import { runQueryPipeline } from '../pipelines/query.pipeline';
import { logger } from '../middleware/logger';
import { mcpToolCallTotal } from '../observability/metrics';

export async function mcpRoutes(app: FastifyInstance) {
  // ── MCP SSE connection: advertise tools ─────────────────────────────────────
  app.get('/mcp', async (request, reply) => {
    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    const tenant = await validateApiKey(apiKey);
    if (!tenant) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    const tools = await generateToolManifest(tenant.id);

    // SSE transport per MCP spec
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    const manifest = {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ignis-rag-engine', version: '1.0.0' },
      tools,
    };

    reply.raw.write(`data: ${JSON.stringify({ type: 'initialize', ...manifest })}\n\n`);

    // Keep-alive ping every 30 seconds
    const ping = setInterval(() => {
      if (reply.raw.destroyed) {
        clearInterval(ping);
        return;
      }
      reply.raw.write(': ping\n\n');
    }, 30000);

    reply.raw.on('close', () => clearInterval(ping));
  });

  // ── MCP tool call ────────────────────────────────────────────────────────────
  app.post('/mcp/tools/:toolName/call', async (request, reply) => {
    const { toolName } = request.params as { toolName: string };
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      return reply.code(401).send({ error: 'x-api-key header required' });
    }

    // Level 1: validate API key
    const tenant = await validateApiKey(apiKey);
    if (!tenant) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    // Tool name format: query__<namespace-slug>
    if (!toolName.startsWith('query__')) {
      return reply.code(400).send({ error: 'Unknown tool' });
    }
    const namespaceSlug = toolName.slice('query__'.length);

    // Level 2: confirm namespace belongs to this tenant
    const db = getDb();
    const nsResult = await db.query(
      'SELECT id FROM namespaces WHERE slug = $1 AND tenant_id = $2 AND active = true',
      [namespaceSlug, tenant.id]
    );
    if (!nsResult.rows[0]) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = request.body as { query: string; top_k?: number };
    if (!body?.query) {
      return reply.code(400).send({ error: 'query is required' });
    }

    const topK = body.top_k ?? 5;

    // Run query pipeline scoped to this namespace
    const pipeline = await runQueryPipeline({
      tenantId: tenant.id,
      query: body.query,
      namespaceIds: [nsResult.rows[0].id],
      topKNamespaces: 1,
      topNChunks: topK * 3,
      rerankTopK: topK,
    });

    mcpToolCallTotal.inc({ tenant_id: tenant.id, tool: toolName });

    logger.info(
      { event: 'mcp_tool_call', tenantId: tenant.id, tool: toolName, chunksUsed: pipeline.chunksAfterRerank },
      'MCP tool call complete'
    );

    // Return raw context chunks — the calling LLM generates the answer.
    // Never run a second LLM here; that defeats the purpose of MCP.
    const contextText = pipeline.citations
      .map((c) =>
        [
          `[SOURCE ${c.sourceId}] ${c.sourceFile}${c.page ? ` p.${c.page}` : ''}`,
          `Namespace: ${c.namespaceSlug}`,
          c.chunkText,
        ].join('\n')
      )
      .join('\n\n---\n\n');

    return reply.send({
      content: [
        {
          type: 'text',
          text: contextText || 'No relevant content found in this namespace.',
        },
      ],
      citations: pipeline.citations,
      overallConfidence: pipeline.overallConfidence,
      isError: false,
    });
  });

  // ── List available tools (convenience endpoint) ───────────────────────────
  app.get('/mcp/tools', async (request, reply) => {
    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey) return reply.code(401).send({ error: 'x-api-key required' });
    const tenant = await validateApiKey(apiKey);
    if (!tenant) return reply.code(401).send({ error: 'Invalid API key' });
    const tools = await generateToolManifest(tenant.id);
    return { tools };
  });
}
