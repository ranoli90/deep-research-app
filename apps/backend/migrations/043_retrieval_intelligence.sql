-- Provenance-aware public queries, origin clustering, freshness and document/web reconciliation.
-- Canonical 043 after 042_model_portfolio.sql. Isolated worker DBs may still record historical 042_retrieval_intelligence or 044_retrieval_intelligence ids.
-- Purged with account/source deletion. No provider/model/public API change.

CREATE TABLE IF NOT EXISTS query_authorizations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  brief_revision integer NOT NULL,
  query_digest text NOT NULL,
  proposed_query text NOT NULL,
  authorized_query text NOT NULL,
  terms jsonb NOT NULL,
  approved_private_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  permission_required boolean NOT NULL,
  kind text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS query_authorizations_owner ON query_authorizations(account_id, run_id);
CREATE INDEX IF NOT EXISTS query_authorizations_run ON query_authorizations(run_id);

CREATE TABLE IF NOT EXISTS source_origin_links (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  origin_cluster text NOT NULL,
  relation text NOT NULL,
  evidence text,
  UNIQUE(source_id)
);
CREATE INDEX IF NOT EXISTS source_origin_links_owner ON source_origin_links(account_id, run_id);
CREATE INDEX IF NOT EXISTS source_origin_links_run ON source_origin_links(run_id);

CREATE TABLE IF NOT EXISTS criterion_freshness_policies (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  criterion_key text NOT NULL,
  class text NOT NULL,
  max_age_hours integer,
  requires_effective_date boolean NOT NULL DEFAULT false,
  requires_version boolean NOT NULL DEFAULT false,
  policy jsonb NOT NULL,
  UNIQUE(run_id, criterion_key)
);
CREATE INDEX IF NOT EXISTS criterion_freshness_policies_owner ON criterion_freshness_policies(account_id, run_id);

CREATE TABLE IF NOT EXISTS document_web_reconciliations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  claim_key text NOT NULL,
  outcome text NOT NULL,
  permission_required boolean NOT NULL DEFAULT false,
  public_query_digest text,
  source_scope jsonb NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, claim_key)
);
CREATE INDEX IF NOT EXISTS document_web_reconciliations_owner ON document_web_reconciliations(account_id, run_id);
CREATE UNIQUE INDEX IF NOT EXISTS document_web_reconciliations_claim ON document_web_reconciliations(run_id, claim_key);

CREATE TABLE IF NOT EXISTS search_coverage (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  coverage jsonb NOT NULL,
  UNIQUE(run_id)
);
CREATE INDEX IF NOT EXISTS search_coverage_owner ON search_coverage(account_id, run_id);

ALTER TABLE sources ADD COLUMN IF NOT EXISTS publication_date date;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS origin_relation text;
