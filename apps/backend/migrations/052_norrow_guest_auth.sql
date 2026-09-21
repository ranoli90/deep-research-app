-- ADR079: default-deny guest sponsorship, immutable execution ownership, exact claim control.
-- Only the dedicated migration command may apply this file; API/worker roles read it.

CREATE TABLE IF NOT EXISTS guest_sponsor_policies (
  id text PRIMARY KEY,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  killed boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  exposure_cap_micro bigint NOT NULL CHECK (exposure_cap_micro >= 0),
  per_guest_cap_micro bigint NOT NULL CHECK (per_guest_cap_micro > 0),
  bootstrap_limit_per_risk integer NOT NULL CHECK (bootstrap_limit_per_risk > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO guest_sponsor_policies
  (id,version,enabled,killed,expires_at,exposure_cap_micro,per_guest_cap_micro,bootstrap_limit_per_risk)
VALUES ('norrow-guest-first.v1','norrow-guest-first.v1',false,true,'2026-01-01T00:00:00Z',0,100000,1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS guest_sponsor_ledgers (
  policy_id text PRIMARY KEY REFERENCES guest_sponsor_policies(id),
  settled_micro bigint NOT NULL DEFAULT 0 CHECK (settled_micro >= 0),
  reserved_micro bigint NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  held_micro bigint NOT NULL DEFAULT 0 CHECK (held_micro >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO guest_sponsor_ledgers(policy_id) VALUES ('norrow-guest-first.v1') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS guest_bootstrap_limits (
  policy_id text NOT NULL REFERENCES guest_sponsor_policies(id),
  risk_digest text NOT NULL CHECK (risk_digest ~ '^[0-9a-f]{64}$'),
  day_utc date NOT NULL,
  issued integer NOT NULL DEFAULT 0 CHECK (issued >= 0),
  PRIMARY KEY(policy_id,risk_digest,day_utc)
);

CREATE TABLE IF NOT EXISTS guest_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_owner_account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
  conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id),
  proof_digest text UNIQUE CHECK (proof_digest IS NULL OR proof_digest ~ '^[0-9a-f]{64}$'),
  sponsor_policy_id text NOT NULL REFERENCES guest_sponsor_policies(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','claimed','expired','deleted')),
  accepted_turn_count smallint NOT NULL DEFAULT 0 CHECK (accepted_turn_count IN (0,1)),
  control_version bigint NOT NULL DEFAULT 1 CHECK (control_version > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS guest_contexts_owner_conversation
  ON guest_contexts(execution_owner_account_id,conversation_id);

CREATE TABLE IF NOT EXISTS guest_first_request_receipts (
  guest_context_id uuid NOT NULL UNIQUE REFERENCES guest_contexts(id),
  request_id text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guest_context_id,request_id)
);

CREATE TABLE IF NOT EXISTS guest_sponsor_reservations (
  run_id uuid PRIMARY KEY REFERENCES runs(id),
  guest_context_id uuid NOT NULL REFERENCES guest_contexts(id),
  policy_id text NOT NULL REFERENCES guest_sponsor_policies(id),
  reservation_id uuid NOT NULL UNIQUE REFERENCES reservations(id),
  amount_micro bigint NOT NULL CHECK (amount_micro > 0),
  settled_micro bigint,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','held','settled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (settled_micro IS NULL OR settled_micro >= 0)
);

CREATE TABLE IF NOT EXISTS guest_pending_actions (
  submission_id uuid PRIMARY KEY,
  guest_context_id uuid NOT NULL REFERENCES guest_contexts(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  conversation_version bigint NOT NULL CHECK (conversation_version > 0),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  consent_policy_version text NOT NULL,
  state text NOT NULL DEFAULT 'pending_auth' CHECK (state IN ('pending_auth','authenticating','dismissed','cancelled','claimed','dispatched','rejected','deleted')),
  auth_attempt_id uuid,
  auth_provider text CHECK (auth_provider IS NULL OR auth_provider IN ('apple','google','email_code')),
  attempt_revision bigint NOT NULL DEFAULT 0 CHECK (attempt_revision >= 0),
  auth_control_version bigint,
  auth_guest_consent_epoch bigint,
  expires_at timestamptz NOT NULL,
  member_account_id uuid REFERENCES accounts(id),
  claim_request_id uuid,
  member_conversation_id uuid REFERENCES conversations(id),
  member_run_id uuid REFERENCES runs(id),
  dispatch_receipt_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guest_context_id,submission_id)
);
CREATE INDEX IF NOT EXISTS guest_pending_actions_context ON guest_pending_actions(guest_context_id,state);
ALTER TABLE guest_pending_actions ADD COLUMN IF NOT EXISTS auth_attempt_id uuid;
ALTER TABLE guest_pending_actions ADD COLUMN IF NOT EXISTS auth_provider text;
ALTER TABLE guest_pending_actions ADD COLUMN IF NOT EXISTS attempt_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE guest_pending_actions ADD COLUMN IF NOT EXISTS auth_control_version bigint;
ALTER TABLE guest_pending_actions ADD COLUMN IF NOT EXISTS auth_guest_consent_epoch bigint;
ALTER TABLE guest_pending_actions DROP CONSTRAINT IF EXISTS guest_pending_actions_state_check;
ALTER TABLE guest_pending_actions ADD CONSTRAINT guest_pending_actions_state_check
  CHECK (state IN ('pending_auth','authenticating','dismissed','cancelled','claimed','dispatched','rejected','deleted'));

CREATE TABLE IF NOT EXISTS conversation_control_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_context_id uuid NOT NULL UNIQUE REFERENCES guest_contexts(id),
  guest_conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id),
  member_account_id uuid NOT NULL REFERENCES accounts(id),
  control_version bigint NOT NULL CHECK (control_version > 1),
  member_deletion_epoch bigint NOT NULL,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_control_bindings_member ON conversation_control_bindings(member_account_id,revoked_at);

CREATE TABLE IF NOT EXISTS guest_claim_requests (
  request_id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES guest_pending_actions(submission_id),
  guest_context_id uuid NOT NULL REFERENCES guest_contexts(id),
  member_account_id uuid NOT NULL REFERENCES accounts(id),
  request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  binding_id uuid NOT NULL REFERENCES conversation_control_bindings(id),
  control_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id,member_account_id)
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS claimed_parent_run_id uuid REFERENCES runs(id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS claimed_parent_conversation_id uuid REFERENCES conversations(id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS claimed_control_binding_id uuid REFERENCES conversation_control_bindings(id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS claimed_control_version bigint;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS guest_pending_action_id uuid REFERENCES guest_pending_actions(submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS runs_guest_pending_action_unique ON runs(guest_pending_action_id)
  WHERE guest_pending_action_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS guest_control_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_context_id uuid NOT NULL REFERENCES guest_contexts(id),
  control_version bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('claimed','expired','guest_deleted','member_deletion','member_revoked','consent_revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guest_context_id,control_version,reason)
);
