import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION_NAME = 'ignis_chunks';
const VECTOR_SIZE = 768; // text-embedding-004

async function setup() {
  const client = new QdrantClient({
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
  });

  // Check if collection already exists
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

  if (exists) {
    console.log(`Collection '${COLLECTION_NAME}' already exists, skipping creation.`);
  } else {
    await client.createCollection(COLLECTION_NAME, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
      optimizers_config: {
        indexing_threshold: 20000,
      },
      hnsw_config: {
        m: 16,
        ef_construct: 100,
      },
    });
    console.log(`Created collection '${COLLECTION_NAME}'`);
  }

  // Create payload indexes for fast filtering
  await client.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'tenant_id',
    field_schema: 'keyword',
  });
  console.log('Created payload index: tenant_id');

  await client.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'namespace_id',
    field_schema: 'keyword',
  });
  console.log('Created payload index: namespace_id');

  console.log('Qdrant setup complete.');
}

setup().catch(err => {
  console.error('Qdrant setup failed:', err);
  process.exit(1);
});
