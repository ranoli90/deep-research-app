CREATE TABLE IF NOT EXISTS research_coverage (
  model_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  checker_version text NOT NULL,
  extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  support_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
  brief_revision integer NOT NULL,
  evidence_revision integer NOT NULL,
  support_checker_version text NOT NULL,
  claim_revision_ids uuid[] NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(model_intent_id,checker_version,support_checker_version)
);
CREATE INDEX IF NOT EXISTS research_coverage_owner ON research_coverage(account_id,run_id);
