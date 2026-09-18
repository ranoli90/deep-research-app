-- Immutable uploaded bytes are decoded only by the bounded extraction path.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS extraction jsonb;
-- Previous PDF rows may contain pasted notes, not PDF bytes. Never reuse them as parsed PDF.
UPDATE attachments SET processing_state='unsupported', extracted_text=NULL
WHERE mime='application/pdf' AND deleted_at IS NULL AND
  (raw_bytes IS NULL OR substring(raw_bytes FROM 1 FOR 5) <> decode('255044462d','hex'));
