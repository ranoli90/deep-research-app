CREATE TABLE IF NOT EXISTS search_operations (
  intent_id uuid PRIMARY KEY REFERENCES provider_intents(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id),
  task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
  brief_revision integer NOT NULL,
  policy_id text NOT NULL,
  request_digest text NOT NULL,
  result jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS search_operations_owner ON search_operations(account_id,run_id);
