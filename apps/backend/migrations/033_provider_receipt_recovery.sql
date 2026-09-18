-- Financial records retain only opaque identities and costs, not research content.
CREATE TABLE IF NOT EXISTS provider_receipt_reconciliations (
  intent_id uuid PRIMARY KEY REFERENCES provider_intents(id) ON DELETE CASCADE,
  provider_id text NOT NULL UNIQUE,
  provider_key_scope text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_accounting_repairs (
  intent_id uuid PRIMARY KEY REFERENCES provider_intents(id) ON DELETE CASCADE,
  previous_state text NOT NULL,
  previous_confirmed_micro bigint NOT NULL,
  reason text NOT NULL CHECK(reason='unbacked_estimate'),
  created_at timestamptz NOT NULL DEFAULT now()
);
