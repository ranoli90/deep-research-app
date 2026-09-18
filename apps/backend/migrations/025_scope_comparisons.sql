CREATE TABLE IF NOT EXISTS scope_comparisons (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
 extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 support_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 brief_revision integer NOT NULL,
 evidence_revision integer NOT NULL,
 checker_version text NOT NULL,
 support_checker_version text NOT NULL,
 input_digest text NOT NULL,
 claim_revision_ids uuid[] NOT NULL,
 result jsonb NOT NULL,
 UNIQUE(run_id, extraction_intent_id, support_intent_id, checker_version, input_digest)
);
CREATE INDEX IF NOT EXISTS scope_comparisons_owner ON scope_comparisons(account_id,run_id);
