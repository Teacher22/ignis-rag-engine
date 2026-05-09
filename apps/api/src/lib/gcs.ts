import { Storage } from '@google-cloud/storage';
import { env } from '../config/env';

let storageClient: Storage | null = null;

export function getStorage(): Storage {
  if (!storageClient) {
    if (env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      // JSON content passed directly as env var (useful in containers / CI)
      const credentials = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      storageClient = new Storage({ credentials, projectId: credentials.project_id });
    } else {
      // Path to service account JSON file via GOOGLE_APPLICATION_CREDENTIALS
      storageClient = new Storage();
    }
  }
  return storageClient;
}

export async function uploadToGCS(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const storage = getStorage();
  const file = storage.bucket(env.GCS_BUCKET).file(key);
  await file.save(buffer, { contentType, resumable: false });
}

export async function downloadFromGCS(key: string): Promise<Buffer> {
  const storage = getStorage();
  const [buffer] = await storage.bucket(env.GCS_BUCKET).file(key).download();
  return buffer;
}

export function buildGCSKey(
  tenantId: string,
  namespaceId: string,
  documentId: string,
  filename: string
): string {
  return `${tenantId}/${namespaceId}/${documentId}/${filename}`;
}
