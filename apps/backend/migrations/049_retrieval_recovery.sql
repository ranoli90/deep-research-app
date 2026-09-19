-- ENG-011/014: durable bounded work and fail-closed abandoned source reads.
ALTER TABLE source_read_operations DROP CONSTRAINT IF EXISTS source_read_operations_state_check;
ALTER TABLE source_read_operations ADD CONSTRAINT source_read_operations_state_check CHECK(state IN ('issued','finished','unknown','failed'));
ALTER TABLE source_read_operations ADD COLUMN IF NOT EXISTS issue_fence integer;
ALTER TABLE source_read_operations ADD COLUMN IF NOT EXISTS failure_reason text;
CREATE TABLE IF NOT EXISTS research_iteration_actions (
 run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),
 brief_revision integer NOT NULL CHECK(brief_revision > 0),
 task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
 input_digest text NOT NULL CHECK(input_digest ~ '^[0-9a-f]{64}$'),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
 PRIMARY KEY(run_id,brief_revision,input_digest),
 UNIQUE(run_id,brief_revision,ordinal)
);
ALTER TABLE source_versions ADD COLUMN IF NOT EXISTS effective_date date;
ALTER TABLE source_versions ADD COLUMN IF NOT EXISTS applicable_version text CHECK(length(applicable_version) <= 160);

CREATE TABLE IF NOT EXISTS source_policy_exclusions (
 run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES accounts(id),
 brief_revision integer NOT NULL CHECK(brief_revision > 0),
 source_version_id uuid NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
 PRIMARY KEY(run_id,brief_revision,source_version_id)
);
CREATE INDEX IF NOT EXISTS research_iteration_actions_owner ON research_iteration_actions(account_id, run_id);
CREATE INDEX IF NOT EXISTS source_policy_exclusions_owner ON source_policy_exclusions(account_id, run_id);

CREATE OR REPLACE VIEW authorized_run_passages AS
 SELECT p.id,p.source_version_id,p.account_id,p.run_id,p.exact_text,p.locator,p.extraction_method,p.content_hash FROM passages p
 JOIN runs r ON r.id=p.run_id AND r.account_id=p.account_id
 JOIN accounts a ON a.id=p.account_id AND a.deleted_at IS NULL
 JOIN source_versions v ON v.id=p.source_version_id AND v.account_id=p.account_id
 JOIN sources s ON s.id=v.source_id AND s.account_id=p.account_id AND s.run_id=p.run_id
 WHERE NOT EXISTS(SELECT 1 FROM source_policy_exclusions x WHERE x.run_id=r.id AND x.account_id=r.account_id AND x.brief_revision=r.brief_revision AND x.source_version_id=v.id)
 UNION ALL
 SELECT p.id,p.source_version_id,p.account_id,m.run_id,p.exact_text,p.locator,p.extraction_method,p.content_hash
 FROM run_evidence_membership m
 JOIN runs r ON r.id=m.run_id AND r.account_id=m.account_id
 JOIN accounts a ON a.id=m.account_id AND a.deleted_at IS NULL
 JOIN passages p ON p.id=m.passage_id AND p.account_id=m.account_id AND p.run_id=m.origin_run_id AND p.content_hash=m.passage_digest
 JOIN source_versions v ON v.id=p.source_version_id AND v.id=m.source_version_id AND v.account_id=m.account_id AND v.content_hash=m.version_digest
 JOIN sources s ON s.id=v.source_id AND s.account_id=m.account_id AND s.run_id=p.run_id
 WHERE m.run_id<>p.run_id AND NOT EXISTS(SELECT 1 FROM source_policy_exclusions x WHERE x.run_id=r.id AND x.account_id=r.account_id AND x.brief_revision=r.brief_revision AND x.source_version_id=v.id);
