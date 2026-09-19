# Durable controller, candidate ledger, and per-conclusion challenges

Requirements FP-030 P1, FP-049 P1, FP-051 P0, FP-053 P0. Base `b30073e`. Canonical behavior is ADR067 plus ENGINE_CONTRACTS evidence/controller rules.

User outcome: a crash after query 2 does not treat query 2 as a new discovery attempt; purchase-like tasks inspect and exclude candidates with evidence and reopen exclusions when a budget constraint is relaxed; two consequential conclusions keep independent challenge state. Completeness cannot be asserted by a caller boolean.

Impact checklist: additive migration `046_research_controller_state.sql` after `044_query_authorization_proof.sql` and `045_model_operation_attempts.sql` (search_operations query/source_class, candidates ledger columns, `candidate_ledgers`, `research_evidence_needs`, `conclusion_challenges`). Production worker `processStructuredResearch` reconstructs from search_operations, persists needs/ledger, and executes per-conclusion challenges. Existing `counterevidence_checks` uniqueness is unchanged. Account and source deletion include the new tables. No new dependency, provider route, prompt, or spend default.

Tests: research-core completeness/need-hint/per-conclusion unit controls; PostgreSQL worker tests in `apps/backend/test/wave5-intelligence.integration.test.ts` drive `processRun` (crash/restart discovery, purchase exclude/reopen, two independent challenges). Existing counterevidence execution cases remain.

Rollback: disable new controller-dependent admissions. Retain migration readers, historical search identities, unknown holds, and the one-row counterevidence proof. Never mark completeness from a helper flag.
