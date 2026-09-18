-- New uploads are transaction-owned bytes. Legacy disk objects have a durable cleanup queue.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS raw_bytes bytea;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deletion_cleanup_version integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS file_deletion_outbox (
  attachment_id uuid PRIMARY KEY REFERENCES attachments(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  storage_ptr text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','deleting','deleted')),
  attempt_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IN ('unsafe_storage_pointer','storage_unavailable')),
  deleted_at timestamptz
);
-- Replay existing tombstones: earlier deletion did not remove these disk objects.
INSERT INTO file_deletion_outbox (attachment_id, account_id, storage_ptr)
SELECT id, account_id, storage_ptr FROM attachments
WHERE deleted_at IS NOT NULL AND storage_ptr <> '' AND storage_ptr NOT LIKE 'db:%'
ON CONFLICT DO NOTHING;
