# Pre-build reconciliation — revision 3
**Date:** September 16, 2026. **Outcome:** updated implementation instructions and specifications; not app implementation, native testing, security certification or proof of a research advantage.

## Decision
Proceed to the bounded P0 implementation when the builder has an authorized workspace. The independent reviewer retained the architecture and requested execution/verification clarifications. Those clarifications are applied across the canonical files, not only added to an email. Two suggested formulations needed correction: P0-first must not postpone foundational controls, and a notification key cannot guarantee duplicate-free external delivery.

This package supersedes the previous reviewed ZIP and standalone Grok goal. Use the current `Grok_Code_Deep_Research_Goal.md` plus the canonical ownership map. Original submitted review files remain byte-identical under `reviews/independent_prebuild/`; they are evidence, not instructions to apply blindly.

## Disposition of every requested change
| Request | Adopted result | Authority |
|---|---|---|
| RC-01 / PBR-01: honest blockers | Explicitly permits named external blockers next to autonomy language. Blocked is a correct report, not completed/verified code. Native, live, store and competitor gates have different prerequisites. | Goal §9; AGENTS; setup |
| RC-02 / PBR-02: P0 first | Prominent first-checkpoint block. Do the real research loop before polish, but minimum governance, security, basic accessibility and correction correctness start in P0. P0 is a milestone, not a forced end to an otherwise authorized working session. | Plan first checkpoint; goal lead |
| RC-03 / PBR-03: local Postgres | Real local PostgreSQL/selected queue can prove executed transaction/recovery paths without cloud provisioning. Hosted auth/RLS/storage/pooling still require later parity tests. | Setup; architecture; ADR-007 |
| RC-04 / PBR-04: notification key | Adopt logical `(runId, completionEpoch)` identity with an atomic, monotonic epoch and per-device-binding delivery rows. Reject guaranteed duplicate-free external alerts from that key alone; specify unknown-send behavior and revise J02/J14/S12. | Engine §10; ADR-008; N01–N03 |
| RC-05: exact first slice | Preserve real loop and twelve smoke IDs. Split local deterministic, real live-provider and per-platform native evidence so no fixture pass masquerades as live verification. | Plan; P0_ACCEPTANCE.json |
| RC-06: later programs | Retain P1/P2/P3 sequencing and release gates. Mechanisms that fail controlled evaluation are simplified/removed rather than compulsorily shipped. | Existing plan; evaluation clarification |
| RC-07: real paired tasks | Keep twelve seeds draft/unexecuted. Prepare consented real tasks with independently inspected decisive evidence before meaningful product/competitive conclusions. | Evaluation; handoff |
| RC-08 / PBR-06: Grok gate | Add direct cross-reference from competitor row to the account-entitlement gate; unavailable comparison does not block P0. | Competitor review |
| RC-09: parallel branches | No new feature. Existing conditional, budgeted, evaluated parallelism remains deferred. Six logical roles do not imply six model calls. | ADR-003; runtime contract |
| PBR-05: F04/F06 status | Clarify that cancellation-while-writing and deletion-over-history conflicts are resolved in specification text only; implementation remains unperformed. | Status; audit note; handoff |

## Why RC-04 was not copied literally
The submitted replacement claimed that `runId + completionEpoch` makes a push idempotent regardless of retry and prevents duplicates after a send/receipt crash. A database uniqueness key only controls application records. The provider can accept a send before our receipt is persisted, and the downstream push path has its own semantics. The earlier J14 correctly required bounded retries/no uncontrolled loop, not an absolute zero-duplicate transport claim.

Newly inspected official documentation: Expo describes possible duplicated or missing handoffs (N01); its tickets/receipts document provider acceptance rather than guaranteed device receipt (N02); Apple describes APNs as best effort (N03). These sources support a delivery limitation, not the entire proposed database design. References are in `research/RECONCILIATION_SOURCES.json`:
- N01: https://docs.expo.dev/push-notifications/faq/
- N02: https://docs.expo.dev/push-notifications/sending-notifications/
- N03: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns

Our design choice: create a unique logical completion atomically with report publication, distinguish account/device-binding fan-out, record issued/accepted/rejected/unknown outcomes, reconcile when supported, and suppress an unreconcilable blind resend by default for this optional alert. Foreground report refresh remains authoritative. Collapse/idempotency capabilities must be verified for the chosen transport. Client code cannot always intercept OS display. An already-issued generic alert may still arrive after logout; it must reveal no private content and cannot authorize opening the prior account's report.

Live push delivery is not needed to prove P0 local outbox invariants. It is a later optional native integration, not another credential prerequisite for research.

## Why P0-first was qualified
The review's required-changes file prohibits all P3/P4 work in one passage but later requires minimum P4 alongside P0. Its proposed callout would also defer all accessibility passes. Literal copying would conflict with the reviewed plan's security/governance-first rule and the native controls needed to test P0. This revision adopts scope discipline, not unsafe postponement.

The first checkpoint has three distinct evidence gates: P0-D (local deterministic/database), P0-L (real authorized model/retrieval) and P0-N (actual native lifecycle per platform). Local fixtures can exercise publication/fault handling but cannot prove a real model researches correctly. Twelve smoke tests are a starting set; they are not all application tests, a research benchmark, or proof every P0 invariant holds.

A missing cloud account does not block local PostgreSQL tests. Missing live credentials does block a live claim. A missing iOS execution environment does not invalidate verified Android work, but leaves iOS unverified. Store credentials are not universally required for every simulator check. Honest blockers are recorded per requirement, never promoted to pass.

## Review scope and provenance
The submitted reviewer reports a sampled external check (not all original sources), no application repository, no complaint reproductions and no live security/native/model tests. Its CLAIM VERIFICATION.csv explicitly says the OpenAI governance primary page was not directly fetched for CV-04, despite broader wording in its narrative. We preserve that source and limitation rather than claiming a complete independent source re-audit. The review's raw file-count statement is not our package inventory; exact input hashes and actual counts are recorded programmatically.

We reran the original package/data validator and its nine unit tests before editing, then reran package checks on this revision. These establish only their stated artifact scope. Passing them does not validate other claims by association. Original complaint/source records and all twelve draft cases remain unchanged. Only the three notification references were newly checked externally for this reconciliation; the original 42-source evidence set was not comprehensively refreshed.

Exact status, commands, counts and results are in `EXECUTION_LEDGER.md` and `verification/V3_VALIDATION_RESULTS.json`. Verbatim inputs are hashed in `verification/RECONCILIATION_INPUTS.json`; changed files and before/after hashes are recorded in `verification/V3_CHANGESET.json`. Proposed application commands remain proposed. No app source, migrations, live research, native build, security probe, purchase flow or deployment was created by this update.

## What to give the builder
Use the revision 3 ZIP and standalone revision 3 `/goal` prompt. The ZIP contains that same goal, canonical specifications, current REVIEW.md, original complaint ledger, the submitted review, this reconciliation and verification records. Extra standalone reconciliation/complaint attachments are convenience copies, not different authorities. Do not also attach older kits or stale goals as governing instructions.

Start with README.md, AGENTS.md, STATUS.md, the goal's first-checkpoint block and IMPLEMENTATION_PLAN.md. Inspect any actual repository before adopting the specifications. No old patch against an unknown application should be applied. Preserve the simple mobile design and small backend; the review did not justify an architectural rewrite or additional always-on agents.
