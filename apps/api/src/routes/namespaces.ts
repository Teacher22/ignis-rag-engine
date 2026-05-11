import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../lib/db';
import { embedText } from '../lib/embeddings';
import { requireTenantAccess } from '../middleware/auth';

const CreateNamespaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(50).max(500),
  schemaConfig: z
    .object({
      allowed_types: z.array(z.string()).optional(),
      required_metadata: z.array(z.string()).optional(),
      max_file_size_mb: z.number().positive().optional(),
      custom_rules: z
        .array(z.object({ field: z.string(), type: z.string(), required: z.boolean().optional() }))
        .optional(),
    })
    .optional(),
});

const UpdateNamespaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(50).max(500).optional(),
  schemaConfig: z.any().optional(),
  active: z.boolean().optional(),
});

const nsParams = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
  },
};

const nsWithIdParams = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    namespaceId: { type: 'string', format: 'uuid' },
  },
};

export async function namespaceRoutes(app: FastifyInstance) {
  const prefix = '/api/v1/tenants/:tenantId/namespaces';

  // List namespaces
  app.get(prefix, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Namespaces'],
      summary: 'List all namespaces for a tenant',
      security: [{ bearerAuth: [] }],
      params: nsParams,
      response: {
        200: { type: 'array', items: { $ref: 'Namespace#' } },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const db = getDb();

    const result = await db.query(
      `SELECT id, tenant_id, name, slug, description, schema_config, active, created_at, updated_at
       FROM namespaces WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );

    return result.rows.map(mapNamespace);
  });

  // Create namespace
  app.post(prefix, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Namespaces'],
      summary: 'Create a namespace',
      description: 'Creates a knowledge-base namespace. The description is embedded automatically and used for query routing.',
      security: [{ bearerAuth: [] }],
      params: nsParams,
      body: {
        type: 'object',
        required: ['name', 'slug', 'description'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          slug: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9-]+$', description: 'Lowercase alphanumeric with hyphens' },
          description: { type: 'string', minLength: 50, maxLength: 500, description: 'Semantic description used for namespace routing (min 50 chars)' },
          schemaConfig: {
            type: 'object',
            nullable: true,
            properties: {
              allowed_types: { type: 'array', items: { type: 'string' } },
              required_metadata: { type: 'array', items: { type: 'string' } },
              max_file_size_mb: { type: 'number' },
            },
          },
        },
      },
      response: {
        201: { $ref: 'Namespace#' },
        400: { $ref: 'Error#' },
        409: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = CreateNamespaceSchema.parse(request.body);
    const db = getDb();

    // Check slug uniqueness
    const existing = await db.query(
      'SELECT id FROM namespaces WHERE tenant_id = $1 AND slug = $2',
      [tenantId, body.slug]
    );
    if (existing.rows.length) {
      return reply.code(409).send({ error: 'Slug already exists for this tenant' });
    }

    // Embed description synchronously — routing depends on it immediately
    const embedding = await embedText(body.description);

    const result = await db.query(
      `INSERT INTO namespaces (tenant_id, name, slug, description, description_embedding, schema_config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, name, slug, description, schema_config, active, created_at, updated_at`,
      [
        tenantId,
        body.name,
        body.slug,
        body.description,
        embedding,           // pg driver sends number[] as FLOAT8[] natively
        body.schemaConfig ? JSON.stringify(body.schemaConfig) : null,
      ]
    );

    return reply.code(201).send(mapNamespace(result.rows[0]));
  });

  // Get namespace by ID
  app.get(`${prefix}/:namespaceId`, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Namespaces'],
      summary: 'Get a namespace by ID',
      security: [{ bearerAuth: [] }],
      params: nsWithIdParams,
      response: {
        200: { $ref: 'Namespace#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId, namespaceId } = request.params as { tenantId: string; namespaceId: string };
    const db = getDb();

    const result = await db.query(
      `SELECT id, tenant_id, name, slug, description, schema_config, active, created_at, updated_at
       FROM namespaces WHERE id = $1 AND tenant_id = $2`,
      [namespaceId, tenantId]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Namespace not found' });
    }

    return mapNamespace(result.rows[0]);
  });

  // Update namespace
  app.patch(`${prefix}/:namespaceId`, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Namespaces'],
      summary: 'Update a namespace',
      security: [{ bearerAuth: [] }],
      params: nsWithIdParams,
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', minLength: 50, maxLength: 500 },
          schemaConfig: { type: 'object', nullable: true },
          active: { type: 'boolean' },
        },
      },
      response: {
        200: { $ref: 'Namespace#' },
        400: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId, namespaceId } = request.params as { tenantId: string; namespaceId: string };
    const body = UpdateNamespaceSchema.parse(request.body);
    const db = getDb();

    // Verify namespace belongs to tenant
    const existing = await db.query(
      'SELECT id, description FROM namespaces WHERE id = $1 AND tenant_id = $2',
      [namespaceId, tenantId]
    );
    if (!existing.rows[0]) {
      return reply.code(404).send({ error: 'Namespace not found' });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(body.name); }
    if (body.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(body.description);
      // Re-embed when description changes
      const embedding = await embedText(body.description);
      updates.push(`description_embedding = $${idx++}`);
      values.push(embedding);
    }
    if (body.schemaConfig !== undefined) {
      updates.push(`schema_config = $${idx++}`);
      values.push(JSON.stringify(body.schemaConfig));
    }
    if (body.active !== undefined) { updates.push(`active = $${idx++}`); values.push(body.active); }

    if (!updates.length) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    values.push(namespaceId);
    const result = await db.query(
      `UPDATE namespaces SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, tenant_id, name, slug, description, schema_config, active, created_at, updated_at`,
      values
    );

    return mapNamespace(result.rows[0]);
  });

  // Delete namespace
  app.delete(`${prefix}/:namespaceId`, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Namespaces'],
      summary: 'Delete a namespace',
      security: [{ bearerAuth: [] }],
      params: nsWithIdParams,
      response: {
        204: { type: 'null', description: 'Deleted successfully' },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId, namespaceId } = request.params as { tenantId: string; namespaceId: string };
    const db = getDb();

    const result = await db.query(
      'DELETE FROM namespaces WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [namespaceId, tenantId]
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ error: 'Namespace not found' });
    }

    return reply.code(204).send();
  });
}

function mapNamespace(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    schemaConfig: row.schema_config ?? null,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
