import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../lib/db';
import { uploadToGCS, buildGCSKey } from '../lib/gcs';
import { requireTenantAccess } from '../middleware/auth';
import { validateDocumentSchema } from '../services/schema-validator';
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES } from '../services/parser';
import { getIngestionQueue } from '../pipelines/ingestion.queue';
import { ingestionJobStarted, schemaRejectCounter } from '../observability/metrics';

const prefix = '/api/v1/tenants/:tenantId/namespaces/:namespaceId/documents';

const docParams = {
  type: 'object',
  properties: {
    tenantId: { type: 'string', format: 'uuid' },
    namespaceId: { type: 'string', format: 'uuid' },
  },
};

export async function documentRoutes(app: FastifyInstance) {
  // Upload document
  app.post(prefix, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Documents'],
      summary: 'Upload a document',
      description: 'Upload a file (PDF, TXT, MD, DOCX, CSV, JSON) for async ingestion into Qdrant. Returns a document ID and job ID.',
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
      params: docParams,
      // No body schema — @fastify/multipart handles the body via request.file()
      // Adding a JSON body schema here causes FST_ERR_VALIDATION because
      // multipart content is never parsed into a plain object
      response: {
        202: {
          type: 'object',
          properties: {
            document: { $ref: 'Document#' },
            jobId: { type: 'string', format: 'uuid' },
          },
        },
        400: { $ref: 'Error#' },
        404: { $ref: 'Error#' },
        422: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId, namespaceId } = request.params as {
      tenantId: string;
      namespaceId: string;
    };

    const db = getDb();

    // Verify namespace exists and belongs to tenant
    const nsResult = await db.query(
      'SELECT id, schema_config FROM namespaces WHERE id = $1 AND tenant_id = $2 AND active = true',
      [namespaceId, tenantId]
    );
    if (!nsResult.rows[0]) {
      return reply.code(404).send({ error: 'Namespace not found' });
    }
    const schemaConfig = nsResult.rows[0].schema_config;

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    const buffer = await data.toBuffer();
    const { filename, mimetype } = data;
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';

    // Basic MIME/extension check
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIME_TYPES.has(mimetype)) {
      return reply.code(422).send({
        error: 'Unsupported file type',
        details: [`Extension '${ext}' is not supported`],
      });
    }

    // Schema validation
    const validation = validateDocumentSchema(filename, mimetype, buffer.length, schemaConfig);
    if (!validation.valid) {
      schemaRejectCounter.inc({ tenant_id: tenantId, namespace_id: namespaceId });
      return reply.code(422).send({ error: 'Schema validation failed', details: validation.errors });
    }

    const documentId = uuidv4();
    const s3Key = buildGCSKey(tenantId, namespaceId, documentId, filename);

    // Upload to GCS
    await uploadToGCS(s3Key, buffer, mimetype);

    // Insert document row
    await db.query(
      `INSERT INTO documents (id, tenant_id, namespace_id, filename, s3_key, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [documentId, tenantId, namespaceId, filename, s3Key]
    );

    // Create ingestion job record
    const jobId = uuidv4();
    await db.query(
      `INSERT INTO ingestion_jobs (id, document_id, status) VALUES ($1, $2, 'queued')`,
      [jobId, documentId]
    );

    // Enqueue BullMQ job
    const queue = getIngestionQueue();
    const bullJob = await queue.add(
      'ingest-document',
      { documentId, tenantId, namespaceId },
      { jobId }
    );

    // Update job with bullmq job ID
    await db.query(
      'UPDATE ingestion_jobs SET bullmq_job_id = $1 WHERE id = $2',
      [bullJob.id, jobId]
    );

    ingestionJobStarted.inc({ tenant_id: tenantId, namespace_id: namespaceId });

    return reply.code(202).send({
      document: {
        id: documentId,
        tenantId,
        namespaceId,
        filename,
        s3Key,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
      jobId,
    });
  });

  // List documents in namespace
  app.get(prefix, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Documents'],
      summary: 'List documents in a namespace',
      security: [{ bearerAuth: [] }],
      params: docParams,
      response: {
        200: { type: 'array', items: { $ref: 'Document#' } },
        401: { $ref: 'Error#' },
        403: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId, namespaceId } = request.params as {
      tenantId: string;
      namespaceId: string;
    };
    const db = getDb();

    const result = await db.query(
      `SELECT id, tenant_id, namespace_id, filename, s3_key, status, chunk_count, error, created_at
       FROM documents WHERE tenant_id = $1 AND namespace_id = $2 ORDER BY created_at DESC`,
      [tenantId, namespaceId]
    );

    return result.rows.map(mapDocument);
  });

  // Retry single document
  app.post(`${prefix}/:documentId/retry`, {
    preHandler: requireTenantAccess,
    schema: {
      tags: ['Documents'],
      summary: 'Retry ingestion for a single document',
      description: 'Re-queues a failed (or already indexed) document for re-embedding. Useful after changing embedding models.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', format: 'uuid' },
          namespaceId: { type: 'string', format: 'uuid' },
          documentId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        202: {
          type: 'object',
          properties: {
            jobId: { type: 'string', format: 'uuid' },
            documentId: { type: 'string', format: 'uuid' },
          },
        },
        404: { $ref: 'Error#' },
      },
    },
  }, async (request, reply) => {
    const { tenantId, namespaceId, documentId } = request.params as {
      tenantId: string; namespaceId: string; documentId: string;
    };
    const db = getDb();

    const docResult = await db.query(
      'SELECT id, namespace_id FROM documents WHERE id = $1 AND tenant_id = $2',
      [documentId, tenantId]
    );
    if (!docResult.rows[0]) return reply.code(404).send({ error: 'Document not found' });

    return enqueueRetry(db, documentId, tenantId, namespaceId, reply);
  });

  // Re-index ALL documents in a namespace (e.g. after Qdrant wipe)
  app.post(
    '/api/v1/tenants/:tenantId/namespaces/:namespaceId/reindex',
    {
      preHandler: requireTenantAccess,
      schema: {
        tags: ['Documents'],
        summary: 'Re-index all documents in a namespace',
        description: 'Re-queues every document in the namespace for re-embedding. Use after wiping Qdrant or changing embedding models.',
        security: [{ bearerAuth: [] }],
        params: docParams,
        response: {
          200: {
            type: 'object',
            properties: {
              requeued: { type: 'integer', description: 'Number of documents queued' },
              jobIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, namespaceId } = request.params as { tenantId: string; namespaceId: string };
      const db = getDb();

      const docs = await db.query(
        `SELECT id FROM documents WHERE namespace_id = $1 AND tenant_id = $2`,
        [namespaceId, tenantId]
      );

      const jobs = await Promise.all(
        docs.rows.map((d: { id: string }) => enqueueRetry(db, d.id, tenantId, namespaceId))
      );

      return reply.send({ requeued: jobs.length, jobIds: jobs });
    }
  );

  // Get job status
  app.get(
    '/api/v1/tenants/:tenantId/jobs/:jobId',
    {
      preHandler: requireTenantAccess,
      schema: {
        tags: ['Jobs'],
        summary: 'Get ingestion job status',
        description: 'Poll the status of a background ingestion job returned from document upload.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            jobId: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              jobId: { type: 'string', format: 'uuid' },
              documentId: { type: 'string', format: 'uuid' },
              status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
              attempts: { type: 'integer' },
              document: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  filename: { type: 'string' },
                  status: { type: 'string' },
                  chunkCount: { type: 'integer', nullable: true },
                  error: { type: 'string', nullable: true },
                },
              },
            },
          },
          404: { $ref: 'Error#' },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, jobId } = request.params as { tenantId: string; jobId: string };
      const db = getDb();

      const result = await db.query(
        `SELECT ij.id, ij.document_id, ij.status, ij.attempts, ij.created_at,
                d.filename, d.status AS doc_status, d.chunk_count, d.error
         FROM ingestion_jobs ij
         JOIN documents d ON d.id = ij.document_id
         WHERE ij.id = $1 AND d.tenant_id = $2`,
        [jobId, tenantId]
      );

      if (!result.rows[0]) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      const row = result.rows[0];
      return {
        jobId: row.id,
        documentId: row.document_id,
        status: row.status,
        attempts: row.attempts,
        document: {
          id: row.document_id,
          filename: row.filename,
          status: row.doc_status,
          chunkCount: row.chunk_count,
          error: row.error,
        },
      };
    }
  );
}

async function enqueueRetry(
  db: ReturnType<typeof import('../lib/db').getDb>,
  documentId: string,
  tenantId: string,
  namespaceId: string,
  reply?: import('fastify').FastifyReply
) {
  // Reset document status
  await db.query(
    `UPDATE documents SET status = 'pending', error = NULL, chunk_count = NULL WHERE id = $1`,
    [documentId]
  );

  // Create new job row
  const jobId = uuidv4();
  await db.query(
    `INSERT INTO ingestion_jobs (id, document_id, status) VALUES ($1, $2, 'queued')`,
    [jobId, documentId]
  );

  const queue = getIngestionQueue();
  const bullJob = await queue.add('ingest-document', { documentId, tenantId, namespaceId }, { jobId });
  await db.query('UPDATE ingestion_jobs SET bullmq_job_id = $1 WHERE id = $2', [bullJob.id, jobId]);

  if (reply) return reply.code(202).send({ jobId, documentId });
  return jobId;
}

function mapDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    namespaceId: row.namespace_id,
    filename: row.filename,
    s3Key: row.s3_key,
    status: row.status,
    chunkCount: row.chunk_count ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
  };
}
