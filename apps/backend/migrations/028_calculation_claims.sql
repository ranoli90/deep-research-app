CREATE TABLE IF NOT EXISTS calculation_claims (
 calculation_id uuid PRIMARY KEY REFERENCES evidence_calculations(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 claim_id uuid NOT NULL UNIQUE REFERENCES claims(id),
 claim_revision_id uuid NOT NULL UNIQUE REFERENCES claim_revisions(id),
 renderer_version text NOT NULL
);
CREATE INDEX IF NOT EXISTS calculation_claims_owner ON calculation_claims(account_id,run_id);
