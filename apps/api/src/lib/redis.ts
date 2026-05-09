import { Redis } from 'bullmq';
import { env } from '../config/env';

let redisConnection: Redis | null = null;

export function getRedis(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}
