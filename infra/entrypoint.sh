#!/bin/bash
set -e

# Optional: Run database migrations
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  npx tsx apps/api/scripts/migrate.ts
fi

# Optional: Set up Qdrant collection and payload indexes
if [ "$SETUP_QDRANT" = "true" ]; then
  echo "Setting up Qdrant..."
  npx tsx apps/api/scripts/setup-qdrant.ts
fi

# Optional: Seed database with default tenant and API key
if [ "$SEED_DB" = "true" ]; then
  echo "Seeding database..."
  npx tsx apps/api/scripts/seed.ts
fi

# Start all processes under supervisor control
echo "Starting all services via Supervisord..."
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
