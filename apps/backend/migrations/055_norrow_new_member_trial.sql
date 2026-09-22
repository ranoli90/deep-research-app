-- R03: server-owned new-member trial subsidy. Default-deny; the caller only
-- supplies an idempotent grant identity, never the credited amount.
-- Additive only: new policy/ledger tables, one nullable column, and a partial
-- unique index. No historical entitlement row is rewritten.

CREATE TABLE IF NOT EXISTS new_member_trial_policies (
  id text PRIMARY KEY,
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  killed boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  amount_micro bigint NOT NULL CHECK (amount_micro > 0),
  exposure_cap_micro bigint NOT NULL CHECK (exposure_cap_micro >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO new_member_trial_policies
  (id,version,enabled,killed,expires_at,amount_micro,exposure_cap_micro)
VALUES ('norrow-new-member-trial.v1','norrow-new-member-trial.v1',false,true,
  '2026-01-01T00:00:00Z',100000,0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS new_member_trial_ledgers (
  policy_id text PRIMARY KEY REFERENCES new_member_trial_policies(id),
  reserved_micro bigint NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  settled_micro bigint NOT NULL DEFAULT 0 CHECK (settled_micro >= 0),
  held_micro bigint NOT NULL DEFAULT 0 CHECK (held_micro >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO new_member_trial_ledgers(policy_id) VALUES ('norrow-new-member-trial.v1')
ON CONFLICT DO NOTHING;

-- Credited amount is recorded separately from the caller's request fingerprint
-- (entitlements.product). Nullable so historical/operator rows are untouched.
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS amount_micro bigint;

-- One trial per account, independent of the caller-chosen grantRequestId.
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_new_member_trial_once
  ON entitlements(account_id) WHERE source = 'new-member-trial.v1';
