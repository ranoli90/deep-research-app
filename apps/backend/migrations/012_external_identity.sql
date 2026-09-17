-- A provider identity maps to exactly one local owner. Keep the digest after deletion to prevent resurrection.
CREATE TABLE IF NOT EXISTS external_identities (
  identity_digest text PRIMARY KEY CHECK (identity_digest ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_identity_owner_idx ON external_identities(account_id);
