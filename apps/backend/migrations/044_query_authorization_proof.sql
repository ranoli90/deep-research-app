-- Exact query-authorization proof. Pending is consumed in place; proofs are per query digest.
-- Canonical 044 after 043_retrieval_intelligence.sql. Isolated worker DBs may still record historical 044_retrieval_intelligence ids.

DELETE FROM query_authorizations a
 USING query_authorizations b
 WHERE a.account_id = b.account_id
   AND a.run_id = b.run_id
   AND a.brief_revision = b.brief_revision
   AND a.query_digest = b.query_digest
   AND a.kind = b.kind
   AND a.kind IN ('permission_required', 'approved')
   AND a.ctid < b.ctid;

DELETE FROM query_authorizations p
 USING query_authorizations a
 WHERE p.account_id = a.account_id
   AND p.run_id = a.run_id
   AND p.brief_revision = a.brief_revision
   AND p.query_digest = a.query_digest
   AND p.kind = 'permission_required'
   AND a.kind = 'approved';

ALTER TABLE query_authorizations DROP CONSTRAINT IF EXISTS query_authorizations_kind_permission;
ALTER TABLE query_authorizations ADD CONSTRAINT query_authorizations_kind_permission CHECK (
  kind IN ('authorized', 'permission_required', 'blocked', 'approved', 'denied')
  AND permission_required = (kind = 'permission_required')
);

CREATE UNIQUE INDEX IF NOT EXISTS query_authorizations_exact_proof
  ON query_authorizations (run_id, brief_revision, query_digest)
  WHERE kind IN ('permission_required', 'approved');
