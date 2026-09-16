# Architecture — modular monolith, explicit research boundary
Owner role: engineering lead. Status: proposed, not source-inspected application code. Reviewed: 2026-09-16.

The original stack direction is retained: TypeScript, React Native/Expo, Fastify, a separate durable worker, PostgreSQL/Supabase authentication/private storage, OpenRouter and an explicit retrieval adapter. Render remains the default API/worker host. No service has been provisioned or compatibility-tested here. OS background constraints and the worker execution model support keeping research off the phone (S38–S39).

## Intended layout
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
Only create code packages when they own real code. The scoped instruction directories in this kit are documentation, not scaffolded implementations. Keep storage, billing and provider modules internal to the backend initially rather than manufacturing ten independent shared packages.

## Allowed dependencies and ownership
Mobile -> public contracts + design. Research-core -> contracts and pure utilities within core. Backend domain modules -> core/contracts and declared ports. Adapters -> port contracts plus the selected SDKs. Backend API/worker composition binds implementations. Contracts import none of those layers. Tests may use explicit test doubles without adding production backdoors.

The runs module owns run/task/checkpoint transitions. Evidence owns source versions/passages/claims/dependencies. Reports owns canonical report versions and publication. Access owns user/consent decisions. Billing owns allowance reservations and settlement. Cross-domain writes occur through explicit services inside a shared transaction where atomicity is required, never hidden direct table writes from another module.

Postgres is the durable source of truth. Use relational dependency/link tables, not a graph database. Object storage contains authorized original/extracted artifacts with retention class and tenant ownership. A queue is execution coordination, not the only copy of business state. pg-boss is the first candidate, but selected Supabase connection mode, permissions and transactional enqueueing must be verified in a real integration test (S40).

## One request, intended trace
1. Native composer preserves the draft and submits an authenticated, idempotent request after consent.
2. API validates identity, brief schema, attachment ownership and server policy; transaction creates run/reservations/outbox or atomically enqueues.
3. Worker claims the run with a lease fence, loads its revision basis and persisted state, and authorizes one action at a time.
4. Model adapter proposes validated actions; retrieval adapter returns provenance plus source text/access limits. The controller persists receipts, evidence and costs.
5. Verification evaluates support and coverage. Report service publishes canonical blocks/citations only if revision, consent and cancellation fences still match.
6. Native snapshot/cursored events reveal actual progress and saved result. Closing the app affects observation, not the worker.
7. A correction creates a revised brief/child run, invalidates affected conclusions and candidate selection where needed, then produces a versioned change result.

This is a proposed trace. No executable request path was available to run in the inspected input.

## Execution strategies
`fixture`: deterministic explicitly labeled local data. `hosted-baseline`: a provider-managed report, with honest limited visibility. `controlled-research`: own iterative controller with accessible evidence and receipts. All render through the same public report contract. Never upgrade citation-only hosted metadata into invented full-text evidence. OpenRouter beta capabilities are adapter-specific and must be probed under an authorized budget (S28).

## Decisions and reversal
See `docs/adr/DECISIONS.md` for chosen/rejected options, evidence that would reverse a choice, migration cost and rollback boundaries. API contracts are versioned. Do not silently replace original run-state labels in a real app: first inspect clients/migrations and introduce an explicit compatibility mapping.

## Canonical detail
`specs/ENGINE_CONTRACTS.md` owns fields, state/publication, controller and dependency semantics. `docs/SECURITY_PRIVACY_COST.md` owns trust, privacy and spend constraints. `docs/CODEBASE_GOVERNANCE.md` owns enforceable boundaries and change review. Avoid repeating the same rule in a new architecture encyclopedia.

## Local correctness before managed deployment
The first P0-D proof may use real local PostgreSQL and the selected queue with the same intended migrations and restricted runtime role. Cloud provisioning is not a transaction-test prerequisite. Hosted pooler/auth/RLS/storage/permissions/network behavior is a distinct integration gate, not inferred from a local database pass. See `IMPLEMENTATION_PLAN.md` for P0-D/P0-L/P0-N and `specs/SETUP_AND_HANDOFF.md` for limits. This qualification changes verification scope, not the proposed production stack.
