import { CohereClient } from 'cohere-ai';
import { env } from '../config/env';

let cohereClient: CohereClient | null = null;

export function getCohere(): CohereClient {
  if (!cohereClient) {
    cohereClient = new CohereClient({ token: env.COHERE_API_KEY });
  }
  return cohereClient;
}
