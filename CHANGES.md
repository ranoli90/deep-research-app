# Revision map

## Revision 3 — independent-review reconciliation
Supersedes the previously emailed reviewed kit and goal. Dispositions are in `docs/PREBUILD_RECONCILIATION.md` and machine-readable `verification/RECONCILIATION_DECISIONS.json`.

P0-first instructions now separate deterministic/database, live-provider and native proof; preserve minimum governance/security/accessibility; and explicitly permit named blockers without treating them as completion. Local real PostgreSQL is accepted for its executed correctness scope, not managed-service parity. Completion identity, binding-specific outbox records and unknown push outcomes replace an unsupported duplicate-free delivery claim. J02/J14/S12 are clarified without adding scenario IDs. F04/F06 status and Grok entitlement cross-reference are explicit. Submitted reviews are preserved verbatim as non-authoritative input. The standalone goal is now included inside the ZIP to prevent version drift. Original complaint/source data and evaluation seeds are unchanged. Old patch history is retained as historical records, not a patch to apply to an app.


This revision updates the original canonical paths and adds focused owners rather than another parallel master. No actual application source was changed.

## Changed original files
- `AGENTS.md`
- `MASTER_BUILD_PROMPT.md`
- `README.md`
- `agents/development/architecture.md`
- `agents/development/evaluation.md`
- `agents/development/mobile-design.md`
- `agents/development/reliability-cost.md`
- `agents/development/research-engineering.md`
- `agents/development/security-privacy.md`
- `agents/runtime/gap-reviewer.md`
- `agents/runtime/investigator.md`
- `agents/runtime/planner.md`
- `agents/runtime/report-reviewer.md`
- `agents/runtime/synthesizer.md`
- `agents/runtime/verifier.md`
- `research/COMPLAINT_LEADS.csv`
- `research/SOURCE_NOTES.md`
- `specs/ACCEPTANCE_TESTS.md`
- `specs/ENGINE_CONTRACTS.md`
- `specs/MOBILE_SCREEN_STATES.md`
- `specs/SETUP_AND_HANDOFF.md`

## Added material
- `ARCHITECTURE.md`
- `EVALUATION.md`
- `EXECUTION_LEDGER.md`
- `HANDOFF.md`
- `IMPLEMENTATION_PLAN.md`
- `PRODUCT.md`
- `REVIEW.md`
- `STATUS.md`
- `agents/runtime/CONTRACT.md`
- `apps/backend/AGENTS.md`
- `apps/mobile/AGENTS.md`
- `docs/CODEBASE_GOVERNANCE.md`
- `docs/CURRENT_STATE_AUDIT.md`
- `docs/SECURITY_PRIVACY_COST.md`
- `docs/adr/DECISIONS.md`
- `evals/AGENTS.md`
- `evals/cases/review_seed_cases.json`
- `packages/research-core/AGENTS.md`
- `research/COMPETITOR_REVIEW.md`
- `research/COMPLAINT_TO_REQUIREMENT.md`
- `research/OBSERVATIONS.json`
- `research/SOURCES.json`
- `research/USER_COMPLAINTS.csv`
- `scripts/test_review_validator.py`
- `scripts/validate_review.py`
- `verification/CANONICAL_FILES.json`
- `verification/COMMANDS.json`
- `verification/INPUT_INTEGRITY.json`
- `verification/INPUT_INVENTORY.json`
- `verification/PATCH_CHECK.json`
- `verification/VALIDATION_RESULTS.json`
- `verification/validation_stdout.txt`
- `verification/validator_tests.txt`

## Key decisions
The master is now a navigation entrypoint; root/scoped agent instructions avoid repetition; the backend is one codebase; correction semantics include candidate-space changes; privacy deletion overrides historical content retention; 70 original acceptance IDs are preserved and 20 new scenarios are added; benchmark seeds remain explicitly unvalidated. Commands and executed review-tool results are distinguished from proposed application checks.

The separate patch applies to the inside of the exact original specification directory. It is not a safe blind patch against an arbitrary implemented app repository. Inspect/reconcile that repository first. The final MANIFEST describes the revised kit, excluding itself. The patch is shipped beside the kit in the ZIP to avoid self-referential manifest hashing.
