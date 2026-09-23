-- R12: transactional attachment storage admission.
--
-- Outstanding uploads hold a reservation before any bytes are stored. A
-- reservation is settled in the same transaction as its attachment insert,
-- released when the write fails or is rejected, or expired when the request is
-- abandoned. Committed usage stays derived from `attachments` (deleted_at IS
-- NULL) so no historical row is rewritten and soft-deletion releases storage
-- automatically. Additive only: new table plus partial indexes.
CREATE TABLE IF NOT EXISTS attachment_storage_reservations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  attachment_id uuid REFERENCES attachments(id) ON DELETE CASCADE,
  upload_key_hash text,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','settled','released','expired')),
  admitted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  settled_at timestamptz
);

-- One live reservation per (account, upload key); released/expired rows do not block retries.
CREATE UNIQUE INDEX IF NOT EXISTS attachment_storage_reservations_upload_key
  ON attachment_storage_reservations(account_id, upload_key_hash)
  WHERE upload_key_hash IS NOT NULL AND state IN ('reserved','settled');
CREATE INDEX IF NOT EXISTS attachment_storage_reservations_account_state
  ON attachment_storage_reservations(account_id, state, expires_at);
CREATE INDEX IF NOT EXISTS attachment_storage_reservations_account_admitted
  ON attachment_storage_reservations(account_id, admitted_at);
CREATE INDEX IF NOT EXISTS attachment_storage_reservations_expiry
  ON attachment_storage_reservations(expires_at) WHERE state='reserved';

-- Index-only support for derived per-account and global committed usage.
CREATE INDEX IF NOT EXISTS attachments_active_account_storage
  ON attachments(account_id, size_bytes) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS attachments_active_global_storage
  ON attachments(size_bytes) WHERE deleted_at IS NULL;
