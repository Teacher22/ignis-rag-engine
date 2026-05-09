import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../lib/db';
import {
  requireJWT,
  hashApiKey,
  generateApiKey,
} from '../middleware/auth';

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(255),
  plan: z.enum(['free', 'pro', 'enterprise']).default('free'),
});

export async function tenantRoutes(app: FastifyInstance) {
  // Create tenant (admin only — no auth for bootstrap, in prod restrict this)
  app.post('/api/v1/tenants', async (request, reply) => {
    const body = CreateTenantSchema.parse(request.body);
    const db = getDb();

    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    const result = await db.query(
      `INSERT INTO tenants (name, api_key_hash, plan)
       VALUES ($1, $2, $3)
       RETURNING id, name, plan, created_at`,
      [body.name, apiKeyHash, body.plan]
    );

    const tenant = result.rows[0];
    return reply.code(201).send({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        createdAt: tenant.created_at,
      },
      apiKey, // returned only once
    });
  });

  // Get tenant by ID (requires JWT)
  app.get(
    '/api/v1/tenants/:tenantId',
    { preHandler: requireJWT },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };

      if (request.user.tenantId !== tenantId) {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const db = getDb();
      const result = await db.query(
        'SELECT id, name, plan, created_at FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (!result.rows[0]) {
        return reply.code(404).send({ error: 'Tenant not found' });
      }

      const t = result.rows[0];
      return {
        id: t.id,
        name: t.name,
        plan: t.plan,
        createdAt: t.created_at,
      };
    }
  );

  // Login — issue JWT from API key
  app.post('/api/v1/auth/login', async (request, reply) => {
    const { apiKey } = request.body as { apiKey: string };
    if (!apiKey) {
      return reply.code(400).send({ error: 'apiKey required' });
    }

    const apiKeyHash = hashApiKey(apiKey);
    const db = getDb();
    const result = await db.query(
      'SELECT id, name, plan FROM tenants WHERE api_key_hash = $1',
      [apiKeyHash]
    );

    if (!result.rows[0]) {
      return reply.code(401).send({ error: 'Invalid API key' });
    }

    const tenant = result.rows[0];
    const token = await reply.jwtSign({
      tenantId: tenant.id,
      sub: tenant.id,
    });

    return { token, tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan } };
  });
}
