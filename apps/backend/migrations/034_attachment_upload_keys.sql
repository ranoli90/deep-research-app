-- Opaque random request identity survives content deletion to reject delayed replay.
-- No bytes, names or content digest are retained in this field.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS upload_key_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS attachments_account_upload_key
  ON attachments(account_id,upload_key_hash) WHERE upload_key_hash IS NOT NULL;
