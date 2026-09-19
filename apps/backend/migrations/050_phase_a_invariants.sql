-- ENG-037: additive owner/spend identity constraints on 042–046 audit/retrieval tables.
-- Canonical 050 after 046_research_controller_state.sql. 047–049 belong to other lanes.
-- IF NOT EXISTS / DO blocks; CHECK/FK are NOT VALID so historical rows are not rewritten.
-- Account/source deletion still DELETE/scrubs these tables in application code; no content UPDATE.

CREATE UNIQUE INDEX IF NOT EXISTS runs_id_account ON runs(id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS sources_id_account ON sources(id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS source_versions_id_account ON source_versions(id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS research_tasks_id_account ON research_tasks(id, account_id);

CREATE OR REPLACE FUNCTION pg_temp.phase_a_add_constraint(target_table regclass, constraint_name text, clause text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID', target_table, constraint_name, clause);
  END IF;
END;
$$;

SELECT pg_temp.phase_a_add_constraint('query_authorizations', 'query_authorizations_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('query_authorizations', 'query_authorizations_query_digest_sha256',
  $$CHECK (query_digest ~ '^[0-9a-f]{64}$')$$);
SELECT pg_temp.phase_a_add_constraint('query_authorizations', 'query_authorizations_brief_revision_positive',
  'CHECK (brief_revision > 0)');

SELECT pg_temp.phase_a_add_constraint('source_origin_links', 'source_origin_links_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('source_origin_links', 'source_origin_links_source_account_fk',
  'FOREIGN KEY (source_id, account_id) REFERENCES sources(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('source_origin_links', 'source_origin_links_relation_known',
  $$CHECK (relation IN ('same-document','syndicated','quotes','derived-from','independent-unknown'))$$);

SELECT pg_temp.phase_a_add_constraint('criterion_freshness_policies', 'criterion_freshness_policies_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('criterion_freshness_policies', 'criterion_freshness_policies_class_known',
  $$CHECK (class IN ('price','law','compatibility','historical','science','generic'))$$);

SELECT pg_temp.phase_a_add_constraint('document_web_reconciliations', 'document_web_reconciliations_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('document_web_reconciliations', 'document_web_reconciliations_outcome_known',
  $$CHECK (outcome IN ('confirmed','partially_confirmed','contradicted','outdated','unverifiable','blocked_by_access'))$$);
SELECT pg_temp.phase_a_add_constraint('document_web_reconciliations', 'document_web_reconciliations_query_digest_sha256',
  $$CHECK (public_query_digest IS NULL OR public_query_digest ~ '^[0-9a-f]{64}$')$$);

SELECT pg_temp.phase_a_add_constraint('search_coverage', 'search_coverage_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');

SELECT pg_temp.phase_a_add_constraint('model_operation_attempts', 'model_operation_attempts_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('model_operation_attempts', 'model_operation_attempts_logical_digest_sha256',
  $$CHECK (logical_digest ~ '^[0-9a-f]{64}$')$$);
SELECT pg_temp.phase_a_add_constraint('model_operation_attempts', 'model_operation_attempts_request_digest_sha256',
  $$CHECK (request_digest ~ '^[0-9a-f]{64}$')$$);
SELECT pg_temp.phase_a_add_constraint('model_operation_attempts', 'model_operation_attempts_policy_id_present',
  'CHECK (char_length(policy_id) BETWEEN 1 AND 200)');

SELECT pg_temp.phase_a_add_constraint('model_portfolio_resolutions', 'model_portfolio_resolutions_run_fk',
  'FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('model_portfolio_resolutions', 'model_portfolio_resolutions_account_fk',
  'FOREIGN KEY (account_id) REFERENCES accounts(id)');
SELECT pg_temp.phase_a_add_constraint('model_portfolio_resolutions', 'model_portfolio_resolutions_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('model_portfolio_resolutions', 'model_portfolio_resolutions_admission_present',
  'CHECK (char_length(admission) BETWEEN 1 AND 200)');

SELECT pg_temp.phase_a_add_constraint('search_operations', 'search_operations_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('search_operations', 'search_operations_request_digest_sha256',
  $$CHECK (request_digest ~ '^[0-9a-f]{64}$')$$);
SELECT pg_temp.phase_a_add_constraint('search_operations', 'search_operations_source_class_known',
  $$CHECK (source_class IS NULL OR source_class IN (
    'first-party-pricing','vendor-docs','release-notes','repository-tests','statute-regulator',
    'primary-literature','systematic-review','filings','investor-materials',
    'docs-source-issues-benchmarks','independent-review','community','generic-web'
  ))$$);

SELECT pg_temp.phase_a_add_constraint('candidate_ledgers', 'candidate_ledgers_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('candidate_ledgers', 'candidate_ledgers_brief_revision_positive',
  'CHECK (brief_revision > 0)');

SELECT pg_temp.phase_a_add_constraint('candidates', 'candidates_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('candidates', 'candidates_status_known',
  $$CHECK (status IS NULL OR status IN ('discovered','inspected','eligible','excluded','unresolved'))$$);
SELECT pg_temp.phase_a_add_constraint('candidates', 'candidates_feasibility_known',
  $$CHECK (feasibility IS NULL OR feasibility IN ('satisfies','violates','unknown','not-applicable'))$$);

SELECT pg_temp.phase_a_add_constraint('research_evidence_needs', 'research_evidence_needs_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('research_evidence_needs', 'research_evidence_needs_state_known',
  $$CHECK (state IN ('missing','partial','satisfied','blocked','challenged'))$$);
SELECT pg_temp.phase_a_add_constraint('research_evidence_needs', 'research_evidence_needs_brief_revision_positive',
  'CHECK (brief_revision > 0)');

SELECT pg_temp.phase_a_add_constraint('conclusion_challenges', 'conclusion_challenges_run_account_fk',
  'FOREIGN KEY (run_id, account_id) REFERENCES runs(id, account_id) ON DELETE CASCADE');
SELECT pg_temp.phase_a_add_constraint('conclusion_challenges', 'conclusion_challenges_model_intent_fk',
  'FOREIGN KEY (model_intent_id) REFERENCES provider_intents(id) ON DELETE SET NULL');
SELECT pg_temp.phase_a_add_constraint('conclusion_challenges', 'conclusion_challenges_source_class_known',
  $$CHECK (likely_source_class IN (
    'first-party-pricing','vendor-docs','release-notes','repository-tests','statute-regulator',
    'primary-literature','systematic-review','filings','investor-materials',
    'docs-source-issues-benchmarks','independent-review','community','generic-web'
  ))$$);
SELECT pg_temp.phase_a_add_constraint('conclusion_challenges', 'conclusion_challenges_brief_revision_positive',
  'CHECK (brief_revision > 0)');

DROP FUNCTION pg_temp.phase_a_add_constraint(regclass, text, text);
