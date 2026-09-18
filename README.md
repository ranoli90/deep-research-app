# Deep Research Mobile

## Application (this workspace)
This repository contains a TypeScript/Expo mobile app, backend API, durable worker and PostgreSQL evidence store. Revision3 product contracts remain applicable, with adopted V6 repairs in the canonical specs. The active milestone is W01–W09, not a public release; see STATUS.md and HANDOFF.md for current scope and evidence.

```sh
sudo docker compose up -d --wait
pnpm install
pnpm db:migrate
pnpm test:integration   # real local PostgreSQL, production controls + labeled historical diagnostics
pnpm verify             # typecheck, unit, import boundaries; no paid calls
pnpm dev:demo           # explicit non-production historical fixture diagnostic
```

Development auth: `POST /v1/dev/session` then `POST /v1/consent`. Never put provider keys in the mobile bundle. The structured live entrypoint `pnpm dev:live` requires a project-authorized key and positive scoped caps; its existence grants no spending authority. Production does not load the historical fixture controller. P0-L/P0-N remain separately gated; see `STATUS.md`.


Explicit claim rechecks create an owned child for the selected report claim, using saved evidence or rereading selected known sources. Saved feedback is not assessed. Results describe inspected-evidence support and retain limitations; ordinary report feedback alone schedules no research. See [ADR037](docs/adr/DECISIONS.md#adr037--requested-claim-checks-preserve-an-immutable-evidence-obligation-2026-09-17) and [engine contracts](specs/ENGINE_CONTRACTS.md) for proof, recovery and rollback boundaries. Local synthetic controls do not establish live-model quality.

## Specification provenance
**Version 3 — independent-review reconciliation, 2026-09-16.** This complete package supersedes `Deep_Research_Reviewed_Build_Kit.zip` and the earlier standalone Grok goal. `Grok_Code_Deep_Research_Goal.md` preserves the original v3 build assignment; the active user assignment and adopted V6 contracts govern current work.

Start with this README, AGENTS.md, STATUS.md and IMPLEMENTATION_PLAN.md. Historical P0 gates remain separately labeled local/live/native; the current internal milestone is W01–W09. Read `docs/PREBUILD_RECONCILIATION.md` for all adopted and qualified review changes. The raw files under `reviews/independent_prebuild/` are historical input, not instructions overriding current contracts. No old patch should be applied to an unknown app repository. Only the current canonical files govern future authorized builds.

**Original review date:** September16,2026. **Current status:** application implementation with scoped verification; the complete V6 research milestone and release gates remain unfinished.

Read [REVIEW.md](REVIEW.md) for the skeptical verdict and [STATUS.md](STATUS.md) for actual verification. This revision replaces the corresponding documents in the previous reviewed kit; it is not a second competing specification. Historical references to the original 22-file kit remain attributed to that earlier review. The original bytes are identified in `verification/INPUT_INVENTORY.json`. That original review made no repository changes or deployment; subsequent application commits and their actual evidence are recorded in EXECUTION_LEDGER.md. No deployment is implied.

## Canonical ownership
| Question | One authoritative document |
|---|---|
| What should the product do and not do? | `PRODUCT.md` |
| Where does code belong? | `ARCHITECTURE.md` |
| What precisely does research execute and persist? | `specs/ENGINE_CONTRACTS.md` |
| How does the mobile experience behave? | `specs/MOBILE_SCREEN_STATES.md` |
| How do future agents avoid degrading the code? | `AGENTS.md` and `docs/CODEBASE_GOVERNANCE.md` |
| What tests must exist? | `specs/ACCEPTANCE_TESTS.md` |
| How do we assess research advantage? | `EVALUATION.md` |
| What is the prioritized next work? | `IMPLEMENTATION_PLAN.md` |
| How do setup, privacy, security and costs work? | `specs/SETUP_AND_HANDOFF.md`, `docs/SECURITY_PRIVACY_COST.md` |
| What is evidence versus conjecture? | `docs/CURRENT_STATE_AUDIT.md`, `research/USER_COMPLAINTS.csv`, `research/SOURCE_NOTES.md` |
| What really ran? | `EXECUTION_LEDGER.md`, `verification/` |

`MASTER_BUILD_PROMPT.md` is now a short entrypoint to those authorities, not a duplicate encyclopedia. Runtime role files share one contract. Scoped AGENTS files describe intended code ownership; their presence does not imply code exists.

## Commands that exist in this kit
```sh
python scripts/validate_review.py
python -m unittest discover -s scripts -p 'test_review_validator.py' -v
```
These validate documentation/data integrity and the validator itself, not research accuracy, native behavior, security, billing or deployment. `verification/COMMANDS.json` distinguishes real commands from proposed application commands. Python 3.10+ with the standard library is sufficient for these checks.

## How to use the revision
Inspect the real repository first if one is supplied. Reconcile existing implementation rather than copying an empty directory layout over working code. Adopt the canonical changes and ADRs through reviewable changes. Start the live vertical slice and benchmark discovery/repair before building a multi-agent platform. Do not publish superiority claims from this kit.

## Reconciliation artifacts and checks
`verification/RECONCILIATION_INPUTS.json` hashes all source inputs. `verification/RECONCILIATION_DECISIONS.json` records every RC disposition. `verification/P0_ACCEPTANCE.json` contains unexecuted milestone gates. `verification/V3_VALIDATION_RESULTS.json` and raw logs record this update's checks. `MANIFEST.json` covers the final files; historical validation/patch receipts are not current application evidence.

The original 42 sources/18 observations remain unchanged. `research/RECONCILIATION_SOURCES.json` separately records the three newly consulted official push references. No comprehensive external re-audit, live provider or native/security test occurred.

## Additional revision-3 artifact checks
```sh
python scripts/validate_builder_handoff.py
python -m unittest discover -s scripts -p 'test_builder_handoff.py' -v
```
These validate the planning package's disposition coverage, preserved input hashes, gate labels and notification-contract wording; they do not execute any application logic. After application implementation, use actual application CI/evidence rather than changing this historical snapshot checker to claim runtime readiness.

Current application implementation and evidence are summarized in `STATUS.md`. ADR048–050 cover recoverable document corrections, the default-deny registered evaluation runner and remote source invalidation. Local synthetic API/parser controls are distinct from paid semantic evaluation, current native acceptance and hosted/release evidence; the internal milestone remains incomplete until its applicable gates pass.

Current bounded native evidence is in `verification/v6/native-current-emulator/`: actual Android debug compilation and synthetic emulator report/source/correction/document-append/share-preview/deletion controls. Model responses are fabricated; this is not semantic quality, physical-device or release acceptance.

ADR051–052 align durable artifact storage with the existing8MiB upload limit and implement registered frozen-PDF evaluation through the owned binary API and actual parser. Official PDFs expose retained unresolved/no-assertion and model-context-limit failures; HTML frozen slots remain unrun. See `verification/v6/frozen-pdf-integrated/` for integrated verification. No paid semantic results or expanded release authority.
