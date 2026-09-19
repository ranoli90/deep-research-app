# V8.1 Engineering Fix-Pass Audit — reviewed at `906c00fe0190b040b93f16ed7057ea4cd2e5eb95`

This package is a **read-only forensic audit** of `grok-v8/research-beta-integration` before the dedicated UI phase.

It deliberately reviews the system from a different angle than the V8.1 build prompt:
- immutable product/data invariants,
- crash/replay/idempotency,
- fail-open salvage behavior,
- privacy boundaries,
- provider/cost accounting,
- controller durability,
- production wiring vs helper existence,
- database invariants,
- mobile state truth,
- acceptance-evidence honesty.

It does **not** authorize weakening tests, merging `main`, or starting the visual UI phase.

Read:
1. `00_EXECUTIVE_VERDICT.md`
2. `01_P0_P1_FINDINGS.md`
3. `02_ROOT_CAUSE_MAP.md`
4. `03_FIX_ORDER.md`
5. `04_INVARIANTS_DO_NOT_WEAKEN.md`
6. `05_ACCEPTANCE_MATRIX_CORRECTIONS.md`
7. `06_REQUIRED_TESTS.md`
8. `07_GOOD_AREAS_PRESERVE.md`
9. `08_UI_PHASE_DEFERRED.md`
10. `09_GROK_FIX_PASS_GOAL.md`
11. `FINDINGS.csv`

Audit base:
- integration branch reviewed SHA: `906c00fe0190b040b93f16ed7057ea4cd2e5eb95`
- `main`: `8a7b1a997aefc53f8b06497346c0f915e2d455a7`
- full PG at previous fail-closed checkpoint: 473/480, 7 red
- commit `906c00fe0190b040b93f16ed7057ea4cd2e5eb95` added focused repairs but **no complete full-suite green evidence yet**.
