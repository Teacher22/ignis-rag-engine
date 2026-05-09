import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { getDb } from '../lib/db';

export interface JWTPayload {
  tenantId: string;
  sub: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTPayload;
    user: JWTPayload;
  }
}

export async function requireJWT(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireTenantAccess(
  request: FastifyRequest<{ Params: { tenantId: string } }>,
  reply: FastifyReply
): Promise<void> {
  await requireJWT(request, reply);
  if (reply.sent) return;

  const { tenantId } = request.params;
  if (request.user.tenantId !== tenantId) {
    reply.code(403).send({ error: 'Forbidden' });
  }
}

export async function validateApiKey(
  apiKey: string
): Promise<{ id: string; name: string; plan: string } | null> {
  const db = getDb();
  const hash = hashApiKey(apiKey);
  const result = await db.query(
    'SELECT id, name, plan FROM tenants WHERE api_key_hash = $1',
    [hash]
  );
  return result.rows[0] ?? null;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(): string {
  const { randomBytes } = require('crypto');
  return `ignis_${randomBytes(32).toString('hex')}`;
}
