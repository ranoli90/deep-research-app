# Required changes — prioritized

Reviewed: 2026-09-16. Ranked as: before coding / first vertical slice / before real-user or public release / later experiment / reject. Targets actual supplied paths and hashes recorded in `verification/INPUT_INVENTORY.json` (kit) and the uploaded `Grok_Code_Deep_Research_Goal.md`.

## Before coding

**RC-01 (PBR-01). Reinforce honest-blocked-status permission in the build prompt’s autonomy section.**
File: `Grok_Code_Deep_Research_Goal.md`, end of §9 / start of §10.
Why: the “keep going, don’t stop after scaffolding” framing sits right next to a definition of done that spans native builds, App Store submission, and purchase-sandbox testing — none of which are reachable without supplied credentials. Without an explicit reminder at the point of pressure, a coding agent is more likely to fabricate “implemented and verified” than to report “blocked by a named external dependency,” even though the latter is technically permitted.
Acceptance test: manually re-read §9-§10 and confirm a first-time reader cannot come away believing an honest blocked-status report for a credential-gated item is a failure to “keep going.” No automated test possible for prose; this is a review-gate item, not a code gate.
Exact replacement text: see `PROPOSED_REPLACEMENTS.md` RC-01.

**RC-02 (PBR-02). Add an unmissable first-session scope boundary to the build prompt.**
File: `Grok_Code_Deep_Research_Goal.md`, top of document (before §1).
Why: `IMPLEMENTATION_PLAN.md` already sequences P0 before P1-P4, and §8 of the goal file repeats that sequencing, but it is one paragraph inside a long document. F14 in `docs/CURRENT_STATE_AUDIT.md` already names the risk (native-shell-first execution polishing the wrong loop); the fix belongs at the point highest-leverage for preventing it — the top of the instructions an agent reads first.
Acceptance test: the callout names the exact P0 exit criterion (one live, non-fixture, cancel-and-reopen-safe research request against real Postgres) and states nothing in P3/P4 begins before it. Verify the callout is present and matches `IMPLEMENTATION_PLAN.md`’s P0 description word-for-word in substance.
Exact replacement text: see `PROPOSED_REPLACEMENTS.md` RC-02.

**RC-03 (PBR-03). Clarify that local Postgres/queue infrastructure satisfies P0 “real database” evidence.**
File: `specs/SETUP_AND_HANDOFF.md`, “Minimum backend evidence” section.
Why: as written, an agent without cloud credentials could plausibly stall P0 entirely waiting for hosted Supabase/Render access, which is a deployment concern, not a correctness concern. This is a simplification (removes an unnecessary blocker), not new scope.
Acceptance test: an agent with only local docker access can complete every P0 backend acceptance case (J01-J03, J05, J07 at minimum) without cloud credentials, and the resulting evidence is accepted as satisfying “real Postgres/queue configuration.”
Exact replacement text: see `PROPOSED_REPLACEMENTS.md` RC-03.

## First vertical slice (P0)

**RC-04 (PBR-04). Name the notification dedupe key.**
File: `specs/ENGINE_CONTRACTS.md` §10.
Why: J14 and S12 require deduplication and no uncontrolled alert loop, but no concrete key is specified, leaving an implementer to invent one — which risks inconsistency between the worker’s outbox logic and any later client-side reconciliation.
Acceptance test: J14 as already specified — crash after send but before delivery-mark does not produce a duplicate alert — using `runId + completionEpoch` as the literal dedupe key.
Exact replacement text: see `PROPOSED_REPLACEMENTS.md` RC-04.

**RC-05. Implement the P0 slice exactly as `IMPLEMENTATION_PLAN.md` already scopes it — no new requirement, restated as a build-order gate.**
One backend codebase (API + worker), contracts package, one live model route, one live retrieval route, a clearly labeled fixture route, Postgres schema for runs/evidence/reports, revision-fenced publication, native composer/reader stub sufficient to demonstrate close/reopen.
Acceptance test: `verification/COMMANDS.json`‘s currently-proposed `pnpm doctor`, `pnpm dev:live`, `pnpm test:integration` become real, and R01/R04/R05/R09/R13, E01/E02, J01/J03/J05, S01/S09 (the first deterministic CI suite `specs/ACCEPTANCE_TESTS.md` already names) pass against real Postgres.
Dependency: RC-03 must land first so this isn’t blocked on cloud credentials.

## Before real-user or public release

**RC-06. Complete P1-P3 exactly as sequenced in `IMPLEMENTATION_PLAN.md`** (decisive-evidence controller experiment against a simple baseline; correction-safe incremental research; native answer/evidence experience). No changes proposed to the content of these programs — they are already well-specified and correctly gated behind P0.

**RC-07. Run the twelve-family paired-task experiment in `EVALUATION.md` with real user tasks**, replacing the current draft seeds, before any repair-reduction or citation-precision number is used in marketing or in a go/no-go decision. This is a repetition of `HANDOFF.md`’s own instruction, elevated here because it is the single biggest gap between “specified” and “validated” in the whole kit.

## Later experiment (do not block P0-P3 on these)

**RC-08. Cross-reference `research/COMPETITOR_REVIEW.md`’s Grok row to the `EVALUATION.md` account-entitlement gate** (PBR-06). Documentation-only, no build impact.

**RC-09. Parallel independent-question branches (ADR-003’s “strongest objection”).** Already correctly deferred behind measured evidence; no action needed now.

## Reject

No item in the reviewed kit rises to “reject.” The closest candidate — six always-on runtime-role model calls at launch — is already correctly rejected by the kit itself (`agents/runtime/CONTRACT.md`: “Roles are logical responsibilities, not one service or model call each”). I am not overturning that; I am underlining it, see Simplification 1 in `INDEPENDENT_PREBUILD_REVIEW.md`.

## Minimum sufficient revised build sequence

1. RC-01, RC-02, RC-03 (prompt/spec text fixes — no code, apply before any coding session starts).
1. P0 per `IMPLEMENTATION_PLAN.md`, with RC-04 folded in, using local infrastructure per RC-03 until cloud credentials are authorized.
1. First deterministic CI suite (R01/R04/R05/R09/R13, E01/E02, J01/J03/J05, S01/S09) passing against real Postgres — this is the actual “done” signal for P0, not a compiling screen or a fixture-only demo.
1. Collect real JOB-1/JOB-2 tasks from actual users (blocks P1’s evaluation from being meaningful) — run in parallel with step 2-3, not after.
1. P1 gap-controller experiment (Arm A vs B, gold-evidence diagnostic) using real tasks from step 4.
1. P2 correction-safety work, evaluated against full-rerun baseline.
1. P3 native polish and account lifecycle, evaluated with real device/accessibility testing.
1. P4 CI/governance hardening and cost measurement, started minimally alongside P0 (per `IMPLEMENTATION_PLAN.md`’s own sequencing note) and expanded through the above.