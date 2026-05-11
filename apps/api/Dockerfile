# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy manifests first — layer cache means npm ci only reruns when deps change
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN npm ci

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Compile shared types then API
RUN npx tsc -p packages/shared/tsconfig.json
RUN npm run build --workspace=apps/api

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Only production deps
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]
