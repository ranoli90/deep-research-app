-- Bounded original bytes and structured provenance share the evidence owner's deletion boundary.
CREATE TABLE IF NOT EXISTS evidence_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  body bytea NOT NULL CHECK (octet_length(body) <= 1500000),
  digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS extraction_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  source_version_id uuid NOT NULL REFERENCES source_versions(id),
  artifact_id uuid REFERENCES evidence_artifacts(id) ON DELETE SET NULL,
  transport jsonb NOT NULL,
  extraction jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_artifacts_owner_idx ON evidence_artifacts(account_id);
CREATE INDEX IF NOT EXISTS extraction_receipts_owner_idx ON extraction_receipts(account_id);
