-- Owned immutable selection basis; no duplicated passage text. Purged with account/source deletion.
CREATE TABLE IF NOT EXISTS evidence_selections (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 run_id uuid NOT NULL REFERENCES runs(id),
 brief_revision integer NOT NULL,
 evidence_revision integer NOT NULL,
 version text NOT NULL,
 question_digest text NOT NULL,
 required_ids jsonb NOT NULL,
 required_digest text NOT NULL,
 candidates jsonb NOT NULL,
 selection jsonb NOT NULL,
 proof_digest text NOT NULL,
 UNIQUE(run_id,brief_revision,evidence_revision,version,required_digest)
);
CREATE INDEX IF NOT EXISTS evidence_selections_owner ON evidence_selections(account_id,run_id);
-- Proof loss must not silently remove the omission/publication obligation.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS evidence_selection_required_revision integer;

ALTER TABLE runs ADD COLUMN IF NOT EXISTS evidence_selection_obligations jsonb NOT NULL DEFAULT '[]';

-- Existing logical actions keep their original request identity, including unknown outcomes.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS evidence_selection_policy text NOT NULL DEFAULT 'legacy-all.v1';
ALTER TABLE runs ALTER COLUMN evidence_selection_policy SET DEFAULT 'whole-passage-selection.v1';
