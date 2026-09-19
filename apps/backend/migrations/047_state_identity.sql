-- ENG-002/003: immutable task planning basis and one exact awaited input.
ALTER TABLE research_tasks ADD COLUMN IF NOT EXISTS planning_manifest_digest text
  CHECK (planning_manifest_digest IS NULL OR planning_manifest_digest ~ '^[a-f0-9]{64}$');
ALTER TABLE runs ADD COLUMN IF NOT EXISTS pending_input_id uuid;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS pending_input_type text CHECK (pending_input_type IN ('clarification','query_authorization'));
ALTER TABLE runs ADD COLUMN IF NOT EXISTS pending_input_revision integer;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pending_input_identity_complete') THEN
ALTER TABLE runs ADD CONSTRAINT pending_input_identity_complete CHECK (
  (pending_input_id IS NULL AND pending_input_type IS NULL AND pending_input_revision IS NULL)
  OR (pending_input_id IS NOT NULL AND pending_input_type IS NOT NULL AND pending_input_revision = brief_revision));
END IF; END $$;
-- No historical model identity, receipt, or approval is rewritten.

-- Establish an input identity for pre-migration pauses, without granting any
-- query permission. Existing pending query proofs retain their exact UUID.
UPDATE runs r SET pending_input_id=COALESCE((SELECT q.id FROM query_authorizations q
  WHERE q.run_id=r.id AND q.brief_revision=r.brief_revision AND q.kind='permission_required'
  ORDER BY q.created_at DESC LIMIT 1),gen_random_uuid()),
  pending_input_type=CASE WHEN EXISTS(SELECT 1 FROM query_authorizations q
    WHERE q.run_id=r.id AND q.brief_revision=r.brief_revision AND q.kind='permission_required') THEN 'query_authorization' ELSE 'clarification' END,
  pending_input_revision=r.brief_revision
WHERE lifecycle='awaiting_input' AND pending_input_id IS NULL;
