/**
 * Bootstrap script — creates the default tenant and prints the API key.
 * Run once: npm run seed --workspace=apps/api
 */
import { Pool } from 'pg';
import { createHash, randomBytes } from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }

function generateApiKey() {
  return `ignis_${randomBytes(32).toString('hex')}`;
}
function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

async function seed() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const existing = await pool.query('SELECT id, name FROM tenants LIMIT 1');
  if (existing.rows.length) {
    console.log(`\nTenant already exists: "${existing.rows[0].name}" (id: ${existing.rows[0].id})`);
    console.log('To get a new API key, delete the tenant row and re-run this script.\n');
    await pool.end();
    return;
  }

  const apiKey = generateApiKey();
  const hash = hashApiKey(apiKey);

  const result = await pool.query(
    `INSERT INTO tenants (name, api_key_hash, plan)
     VALUES ($1, $2, 'pro')
     RETURNING id, name`,
    ['Default Tenant', hash]
  );

  console.log('\n✅ Tenant created successfully!\n');
  console.log(`   Tenant ID : ${result.rows[0].id}`);
  console.log(`   Name      : ${result.rows[0].name}`);
  console.log(`\n   API Key   : ${apiKey}\n`);
  console.log('   ⚠️  Copy this API key now — it will NOT be shown again.\n');

  await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
