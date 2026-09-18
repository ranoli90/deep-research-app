-- Additional deterministic support gate over the exact owned selection inventory.
-- This does not replace or reinterpret the model's recorded selected-context assessment.
CREATE TABLE IF NOT EXISTS selection_inventory_checks (
 account_id uuid NOT NULL REFERENCES accounts(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 selection_id uuid NOT NULL REFERENCES evidence_selections(id) ON DELETE CASCADE,
 claim_revision_id uuid NOT NULL REFERENCES claim_revisions(id) ON DELETE CASCADE,
 support_intent_id uuid NOT NULL REFERENCES provider_intents(id) ON DELETE CASCADE,
 checker_version text NOT NULL,
 input_digest text NOT NULL,
 scope_digest text NOT NULL,
 evidence_digest text NOT NULL,
 decision text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(selection_id,claim_revision_id,support_intent_id,checker_version)
);
CREATE INDEX IF NOT EXISTS selection_inventory_checks_owner ON selection_inventory_checks(account_id,run_id);
