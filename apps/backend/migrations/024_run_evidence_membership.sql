CREATE TABLE IF NOT EXISTS run_evidence_membership (
 run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),
 passage_id uuid NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
 source_version_id uuid NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
 origin_run_id uuid NOT NULL REFERENCES runs(id),
 passage_digest text NOT NULL,
 version_digest text NOT NULL,
 PRIMARY KEY(run_id,passage_id)
);
CREATE TABLE IF NOT EXISTS research_change_sets (
 run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),
 parent_run_id uuid NOT NULL REFERENCES runs(id),
 patch jsonb NOT NULL,
 dependency_completeness text NOT NULL CHECK(dependency_completeness='unknown'),
 reused_passages integer NOT NULL,
 reopen_discovery boolean NOT NULL
);
CREATE OR REPLACE VIEW authorized_run_passages AS
 SELECT p.id,p.source_version_id,p.account_id,p.run_id,p.exact_text,p.locator,p.extraction_method,p.content_hash FROM passages p
 JOIN runs r ON r.id=p.run_id AND r.account_id=p.account_id
 JOIN accounts a ON a.id=p.account_id AND a.deleted_at IS NULL
 JOIN source_versions v ON v.id=p.source_version_id AND v.account_id=p.account_id
 JOIN sources s ON s.id=v.source_id AND s.account_id=p.account_id AND s.run_id=p.run_id
 UNION ALL
 SELECT p.id,p.source_version_id,p.account_id,m.run_id,p.exact_text,p.locator,p.extraction_method,p.content_hash
 FROM run_evidence_membership m
 JOIN runs r ON r.id=m.run_id AND r.account_id=m.account_id
 JOIN accounts a ON a.id=m.account_id AND a.deleted_at IS NULL
 JOIN passages p ON p.id=m.passage_id AND p.account_id=m.account_id AND p.run_id=m.origin_run_id AND p.content_hash=m.passage_digest
 JOIN source_versions v ON v.id=p.source_version_id AND v.id=m.source_version_id AND v.account_id=m.account_id AND v.content_hash=m.version_digest
 JOIN sources s ON s.id=v.source_id AND s.account_id=m.account_id AND s.run_id=p.run_id
 WHERE m.run_id<>p.run_id;
