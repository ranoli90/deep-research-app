# Architecture — modular monolith, explicit research boundary
Owner role: engineering lead. Status: implemented modular monolith with general-research workflow still in progress. Reviewed: 2026-09-17.

The original stack direction is retained: TypeScript, React Native/Expo, Fastify, a separate durable worker, PostgreSQL/Supabase authentication/private storage, OpenRouter and an explicit retrieval adapter. Render remains the default API/worker host. No service has been provisioned or compatibility-tested here. OS background constraints and the worker execution model support keeping research off the phone (S38–S39).

## Code ownership
```text
apps/mobile/                 native routes, screens, feature state and platform adapters
apps/backend/src/api/        authenticated transport; no orchestration logic
apps/backend/src/worker/     leases, checkpoints, runtime composition
apps/backend/src/modules/    runs, evidence, reports, access, billing domain services
apps/backend/src/adapters/   model, retrieval, queue, storage, notifications
apps/backend/src/platform/   redacted telemetry, validated config, common runtime plumbing
packages/contracts/         validated public/internal boundary contracts, no runtime services
packages/research-core/     controller policies, scope, dependencies, report checks
packages/design/            semantic tokens and native primitives
agents/runtime/             versioned role instructions; not six services
specs/                      behavioral contracts and acceptance cases
research/                   external evidence and complaint traceability
specs/features/             small feature packets when actual implementation starts
```
These application packages contain implemented code; scoped AGENTS files add ownership rules. Keep storage, billing and provider modules internal to the backend unless a measured need justifies a new shared package.

## Allowed dependencies and ownership
Mobile -> public contracts + design. Research-core -> contracts and pure utilities within core. Backend domain modules -> core/contracts and declared ports. Adapters -> port contracts plus the selected SDKs. Backend API/worker composition binds implementations. Contracts import none of those layers. Tests may use explicit test doubles without adding production backdoors.

The runs module owns run/task/checkpoint transitions. Evidence owns source versions/passages/claims/dependencies. Reports owns canonical report versions and publication. Access owns user/consent decisions. Billing owns allowance reservations and settlement. Cross-domain writes occur through explicit services inside a shared transaction where atomicity is required, never hidden direct table writes from another module.

Postgres is the durable source of truth. Use relational dependency/link tables, not a graph database. Current local ingestion stores owned original bytes and extracted artifacts in PostgreSQL; legacy disk cleanup is tracked by a durable deletion outbox. Hosted private object storage remains an integration gate. A queue coordinates execution rather than owning business state. pg-boss and the application admission/dispatch outbox are implemented and tested with real local PostgreSQL. Selected hosted Supabase connection mode, permissions and pooler/queue behavior still require separate integration evidence (S40).

## Current production request trace
1. Native composer preserves the draft and submits an authenticated, idempotent request after consent. Identity, ownership and processing capability are server decisions.
2. API validates identity, brief schema, attachment ownership, consent and allowance; one transaction creates the run, reservation and durable dispatch outbox entry.
3. The production worker acquires a unique attempt lease and heartbeat. `run-lifecycle.ts` and `FencedSession` enforce current owner, account, brief revision, cancellation/deletion and fence checks. Provider/network I/O occurs outside database transactions.
4. `processStructuredResearch` prepares a durable versioned task/criterion specification, ingests owned documents and, when enabled and permitted, performs bounded public discovery and safe source reading. Search results and source-read identities are durable; unknown outcomes do not silently resend. Document-plus-public search stays blocked until an explicit public-query approval flow exists.
5. One structured backend model gateway proposes arbitrary scoped assertions from selected whole passages. Executed support combines model comparison with deterministic binding, access, scope, contradiction, qualification and numeric checks keyed to exact claim revisions, evidence digests and checker versions. Deterministic scope comparison and planned arithmetic produce typed persisted results; progress events merely describe executed work.
6. Persisted question coverage drives bounded original-question refinement queries. New evidence is extracted and checked again. The generic writer cites checked premises; final prose is checked again and selected arithmetic is rendered from exact proofs. Publication independently revalidates ownership, revisions, support, final coverage and compiled report membership under the current fence. Unsupported sections stay localized limitations; missing support is never satisfied eligibility.
7. Native snapshots/events expose durable progress and saved reports; closing the app does not run or stop server research. Source inspection uses stored access status and locators. Full authenticated current-code native research/source/correction behavior remains to be verified.
8. A typed replacement question creates a child run with explicit snapshot-reuse or refresh policy. Immutable authorized evidence membership can retain exact source versions; child assertions/support are recomputed because dependency completeness is unknown. Public discovery reopens conservatively, and stored report differences determine the change summary.

This is implemented composition, not proof of general research quality. Local API/worker/PDF and corrected arithmetic journeys use fabricated model transport. Counterevidence/challenge execution, general eligibility and semantic applicability, selective correction dependencies, larger evidence selection and held-out same-pipeline evaluation remain open at committed checkpoint `e225988`. Preliminary source-only coverage can still cause unnecessary discovery for arithmetic questions. The two-run corrected arithmetic journey measured 31.860 seconds in the recorded full integration run; repeated proof restoration remains a latency concern.

## Execution strategies and evidence boundary
`controlled-research` uses the production structured executor. `STRUCTURED_MODEL_ENABLED` defaults off, and public discovery has its own default-off activation policy. Disabled production processing fails explicitly; it never falls back to fixtures or the old composer. Existing saved reports remain readable through the canonical report contract. Pinned provider routes, policy/prompt/schema versions, reservations and actual receipt accounting are backend responsibilities; a model proposal cannot authorize execution.

The historical `research-controller.v1`, `selectAdaptiveAction`, `selectBaselineAction`, fixture catalog and scenario composer live behind the separate development-only diagnostic entrypoint. `LIVE_CONTROLLER_KIND=baseline` is a historical diagnostic selector, not a switch for the current production worker. `fixture` and `hosted-baseline` labels remain public/legacy contract vocabulary; they do not establish an implemented competent same-pipeline evaluation arm. The production baseline/candidate comparison required by `EVALUATION.md` is still unfinished. Do not promote hosted citation metadata to full-text evidence or infer live quality from deterministic diagnostic passes.

## Decisions and reversal
See `docs/adr/DECISIONS.md` for chosen/rejected options, evidence that would reverse a choice, migration cost and rollback boundaries. API contracts are versioned. Do not silently replace original run-state labels in a real app: first inspect clients/migrations and introduce an explicit compatibility mapping.

## Canonical detail
`specs/ENGINE_CONTRACTS.md` owns fields, state/publication, controller and dependency semantics. `docs/SECURITY_PRIVACY_COST.md` owns trust, privacy and spend constraints. `docs/CODEBASE_GOVERNANCE.md` owns enforceable boundaries and change review. Avoid repeating the same rule in a new architecture encyclopedia.

## Local correctness before managed deployment
The first P0-D proof may use real local PostgreSQL and the selected queue with the same intended migrations and restricted runtime role. Cloud provisioning is not a transaction-test prerequisite. Hosted pooler/auth/RLS/storage/permissions/network behavior is a distinct integration gate, not inferred from a local database pass. See `IMPLEMENTATION_PLAN.md` for P0-D/P0-L/P0-N and `specs/SETUP_AND_HANDOFF.md` for limits. This qualification changes verification scope, not the proposed production stack.

Production composition: worker/main.ts starts executor.ts through runtime.ts. executor.ts imports structured-research only; run-lifecycle.ts owns shared lease/preflight safety. diagnostic-main.ts/diagnostic-executor.ts preserve the old bounded controller for explicit development diagnostics and reject production environment/auth. dev:demo uses that diagnostic entrypoint; dev:live uses production structured processing and disables fixture admission. Governance traverses runtime imports/re-exports/dynamic imports from API/worker entrypoints to reject fixture/catalog/evaluator reachability.

The older fixture-route PDF integration case explicitly uses the diagnostic executor with actual binary extraction; structured upload/search/correction PDF cases use the production executor. Test runtime labels follow the created run route, and assertions are retained.

Scope comparison: public strict schemas and the deterministic six-field comparison live in contracts/core. Backend scoped evidence owns migration025 and exact-revision result restoration; worker scheduling invokes it inside the existing fenced session. Only the owned revalidated result enters the writer context, with a versioned manifest digest. No new model role, service or client orchestration.

Comparison projection separates durable full results from writer transport: core emits grouped relation vectors referencing a single claim-key dictionary; the backend pins representation through migration026 and revalidates it before model admission. Existing full-format identities remain readable/replayable. This adds no service or provider dependency.

Calculated reports: contracts/core own strict reference-only arithmetic actions and exact arithmetic/rendering. Backend migrations027–029 preserve input revisions, evidence-bound calculation results, canonical proof claims, plan lineage and final calculated coverage. Publication restores the proof against current authorized evidence and renders computed statements as inference with assumptions and citations. Source support remains a separate path; a valid sum does not prove compatible populations, independence or eligibility.

Corrections: migration024 owns immutable run-evidence memberships and change sets. Snapshot reuse references authorized source versions rather than copying evidence or inheriting approvals; full child support recomputation is the conservative policy. Source-specific deletion, granular patch/dependency traversal and real-model corrected-result equivalence remain unfinished. Account deletion includes both original and derived records and takes precedence over report history.

Rollback disables the affected generation/discovery strategy while retaining saved-report readers, provenance, owner/fence/publication gates, receipt reconciliation, unknown reservations and deletion. No rollback may re-enable fixture production routing or treat partial extraction as full reading. Current evidence and release gates belong to `STATUS.md`, `verification/v6/RESULTS.json` and `HANDOFF.md`; this architecture description does not authorize deployment or spending.

Follow-on W02/W03/W08: admission persists a server-owned `research_strategy` inherited by corrections; both registered strategies use identical production tools/writer/checker. Source deletion serializes under the account and affected runs, tombstones original/reused dependencies, purges content and denies future reads/correction admission while retaining financial holds and required-proof markers. Financial generation lookup uses a fixed bounded GET outside transactions; actual receipt mutations share legacy/key/project budget locks with issuance, never revive research content or resend work. ADR026–028 and the engine/security contracts own impacts and rollback.
