ALTER TABLE provider_intents ADD COLUMN IF NOT EXISTS confirmed_micro bigint;

CREATE TABLE IF NOT EXISTS notification_fanout (
  run_id uuid NOT NULL REFERENCES runs(id),
  completion_epoch bigint NOT NULL,
  binding_epoch bigint NOT NULL,
  device_id text NOT NULL,
  state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, completion_epoch, binding_epoch, device_id)
);

CREATE TABLE IF NOT EXISTS entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  product text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text,
  accepted boolean NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
