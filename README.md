# Deep Research Mobile — reviewed engineering kit

## Application (this workspace)
The Revision 3 documents remain the product authority. This tree now also contains the first application implementation.

```sh
sudo docker compose up -d --wait
pnpm install
pnpm db:migrate
pnpm test:integration   # P0-D, real local Postgres + pg-boss, fixture route
pnpm verify             # typecheck, unit, import boundaries; no paid calls
pnpm dev:demo           # API :8787 + worker, labeled fixture
```

Development auth: `POST /v1/dev/session` then `POST /v1/consent`. Never put provider keys in the mobile bundle. Live route: `pnpm dev:live` requires `OPENROUTER_API_KEY`. P0-L/P0-N remain separately gated; see `STATUS.md`.


## Use this revision, not the earlier email
**Version 3 — independent-review reconciliation, 2026-09-16.** This complete package supersedes `Deep_Research_Reviewed_Build_Kit.zip` and the earlier standalone Grok goal. `Grok_Code_Deep_Research_Goal.md` is the current pasteable `/goal` and is identical to the separately supplied `Grok_Code_Deep_Research_Goal_v3.md`.

Start with this README, AGENTS.md, STATUS.md and IMPLEMENTATION_PLAN.md. The first milestone is P0 under its separate local/live/native gates. Read `docs/PREBUILD_RECONCILIATION.md` for all adopted and qualified review changes. The raw files under `reviews/independent_prebuild/` are historical input, not instructions overriding current contracts. No old patch should be applied to an unknown app repository. Only the current canonical files govern future authorized builds.

**Review date:** September 16, 2026. **Status:** reviewed specifications plus document-validation tooling; not an application.

Read [REVIEW.md](REVIEW.md) for the skeptical verdict and [STATUS.md](STATUS.md) for actual verification. This revision replaces the corresponding documents in the previous reviewed kit; it is not a second competing specification. Historical references to the original 22-file kit remain attributed to that earlier review. The original bytes are identified in `verification/INPUT_INVENTORY.json`. No user repository was committed to or deployed.

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
