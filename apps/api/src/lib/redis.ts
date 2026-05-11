import Redis from 'ioredis';
import { env } from '../config/env';

export type { Redis };

let redisConnection: Redis | null = null;

export function getRedis(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}
