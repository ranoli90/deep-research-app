/goal

You are the V8.1 ENGINEERING FIX-PASS owner for `ranoli90/deep-research-app`.

Governing package:
`v8.1-engineering-fix-pass-audit-906c00f.zip`

Read `START_HERE.md` first and follow its read order.

This is NOT a UI redesign phase.

The audited integration checkpoint is:
`906c00fe0190b040b93f16ed7057ea4cd2e5eb95`

`main` must remain:
`8a7b1a997aefc53f8b06497346c0f915e2d455a7`
until the engineering acceptance gates pass.

## PURPOSE

The previous V8.1 session built substantial functionality but live-quality salvage repeatedly weakened unrelated fail-closed contracts.

Your job is to correct the architecture and regressions **at the root cause**, not merely make tests green.

You must:
- verify every audit finding against the current branch because the branch may have moved after the audit;
- mark findings confirmed / already fixed / false-positive with evidence;
- fix every confirmed P0;
- fix every confirmed P1 that affects correctness, privacy, spend, replay, research quality or publication;
- address P2 items that materially block Research Beta;
- preserve the strong systems listed in `07_GOOD_AREAS_PRESERVE.md`;
- regenerate the Research Beta acceptance evidence honestly;
- do not begin the dedicated visual UI phase.

## NON-NEGOTIABLE ARCHITECTURE

### Immutable original question
Never rewrite `originalQuestion` to smuggle clarification into model context.

Pass confirmed constraints/clarifications separately as server-owned structured context.

The DB column and payload must never diverge.

### Revision semantic
Any change that changes research meaning must have a durable revision/identity.

Do not mutate assumptions/source policy/current brief in place while leaving old task/report semantics valid.

### Awaiting input
Persist exactly what input is required:
- input ID
- type/field
- brief/controller revision
- expected scope

Only the matching endpoint may resume it.

### Paid attempt chain
Model logical operations must restore exact provider attempts.

Primary failure → fallback success must persist under the fallback intent.

Fallback unknown must survive restart and HOLD without resend.

No repair after an attempt whose cost/outcome is unknown.

### Public query authority
Unknown terms are NOT user-public.

Every outbound query must be explainable by:
- original user-public term,
- safe application derivation,
- approved private-derived term for this exact query,
- public-evidence-derived term.

Approval must not silently leak to unrelated later queries.

### Durable research controller
Evidence Needs, candidate ledger, source strategies attempted, query/action counts and challenge obligations must survive crash/restart or be deterministically reconstructed.

A helper function with unit tests is not a production capability.

### Candidate completeness
Wire candidate discovery/eligibility/exclusions to the production decision path.

Do not say "best" or "bounded complete" from a caller boolean.

### Falsification
Per-conclusion challenge state must actually execute for consequential conclusions.

The existing single run-level counterevidence check is not sufficient to claim per-conclusion falsification.

### Document/web reconciliation
Lexical overlap is triage only.

Do not label a private claim confirmed/contradicted/outdated authoritatively without scoped semantic evidence verification plus deterministic number/scope/date guards.

### Limited publication
`completed_with_limitations` is not a bypass around coverage.

Every critical unresolved item must be machine-verifiably disclosed.

### Typed activity
The mobile consumer must use the sanitized typed activity DTO as authority.

Do not return/render raw research/prose fields that bypass that contract.

## SPECIFIC HIGH-RISK BUGS

Start by reproducing/fixing:
- FP-001/002 original question/payload split
- FP-003/004/005 revision/task-state drift
- FP-011/012 failover intent/replay
- FP-013 known failure vs unknown financial hold
- FP-014 unknown-cost repair resend
- FP-022 unknown query term provenance
- FP-023/024 approval state and permission reuse
- FP-029 Azure live search still maxResults=3
- FP-033 full-text `readable` false
- FP-043 unknown freshness incorrectly treated satisfied
- FP-051 candidate ledger not wired
- FP-053 falsification not wired
- FP-060 lexical reconciliation overclaim
- FP-062/063 synthesized support/coverage
- FP-068 limited-publication coverage bypass
- FP-077/078 typed activity not authoritative
- FP-101–111 acceptance-matrix false PASS rows
- FP-115/116 current PostgreSQL/calculated-report reds

Do not assume the finding is correct if current code moved. Prove it first.

## NO TEST THEATER

Forbidden:
- changing expected values just to go green,
- increasing timeout to hide root cause,
- skipping/xfailing a regression,
- making model omission count as support,
- making unknown freshness count as fresh,
- converting provider unknown cost to zero,
- retrying unknown attempts,
- deleting historical failure evidence,
- replacing current production path with fixture behavior.

When an old test encodes a bad architecture (for example rewriting originalQuestion), replace it with a stricter invariant test and document why.

## FIX ORDER

Follow `03_FIX_ORDER.md`.

Do not jump to visual polish.

## FINAL VERIFICATION

At one exact final SHA:

1. typecheck
2. research-core units
3. backend units
4. mobile functional units
5. governance/boundaries
6. fresh DB migrations
7. upgrade from current main schema
8. full PostgreSQL integration on a fresh DB
9. repeat full PostgreSQL integration on a second fresh DB
10. extraction
11. focused crash/replay/failover/financial tests
12. deletion/privacy tests
13. live semantic tests only within existing explicit spend authorization
14. rebuild/install Android APK only if functional mobile code changed in a way requiring native proof
15. regenerate acceptance matrix from current evidence

Do not dispatch GitHub Actions if owner instruction still forbids it.

Do not infer new paid authorization.

## MATRIX HONESTY

Use `05_ACCEPTANCE_MATRIX_CORRECTIONS.md` as a red-team starting point.

A gate is not PASS because:
- code exists,
- helper tests pass,
- fixture works,
- old SHA passed,
- an APK predates current logic,
- a comment says it is implemented.

Evidence must correspond to the exact final SHA and the evidence class required by the gate.

## FINAL HANDOFF

Return:
- final branch/SHA
- confirmed audit findings and disposition
- false positives with proof
- exact tests/results
- acceptance matrix
- remaining external blockers
- remaining P2/P3 explicitly deferred to Product Experience/UI or post-Beta

Do not merge `main` until all required engineering gates genuinely pass.
Do not start the visual UI phase.
