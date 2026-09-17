-- Task identity is independent of evidence arrival. Corrections create a new brief revision.
-- Deletion of private model results also removes their derived task specifications.
CREATE TABLE IF NOT EXISTS research_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  brief_revision integer NOT NULL CHECK (brief_revision > 0),
  model_intent_id uuid NOT NULL REFERENCES model_operation_results(intent_id) ON DELETE CASCADE,
  version text NOT NULL,
  question_digest text NOT NULL,
  specification jsonb NOT NULL,
  criterion_ids jsonb NOT NULL,
  question_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, brief_revision)
);
CREATE INDEX IF NOT EXISTS research_tasks_owner ON research_tasks(account_id,run_id);
