CREATE TABLE IF NOT EXISTS extracted_assertions (
  extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  claim_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES claims(id),
  claim_revision_id uuid NOT NULL REFERENCES claim_revisions(id),
  PRIMARY KEY(extraction_intent_id,claim_key)
);
CREATE TABLE IF NOT EXISTS scoped_support_results (
  model_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  claim_key text NOT NULL,
  claim_revision_id uuid NOT NULL REFERENCES claim_revisions(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
  brief_revision integer NOT NULL,
  evidence_revision integer NOT NULL,
  evidence_digest text NOT NULL,
  scope_digest text NOT NULL,
  checker_version text NOT NULL,
  decision text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(model_intent_id,claim_key)
);
CREATE INDEX IF NOT EXISTS scoped_support_owner ON scoped_support_results(account_id,run_id);
CREATE INDEX IF NOT EXISTS extracted_assertions_owner ON extracted_assertions(account_id,run_id);
