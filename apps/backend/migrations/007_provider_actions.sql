CREATE TABLE IF NOT EXISTS run_actions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id),
  brief_revision integer NOT NULL,
  logical_key text NOT NULL,
  kind text NOT NULL,
  request_digest text NOT NULL,
  UNIQUE (run_id, logical_key)
);
ALTER TABLE provider_intents ADD COLUMN IF NOT EXISTS action_id uuid REFERENCES run_actions(id);
ALTER TABLE provider_intents ADD COLUMN IF NOT EXISTS scope_key text NOT NULL DEFAULT 'project';
ALTER TABLE provider_intents ADD COLUMN IF NOT EXISTS receipt jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS provider_intent_action_once ON provider_intents(action_id) WHERE action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_intent_budget_scope ON provider_intents(scope_key, run_id);
