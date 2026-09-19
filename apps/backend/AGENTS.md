# Backend scoped instructions

Root AGENTS.md applies; these rules cannot weaken it.

**Current status:** API (`src/api/server.ts`) and worker (`src/worker/main.ts`) share this codebase. Production worker executes only gated structured research. Fixtures and the former bounded baseline/adaptive chooser are isolated in `worker/diagnostic-main.ts` for explicit non-production diagnostics; these are not the production evaluation baseline. Session A model governor lives in `src/model-governor/` and does not edit retrieval/`structured-research.ts`. Historical `model_policy_id` replay is fail-closed.

API authorizes and validates; worker executes durable actions; domain modules own writes; adapters isolate SDKs. Preserve consent/cancel/revision fences and atomic budget admission. Test real Postgres/queue transactions and unknown paid outcomes. Read specs/ENGINE_CONTRACTS.md and docs/SECURITY_PRIVACY_COST.md. Do not turn upstream queue delivery into an exactly-once external-spend promise.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook. Admission, live reserves, deletion, and evaluation paths owned here must apply their gates on the shipped API/worker path, not only record them. Governor routing, live reserves, deletion, and evaluation paths owned here must be implemented, not deferred.

## Retrieval worker path

Public search loads owned attachment text and canary tokens into `authorizeDiscoveryQuery`. Do not classify against canaries only. Mixed-document discovery must consult `query_authorizations.kind='approved'` for this query digest and exact private-term set on the structured worker; a throw in `performPublicSearch` is not enough if the worker never reaches it. Approval is an explicit user grant of that proof, never a revision-wide union and never inferred from source text. Approving a pending row consumes it; replay of the same id/digest/terms is idempotent.

`evaluateDiscoveryContinuation` must receive adopted sources, failed-query counts, novelty vs prior source count, evaluated freshness, and attempted source classes. Passing `sources:[]`, `novelty:1`, `freshnessUnmet:false`, `priorFailedQueries:0` makes independence and class-change dead. When evidence is weak, duplicative, or stale, call `nextSourceClass` and pass that class into search expansion.

Persist coverage, origin links, freshness, and reconciliation inside an existing `session.write`. An extra fenced write in the research loop deadlocks with the lease renewer (`accounts`/`runs` `FOR UPDATE`). Coverage belongs on the `discovery_exhausted` emit, not a separate transaction.

Document/web reconciliation must run from `processStructuredResearch` when attachments exist. Tests that `INSERT` `kind='approved'` and then call `persistReconciliation` themselves do not prove the worker path.

Account and source deletion must scrub new retrieval columns (`origin_relation`, `publication_date`) as well as the new tables. Canonical integration migrations: `042_model_portfolio.sql` then `043_retrieval_intelligence.sql` then `044_query_authorization_proof.sql`. Isolated worker DBs may still record historical `042_retrieval_intelligence` / `043_model_portfolio` / `044_retrieval_intelligence` ids. `CREATE TABLE IF NOT EXISTS` does not add uniqueness later; add `CREATE UNIQUE INDEX IF NOT EXISTS` for `ON CONFLICT`.

Counterevidence search identity is the original suffix query after binding validation. Do not send an expanded/stripped string if the challenge receipt digest is the unexpanded query.

Integration tests use one isolated `TEST_DATABASE_URL` at a time. Do not run two vitest integration/extraction processes against the same database. Raise a test timeout only after the case completes in isolation; a 30s default that dies under load is not a product hang, and a hang past 2–3 minutes is not fixed by a larger timeout.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook.

Revision 3: local PostgreSQL/queue satisfies only its executed P0-D correctness scope; hosted auth/storage/pooler behavior needs separate verification. Notification identity, binding epochs and unknown-send outcomes follow ENGINE_CONTRACTS §10. Do not promise external exactly-once effects from outbox uniqueness.
