CREATE TABLE IF NOT EXISTS report_derivations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_revision_id uuid NOT NULL REFERENCES claim_revisions(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  kind text NOT NULL,
  checker_version text NOT NULL,
  inputs jsonb NOT NULL,
  input_digest text NOT NULL,
  output_digest text NOT NULL,
  UNIQUE(claim_revision_id,checker_version,input_digest)
);
CREATE INDEX IF NOT EXISTS report_derivations_owner_idx ON report_derivations(account_id);
