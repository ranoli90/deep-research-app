-- W04: uploaded documents admit up to 8 MiB; their retained extraction artifacts
-- must preserve the same bytes. Public fetch remains separately capped at 1.5 MB.
-- Keep this storage capacity on rollback for admitted artifacts; disable new
-- uploads instead of shrinking the constraint or discarding stored evidence.
DO $$
BEGIN
  ALTER TABLE evidence_artifacts DROP CONSTRAINT IF EXISTS evidence_artifacts_body_check;
  ALTER TABLE evidence_artifacts ADD CONSTRAINT evidence_artifacts_body_check
    CHECK (octet_length(body) <= 8388608);
END $$;
