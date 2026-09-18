# Backend scoped instructions

Root AGENTS.md applies; these rules cannot weaken it.

**Current status:** API (`src/api/server.ts`) and worker (`src/worker/main.ts`) share this codebase. Production worker executes only gated structured research. Fixtures and the former bounded baseline/adaptive chooser are isolated in `worker/diagnostic-main.ts` for explicit non-production diagnostics; these are not the production evaluation baseline. Session A model governor lives in `src/model-governor/` and does not edit retrieval/`structured-research.ts`. Historical `model_policy_id` replay is fail-closed.

API authorizes and validates; worker executes durable actions; domain modules own writes; adapters isolate SDKs. Preserve consent/cancel/revision fences and atomic budget admission. Test real Postgres/queue transactions and unknown paid outcomes. Read specs/ENGINE_CONTRACTS.md and docs/SECURITY_PRIVACY_COST.md. Do not turn upstream queue delivery into an exactly-once external-spend promise.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook. Governor routing, live reserves, deletion, and evaluation paths owned here must be implemented, not deferred.

Revision 3: local PostgreSQL/queue satisfies only its executed P0-D correctness scope; hosted auth/storage/pooler behavior needs separate verification. Notification identity, binding epochs and unknown-send outcomes follow ENGINE_CONTRACTS §10. Do not promise external exactly-once effects from outbox uniqueness.
