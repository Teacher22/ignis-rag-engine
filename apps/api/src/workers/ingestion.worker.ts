import { Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { getRedis } from '../lib/redis';
import { getDb } from '../lib/db';
import { downloadFromGCS } from '../lib/gcs';
import { getQdrant, COLLECTION_NAME, ChunkPayload } from '../lib/qdrant';
import { embedBatch } from '../lib/embeddings';
import { parseFile } from '../services/parser';
import { chunkText } from '../services/chunker';
import { logger } from '../middleware/logger';
import { INGESTION_QUEUE_NAME, IngestionJobData } from '../pipelines/ingestion.queue';
import {
  ingestionDuration,
  ingestionChunksTotal,
  ingestionJobFailed,
} from '../observability/metrics';

const EMBED_BATCH_SIZE = 100;

async function processIngestionJob(job: Job<IngestionJobData>): Promise<void> {
  const { documentId, tenantId, namespaceId } = job.data;
  const start = Date.now();
  const db = getDb();

  await db.query(
    `UPDATE documents SET status = 'processing' WHERE id = $1`,
    [documentId]
  );
  await db.query(
    `UPDATE ingestion_jobs SET status = 'running', attempts = attempts + 1
     WHERE document_id = $1`,
    [documentId]
  );

  try {
    // Fetch document metadata
    const docResult = await db.query(
      'SELECT filename, s3_key FROM documents WHERE id = $1',
      [documentId]
    );
    const doc = docResult.rows[0];
    if (!doc) throw new Error(`Document ${documentId} not found`);

    // Fetch namespace slug
    const nsResult = await db.query(
      'SELECT slug FROM namespaces WHERE id = $1',
      [namespaceId]
    );
    const namespaceSlug = nsResult.rows[0]?.slug ?? namespaceId;

    // Download from S3
    logger.info({ documentId, s3Key: doc.s3_key }, 'Downloading file from S3');
    const buffer = await downloadFromGCS(doc.s3_key);

    // Parse file to text
    const ext = doc.filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      md: 'text/markdown',
      csv: 'text/csv',
      json: 'application/json',
    };
    const mimeType = mimeTypes[ext] ?? 'text/plain';
    const parsed = await parseFile(buffer, mimeType, doc.filename);

    // Chunk
    const chunks = chunkText(parsed.text);
    logger.info({ documentId, chunkCount: chunks.length }, 'Chunking complete');

    // Embed in batches of 100
    const allPoints: { id: string; vector: number[]; payload: ChunkPayload }[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await embedBatch(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j++) {
        allPoints.push({
          id: uuidv4(),
          vector: vectors[j],
          payload: {
            tenant_id: tenantId,
            namespace_id: namespaceId,
            namespace_slug: namespaceSlug,
            document_id: documentId,
            chunk_index: batch[j].index,
            chunk_text: batch[j].text,
            page: batch[j].page,
            token_count: batch[j].tokenCount,
            source_file: doc.filename,
          },
        });
      }
    }

    // Upsert all vectors to Qdrant
    const qdrant = getQdrant();
    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points: allPoints,
    });

    // Update document status
    await db.query(
      `UPDATE documents SET status = 'indexed', chunk_count = $1 WHERE id = $2`,
      [chunks.length, documentId]
    );
    await db.query(
      `UPDATE ingestion_jobs SET status = 'done' WHERE document_id = $1`,
      [documentId]
    );

    const duration = Date.now() - start;
    ingestionDuration.observe({ tenant_id: tenantId }, duration / 1000);
    ingestionChunksTotal.inc({ tenant_id: tenantId }, chunks.length);

    logger.info(
      { event: 'ingestion_complete', tenantId, documentId, namespaceId, chunkCount: chunks.length, durationMs: duration },
      'Ingestion complete'
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE documents SET status = 'failed', error = $1 WHERE id = $2`,
      [error, documentId]
    );
    await db.query(
      `UPDATE ingestion_jobs SET status = 'failed' WHERE document_id = $1`,
      [documentId]
    );
    ingestionJobFailed.inc({ tenant_id: tenantId });
    logger.error(
      { event: 'ingestion_failed', tenantId, documentId, error, durationMs: Date.now() - start },
      'Ingestion failed'
    );
    throw err; // rethrow so BullMQ retries
  }
}

const worker = new Worker<IngestionJobData>(INGESTION_QUEUE_NAME, processIngestionJob, {
  connection: getRedis(),
  concurrency: 5,
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, documentId: job.data.documentId }, 'Ingestion job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Ingestion job failed');
});

logger.info('Ingestion worker started');
