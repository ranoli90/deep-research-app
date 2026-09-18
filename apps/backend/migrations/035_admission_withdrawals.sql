-- Prevent delayed admission after an authenticated user resolves an unknown request.
CREATE TABLE IF NOT EXISTS admission_withdrawals (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  withdrawn_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,key_hash)
);
