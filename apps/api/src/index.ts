import Fastify from 'fastify';
import fastifyJWT from '@fastify/jwt';
import fastifyCORS from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';

import { env } from './config/env';
import { logger } from './middleware/logger';
import { tenantRoutes } from './routes/tenants';
import { namespaceRoutes } from './routes/namespaces';
import { documentRoutes } from './routes/documents';
import { queryRoutes } from './routes/query';
import { mcpRoutes } from './mcp/routes';
import { metricsRoute } from './observability/metrics';
import { setupTracing } from './observability/tracing';

setupTracing();

const app = Fastify({
  logger,
  trustProxy: true,
  requestIdHeader: 'x-request-id',
});

async function bootstrap() {
  // ── OpenAPI / Swagger ────────────────────────────────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Ignis RAG Engine API',
        description:
          'Multi-tenant Retrieval-Augmented Generation (RAG) as a Service. ' +
          'Upload documents, manage namespaces, and run semantic queries powered by ' +
          'Gemini embeddings and Gemini 2.0 Flash.',
        version: '1.0.0',
        contact: { name: 'Ignis Platform' },
      },
      servers: [
        { url: 'http://localhost:3001', description: 'Local development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT issued by POST /api/v1/auth/login',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Login and JWT management' },
        { name: 'Tenants', description: 'Tenant management' },
        { name: 'Namespaces', description: 'Namespace (knowledge base) management' },
        { name: 'Documents', description: 'Document upload, listing, retry, and re-indexing' },
        { name: 'Query', description: 'Semantic RAG query with streaming support' },
        { name: 'Jobs', description: 'Ingestion job status' },
        { name: 'Health', description: 'Health and metrics' },
      ],
    },
  });

  await app.register(fastifySwaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      tryItOutEnabled: true,
    },
    staticCSP: true,
    transformSpecificationClone: true,
  });

  await app.register(fastifyCORS, {
    origin: env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  });

  await app.register(fastifyJWT, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRY },
  });

  await app.register(fastifyRateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) =>
      (req.headers['x-tenant-id'] as string) ?? req.ip,
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100 MB hard cap
      files: 1,
    },
  });

  // ── Shared JSON schemas (referenced via $ref in route schemas) ───────────────
  app.addSchema({
    $id: 'Error',
    type: 'object',
    properties: { error: { type: 'string' } },
  });
  app.addSchema({
    $id: 'Tenant',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  });
  app.addSchema({
    $id: 'Namespace',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string' },
      schemaConfig: { type: 'object', nullable: true },
      active: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  });
  app.addSchema({
    $id: 'Document',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      namespaceId: { type: 'string', format: 'uuid' },
      filename: { type: 'string' },
      s3Key: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'processing', 'indexed', 'failed'] },
      chunkCount: { type: 'integer', nullable: true },
      error: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  });
  app.addSchema({
    $id: 'Citation',
    type: 'object',
    properties: {
      sourceId: { type: 'integer' },
      namespaceSlug: { type: 'string' },
      sourceFile: { type: 'string' },
      page: { type: 'integer', nullable: true },
      chunkIndex: { type: 'integer' },
      chunkText: { type: 'string' },
      documentId: { type: 'string', format: 'uuid' },
      namespaceId: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
    },
  });

  // Routes
  await app.register(tenantRoutes);
  await app.register(namespaceRoutes);
  await app.register(documentRoutes);
  await app.register(queryRoutes);
  await app.register(mcpRoutes);
  await app.register(metricsRoute);

  app.get('/health', {
    schema: {
      tags: ['Health'],
      summary: 'Health check',
      security: [],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            ts: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async () => ({ status: 'ok', ts: new Date().toISOString() }));

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation error', details: error.validation });
    }
    if (error.statusCode) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({ error: 'Internal server error' });
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`API listening on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start server');
  process.exit(1);
});
