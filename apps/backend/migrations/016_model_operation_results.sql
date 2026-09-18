CREATE TABLE IF NOT EXISTS model_operation_results (
  intent_id uuid PRIMARY KEY REFERENCES provider_intents(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  operation text NOT NULL,
  brief_revision integer NOT NULL,
  evidence_revision integer NOT NULL,
  request_digest text NOT NULL,
  schema_version text NOT NULL,
  prompt_version text NOT NULL,
  policy_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_operation_owner ON model_operation_results(account_id, run_id);
