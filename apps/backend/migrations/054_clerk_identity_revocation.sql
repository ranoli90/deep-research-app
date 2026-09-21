-- Verified Clerk webhook effects are durable and idempotent; no email-based identity merge.
CREATE TABLE clerk_webhook_receipts (
  event_id text PRIMARY KEY,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clerk_revoked_sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^sess_[A-Za-z0-9]+$'),
  provider_event_id text NOT NULL REFERENCES clerk_webhook_receipts(event_id),
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clerk_deleted_subjects (
  identity_digest text PRIMARY KEY CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
  provider_event_id text NOT NULL REFERENCES clerk_webhook_receipts(event_id),
  deleted_at timestamptz NOT NULL DEFAULT now()
);
