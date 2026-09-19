-- Durable logical model-operation attempt chain (FP-011/012).
-- Policy-independent logical_digest links primary and availability-failover intents.
-- Replay restores the latest attempt; unknown attempts never advance.
-- Canonical 045 after 043_retrieval_intelligence.sql. Isolated DBs may still record historical 044_retrieval_intelligence; do not reuse 044.
-- Rows are hashes, intent pointers and policy ids only. Purged with account/source deletion.

CREATE TABLE IF NOT EXISTS model_operation_attempts (
  intent_id uuid PRIMARY KEY REFERENCES provider_intents(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  logical_digest text NOT NULL,
  attempt_index integer NOT NULL,
  predecessor_intent_id uuid REFERENCES provider_intents(id) ON DELETE SET NULL,
  reason text NOT NULL,
  request_digest text NOT NULL,
  policy_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempt_index >= 0),
  CHECK (reason IN ('primary', 'availability_failover')),
  CHECK (
    (attempt_index = 0 AND predecessor_intent_id IS NULL AND reason = 'primary')
    OR (attempt_index > 0 AND predecessor_intent_id IS NOT NULL AND reason = 'availability_failover')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS model_operation_attempt_logical_once
  ON model_operation_attempts(run_id, logical_digest, attempt_index);
CREATE INDEX IF NOT EXISTS model_operation_attempt_logical
  ON model_operation_attempts(run_id, account_id, logical_digest, attempt_index DESC);
