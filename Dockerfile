# ── Stage 1: Build Node.js services ───────────────────────────────────────────
FROM node:20-bookworm AS node-builder
WORKDIR /app

# Copy package manifests for workspace caching
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy full source
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build workspaces in dependency order
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/api
RUN npm run build --workspace=apps/web


# ── Stage 2: Build Python reranker ────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS python-builder
WORKDIR /app

# Create a clean virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install python dependencies in the virtual environment
COPY infra/reranker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt


# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Install Python 3, Nginx, Supervisord, and curl (for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install global tsx to run typescript migration and seeding scripts in production
RUN npm install -g tsx

# Copy Python virtual environment and reranker code
COPY --from=python-builder /opt/venv /opt/venv
COPY infra/reranker /app/infra/reranker

# Copy static frontend assets and Nginx configuration
COPY --from=node-builder /app/apps/web/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/sites-available/default
RUN ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Copy package manifests for workspace runtime install
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install ONLY production dependencies across the monorepo
RUN npm ci --omit=dev

# Copy compiled TypeScript outputs
COPY --from=node-builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=node-builder /app/apps/api/dist ./apps/api/dist

# Copy migrations and helper scripts for startup tasks
COPY apps/api/scripts ./apps/api/scripts
COPY infra/postgres/migrations ./infra/postgres/migrations

# Copy Supervisord and entrypoint configurations
COPY infra/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY infra/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose ports:
# - 80: Nginx (Frontend + proxied API & MCP)
# - 3001: Fastify API direct
# - 8001: Python Reranker sidecar direct
EXPOSE 80 3001 8001

ENTRYPOINT ["/app/entrypoint.sh"]
