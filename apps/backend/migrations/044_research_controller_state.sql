-- Durable research-controller, candidate ledger, and per-conclusion challenge state.
-- Additive after 043_retrieval_intelligence.sql. Purged with account/source deletion.
-- Does not alter counterevidence_checks UNIQUE(run_id, brief_revision, version).

ALTER TABLE search_operations ADD COLUMN IF NOT EXISTS query text;
ALTER TABLE search_operations ADD COLUMN IF NOT EXISTS source_class text;

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS brief_revision integer;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_key text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS feasibility text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS price double precision;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS exclusion_evidence text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ledger_version text;
CREATE UNIQUE INDEX IF NOT EXISTS candidates_run_key ON candidates(run_id, candidate_key) WHERE candidate_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_owner ON candidates(account_id, run_id);

CREATE TABLE IF NOT EXISTS candidate_ledgers (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  brief_revision integer NOT NULL,
  version text NOT NULL,
  universe_complete boolean NOT NULL DEFAULT false,
  completeness_note text NOT NULL,
  searches integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS candidate_ledgers_owner ON candidate_ledgers(account_id, run_id);

CREATE TABLE IF NOT EXISTS research_evidence_needs (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  need_id text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  brief_revision integer NOT NULL,
  version text NOT NULL,
  criterion_key text,
  question text NOT NULL,
  would_establish text NOT NULL,
  preferred_source_classes jsonb NOT NULL,
  weak_substitutes jsonb NOT NULL,
  freshness_required boolean NOT NULL,
  disconfirming text NOT NULL,
  candidate_scope text,
  state text NOT NULL,
  next_action jsonb NOT NULL,
  stop_reason text,
  PRIMARY KEY (run_id, need_id)
);
CREATE INDEX IF NOT EXISTS research_evidence_needs_owner ON research_evidence_needs(account_id, run_id);

CREATE TABLE IF NOT EXISTS conclusion_challenges (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
  brief_revision integer NOT NULL,
  version text NOT NULL,
  conclusion_key text NOT NULL,
  conclusion_text text NOT NULL,
  question_key text NOT NULL,
  would_falsify text NOT NULL,
  likely_source_class text NOT NULL,
  challenged boolean NOT NULL DEFAULT false,
  changed_conclusion boolean,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','challenged','blocked','unknown')),
  outcome text,
  reason text,
  search_intent_id uuid REFERENCES provider_intents(id) ON DELETE SET NULL,
  model_intent_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, brief_revision, conclusion_key)
);
CREATE INDEX IF NOT EXISTS conclusion_challenges_owner ON conclusion_challenges(account_id, run_id);
CREATE UNIQUE INDEX IF NOT EXISTS conclusion_challenges_identity ON conclusion_challenges(run_id, brief_revision, conclusion_key);
