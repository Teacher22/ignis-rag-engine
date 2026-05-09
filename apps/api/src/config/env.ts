import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  GOOGLE_API_KEY: z.string().min(1),   // for embeddings (text-embedding-004) + LLM (gemini-2.0-flash)
  COHERE_API_KEY: z.string().default(''),
  RERANKER_URL: z.string().url().default('http://localhost:8001'),
  // GCS — provide either the path to the JSON key file OR its contents directly
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),       // path to service account JSON
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().optional(),  // raw JSON string (for containers)
  GCS_BUCKET: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('24h'),
  NS_ROUTING_THRESHOLD: z.coerce.number().default(0.35),
  RERANK_THRESHOLD: z.coerce.number().default(0.3),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
