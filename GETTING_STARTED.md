# Ignis RAG Platform — Local Setup Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| Docker Desktop | latest | https://docker.com |
| npm | 10+ | comes with Node |

You also need API keys for:
- **OpenAI** — for embeddings (`text-embedding-3-small`)
- **Anthropic** — for LLM generation (`claude-sonnet-4`)
- **Cohere** _(optional)_ — for reranking. Leave blank to use the local Python sidecar instead.
- **Google Cloud** — a service account JSON with Storage Object Admin on your GCS bucket

---

## Step 1 — Install dependencies

```bash
# From the project root
npm install
```

---

## Step 2 — Start infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:
- **PostgreSQL 16** on port `5432`
- **Qdrant** on port `6333`
- **Redis** on port `6379`

Verify everything is healthy:
```bash
docker compose -f infra/docker-compose.yml ps
```
All three services should show `healthy`.

---

## Step 3 — Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` and fill in the required values:

```bash
# Database (matches docker-compose defaults — no change needed)
DATABASE_URL=postgres://ignis:ignis@localhost:5432/ignis

# AI providers — one Google key covers everything (free tier)
GOOGLE_API_KEY=AIza...   # aistudio.google.com/app/apikey
COHERE_API_KEY=          # leave blank to skip, self-hosted reranker used instead

# Google Cloud Storage
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
GCS_BUCKET=your-bucket-name

# Security — must be at least 32 characters
JWT_SECRET=replace-this-with-a-long-random-string-minimum-32-chars
```

**Using a GCS credentials JSON file?**
Set `GOOGLE_APPLICATION_CREDENTIALS` to the absolute path of the file.

**Want to paste the JSON contents directly?**
Use `GOOGLE_APPLICATION_CREDENTIALS_JSON` instead:
```bash
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"my-proj",...}
```

---

## Step 4 — Run database migrations

```bash
npm run migrate --workspace=apps/api
```

Expected output:
```
  apply V1__initial_schema.sql
Migrations complete.
```

---

## Step 5 — Set up Qdrant collection

```bash
npm run setup:qdrant --workspace=apps/api
```

Expected output:
```
Created collection 'ignis_chunks'
Created payload index: tenant_id
Created payload index: namespace_id
Qdrant setup complete.
```

---

## Step 6 — Create your first tenant (API key)

```bash
npm run seed --workspace=apps/api
```

Expected output:
```
✅ Tenant created successfully!

   Tenant ID : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   Name      : Default Tenant

   API Key   : ignis_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

   ⚠️  Copy this API key now — it will NOT be shown again.
```

**Copy the API key** — you will paste it into the dashboard login screen.

---

## Step 7 — Start the backend API

Open a new terminal tab:

```bash
npm run dev:api
```

Expected output:
```
[INFO] API listening on port 3001
```

Verify it's running:
```bash
curl http://localhost:3001/health
# {"status":"ok","ts":"..."}
```

---

## Step 8 — Start the ingestion worker

Open another terminal tab:

```bash
npm run worker --workspace=apps/api
```

Expected output:
```
Ingestion worker started
```

The worker must stay running to process document uploads.

---

## Step 9 — Start the frontend

Open another terminal tab:

```bash
npm run dev:web
```

Expected output:
```
VITE ready in ...ms
➜ Local: http://localhost:5173/
```

---

## Step 10 — Open the dashboard

1. Go to **http://localhost:5173**
2. Paste the API key from Step 6
3. Click **Sign in**

You should land on the **Namespaces** page.

---

## All terminals at a glance

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `docker compose -f infra/docker-compose.yml up -d` | Infrastructure |
| 2 | `npm run dev:api` | Fastify API (port 3001) |
| 3 | `npm run worker --workspace=apps/api` | BullMQ ingestion worker |
| 4 | `npm run dev:web` | React frontend (port 5173) |

---

## Quick workflow after login

1. **Namespaces page** → Create a namespace with a descriptive name  
   _e.g. "Use this to answer questions about product maintenance manuals…"_

2. **Documents page** → Select the namespace → Upload a PDF, TXT, DOCX, CSV, or JSON file  
   Status will change: `pending → processing → indexed`

3. **Query Playground** → Type a question, hit **Ask** (or ⌘+Enter)  
   The answer streams back with source citations.

4. **Observability** → See chunk counts, document statuses, and namespace health at a glance.

---

## MCP integration (Claude Desktop)

Add this to your Claude Desktop `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ignis-rag-engine": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "x-api-key": "ignis_your_key_here"
      }
    }
  }
}
```

Claude will see one tool per namespace you create (e.g. `query__maintenance-manuals`).

---

## Troubleshooting

**`DATABASE_URL` connection refused**  
→ Make sure Docker is running: `docker compose -f infra/docker-compose.yml up -d`

**`GCS_BUCKET` missing**  
→ Ensure `GCS_BUCKET` is set in `apps/api/.env`

**Ingestion stays `pending`**  
→ The worker is not running. Start it with `npm run worker --workspace=apps/api`

**`Invalid API key` on login**  
→ Re-check the key from Step 6. Run `npm run seed` again if the DB was wiped.

**Port already in use**  
→ API: set `PORT=3002` in `.env`. Frontend: edit `vite.config.ts` port.

---

## Ports reference

| Service | Port |
|---------|------|
| React frontend | 5173 |
| Fastify API | 3001 |
| PostgreSQL | 5432 |
| Qdrant HTTP | 6333 |
| Qdrant gRPC | 6334 |
| Redis | 6379 |
| Reranker sidecar _(optional)_ | 8001 |
| Prometheus metrics | 3001/metrics |
