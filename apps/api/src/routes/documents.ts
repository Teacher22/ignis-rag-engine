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

export async function documentRoutes(app: FastifyInstance) {
  // Upload document
  app.post(prefix, { preHandler: requireTenantAccess }, async (request, reply) => {
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
  app.get(prefix, { preHandler: requireTenantAccess }, async (request, reply) => {
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

  // Get job status
  app.get(
    '/api/v1/tenants/:tenantId/jobs/:jobId',
    { preHandler: requireTenantAccess },
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
