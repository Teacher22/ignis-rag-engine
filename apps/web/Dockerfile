# ── Stage 1: build Vite app ───────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# VITE_API_URL is baked in at build time — override via build-arg if needed
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npx tsc -p packages/shared/tsconfig.json
RUN npm run build --workspace=apps/web

# ── Stage 2: serve with Nginx ─────────────────────────────────────────────────
FROM nginx:stable-alpine AS runtime

# Remove default nginx page
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
