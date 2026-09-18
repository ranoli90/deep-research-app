CREATE TABLE IF NOT EXISTS counterevidence_checks (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
 brief_revision integer NOT NULL,
 version text NOT NULL,
 extraction_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 initial_support_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 original_evidence_revision integer NOT NULL,
 original_evidence_digest text NOT NULL,
 action jsonb NOT NULL,
 targets jsonb NOT NULL,
 targets_digest text NOT NULL,
 search_intent_id uuid REFERENCES provider_intents(id) ON DELETE CASCADE,
 read_operations jsonb NOT NULL DEFAULT '[]',
 state text NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','read','checked','blocked','unknown')),
 outcome text,
 reason text,
 evidence_revision integer,
 evidence_digest text,
 model_intent_id uuid REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
 context_manifest jsonb,
 result jsonb,
 checker_version text,
 UNIQUE(run_id,brief_revision,version)
);
CREATE INDEX IF NOT EXISTS counterevidence_owner ON counterevidence_checks(account_id,run_id);

-- Required proof identity survives accidental loss of a derived result row.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS counterevidence_required_revision integer;
