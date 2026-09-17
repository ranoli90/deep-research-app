CREATE TABLE IF NOT EXISTS research_drafts (
  writer_intent_id uuid PRIMARY KEY REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  source_extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  source_support_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
  brief_revision integer NOT NULL,
  evidence_revision integer NOT NULL
);
CREATE INDEX IF NOT EXISTS research_drafts_owner ON research_drafts(account_id,run_id);
-- A new deterministic checker version may recheck the same model comparison without rewriting history.
ALTER TABLE scoped_support_results DROP CONSTRAINT scoped_support_results_pkey;
ALTER TABLE scoped_support_results ADD PRIMARY KEY(model_intent_id,claim_key,checker_version);
