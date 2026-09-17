CREATE TABLE IF NOT EXISTS claim_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  revision integer NOT NULL CHECK (revision > 0),
  text text NOT NULL,
  text_digest text NOT NULL,
  scope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(claim_id,revision)
);
CREATE TABLE IF NOT EXISTS support_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_revision_id uuid NOT NULL REFERENCES claim_revisions(id),
  passage_id uuid NOT NULL REFERENCES passages(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  evidence_digest text NOT NULL,
  scope_digest text NOT NULL,
  checker_version text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('supports','contradicts','qualifies','context-only','unsupported')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(claim_revision_id,passage_id,evidence_digest,scope_digest,checker_version)
);
CREATE INDEX IF NOT EXISTS claim_revisions_owner_idx ON claim_revisions(account_id);
CREATE INDEX IF NOT EXISTS support_assessments_owner_idx ON support_assessments(account_id);
