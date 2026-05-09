import Fastify from 'fastify';
import fastifyJWT from '@fastify/jwt';
import fastifyCORS from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';

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

  // Routes
  await app.register(tenantRoutes);
  await app.register(namespaceRoutes);
  await app.register(documentRoutes);
  await app.register(queryRoutes);
  await app.register(mcpRoutes);
  await app.register(metricsRoute);

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

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
