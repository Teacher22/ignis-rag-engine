import { Queue } from 'bullmq';
import { getRedis } from '../lib/redis';

export const INGESTION_QUEUE_NAME = 'ignis-ingestion';

export interface IngestionJobData {
  documentId: string;
  tenantId: string;
  namespaceId: string;
}

let ingestionQueue: Queue<IngestionJobData> | null = null;

export function getIngestionQueue(): Queue<IngestionJobData> {
  if (!ingestionQueue) {
    ingestionQueue = new Queue<IngestionJobData>(INGESTION_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return ingestionQueue;
}
