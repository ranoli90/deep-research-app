-- An admitted target obligation survives removal of its result and scheduling flags.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS verification_required_revision integer;
CREATE TABLE IF NOT EXISTS requested_verifications (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
 parent_run_id uuid NOT NULL REFERENCES runs(id), report_id uuid NOT NULL REFERENCES reports(id), report_version integer NOT NULL,
 claim_id uuid NOT NULL REFERENCES claims(id), claim_revision_id uuid NOT NULL REFERENCES claim_revisions(id),
 brief_revision integer NOT NULL, request_digest text NOT NULL, target jsonb NOT NULL, target_digest text NOT NULL,
 evidence_policy text NOT NULL CHECK(evidence_policy IN ('reuse_snapshot','refresh_sources')), private_note text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','reading','checked','blocked','unknown')),
 source_map jsonb NOT NULL DEFAULT '[]', model_intent_id uuid REFERENCES provider_intents(id),
 evidence_revision integer, context_manifest jsonb, result jsonb, output_claim_id uuid REFERENCES claims(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requested_verification_account ON requested_verifications(account_id);
