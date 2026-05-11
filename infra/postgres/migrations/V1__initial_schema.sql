-- Tenants
CREATE TABLE tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  plan         TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Namespaces
CREATE TABLE namespaces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL,
  description           TEXT NOT NULL,
  description_embedding FLOAT8[],
  schema_config         JSONB,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

-- Documents
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  s3_key       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'failed')),
  chunk_count  INT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingestion jobs
CREATE TABLE ingestion_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id),
  bullmq_job_id TEXT,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_namespaces_tenant ON namespaces(tenant_id);
CREATE INDEX idx_documents_tenant ON documents(tenant_id);
CREATE INDEX idx_documents_namespace ON documents(namespace_id);
CREATE INDEX idx_ingestion_jobs_document ON ingestion_jobs(document_id);

-- Auto-update updated_at for namespaces
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER namespace_updated_at
  BEFORE UPDATE ON namespaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
