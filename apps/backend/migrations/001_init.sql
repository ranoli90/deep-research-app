CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deletion_epoch bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  policy_version text NOT NULL,
  processors jsonb NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  consent_epoch bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS allowance_accounts (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  currency text NOT NULL DEFAULT 'USD',
  limit_micro bigint NOT NULL,
  settled_micro bigint NOT NULL DEFAULT 0,
  reserved_micro bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid,
  amount_micro bigint NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  correlation_id text NOT NULL,
  route text NOT NULL,
  request_digest text NOT NULL,
  reserved_max_micro bigint NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  title text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  original_question text NOT NULL,
  payload jsonb NOT NULL,
  revision int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, revision)
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  brief_id uuid NOT NULL REFERENCES research_briefs(id),
  parent_run_id uuid REFERENCES runs(id),
  route_mode text NOT NULL,
  lifecycle text NOT NULL,
  phase text NOT NULL,
  terminal_outcome text,
  brief_revision int NOT NULL,
  evidence_revision int NOT NULL DEFAULT 0,
  consent_epoch bigint NOT NULL,
  cancellation_epoch bigint NOT NULL DEFAULT 0,
  worker_lease_fence bigint NOT NULL DEFAULT 0,
  completion_epoch bigint NOT NULL DEFAULT 0,
  idempotency_key text,
  budget_micro bigint NOT NULL,
  spent_micro bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS run_leases (
  run_id uuid PRIMARY KEY REFERENCES runs(id),
  fence bigint NOT NULL,
  owner text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  evidence_revision int NOT NULL,
  phase text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  sequence bigint NOT NULL,
  type text NOT NULL,
  public_summary text NOT NULL,
  phase text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  canonical_locator text NOT NULL,
  original_locator text NOT NULL,
  publisher text,
  title text NOT NULL,
  source_type text NOT NULL,
  language text,
  origin_cluster text,
  population text,
  rights_class text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES sources(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  final_locator text NOT NULL,
  content_hash text,
  mime text,
  access_level text NOT NULL,
  quality_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_coverage text,
  artifact_ptr text
);

CREATE TABLE IF NOT EXISTS passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id uuid NOT NULL REFERENCES source_versions(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  exact_text text NOT NULL,
  locator jsonb NOT NULL,
  extraction_method text NOT NULL,
  content_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  text text NOT NULL,
  type text NOT NULL,
  support_status text NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id uuid NOT NULL REFERENCES claims(id),
  passage_id uuid NOT NULL REFERENCES passages(id),
  relation text NOT NULL,
  checker_version text NOT NULL,
  decision text NOT NULL,
  explanation text NOT NULL,
  PRIMARY KEY (claim_id, passage_id)
);

CREATE TABLE IF NOT EXISTS coverage_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  question text NOT NULL,
  importance text NOT NULL,
  status text NOT NULL,
  limitation text
);

CREATE TABLE IF NOT EXISTS evidence_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  missing_fact text NOT NULL,
  why_it_could_change_answer text NOT NULL,
  importance text NOT NULL,
  source_type_needed text,
  latest_outcome text
);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  identity text NOT NULL,
  discovered_from text,
  excluded_by text
);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  version int NOT NULL,
  outcome text NOT NULL,
  basis jsonb NOT NULL,
  blocks jsonb NOT NULL,
  claim_ids text[] NOT NULL,
  limitations jsonb NOT NULL,
  source_access_summary jsonb NOT NULL,
  change_summary jsonb,
  route_mode text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  redacted_at timestamptz,
  UNIQUE (run_id, version)
);

CREATE TABLE IF NOT EXISTS publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  fence jsonb NOT NULL,
  accepted boolean NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completion_outbox (
  run_id uuid NOT NULL REFERENCES runs(id),
  completion_epoch bigint NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, completion_epoch)
);

CREATE TABLE IF NOT EXISTS tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  object_kind text NOT NULL,
  object_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes int NOT NULL,
  storage_ptr text NOT NULL,
  sha256 text,
  processing_state text NOT NULL,
  extracted_text text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  report_id uuid NOT NULL REFERENCES reports(id),
  claim_id text,
  category text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_account_idx ON runs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_run_seq_idx ON run_events (run_id, sequence);
CREATE INDEX IF NOT EXISTS passages_run_idx ON passages (run_id);
CREATE INDEX IF NOT EXISTS sources_run_idx ON sources (run_id);
CREATE INDEX IF NOT EXISTS reports_account_idx ON reports (account_id, published_at DESC);
