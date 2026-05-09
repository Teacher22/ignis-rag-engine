import { getDb } from '../lib/db';
import { MCPToolDefinition } from '@ignis/shared';

export async function generateToolManifest(tenantId: string): Promise<MCPToolDefinition[]> {
  const db = getDb();
  const result = await db.query(
    `SELECT id, slug, description
     FROM namespaces
     WHERE tenant_id = $1 AND active = true
     ORDER BY name`,
    [tenantId]
  );

  return result.rows.map((ns) => ({
    name: `query__${ns.slug}`,
    description: ns.description,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The question to answer from this namespace',
        },
        top_k: {
          type: 'number',
          description: 'Number of chunks to retrieve (default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  }));
}
