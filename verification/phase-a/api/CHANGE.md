# Phase A API/DB/injection change evidence

Requirements: ENG-037, ENG-043, ENG-044, ENG-045.
Base: d0ddbb264b5b93ee123ee37760beb77db926a0dc. Branch: grok-v8/phase-a-api.

Impact review: migration 050 is additive after 046; numbers 047–049 belong to other lanes. Constraints are `IF NOT EXISTS` / DO-block `NOT VALID` FKs and CHECKs on 042–046 audit/retrieval tables (owner-matching `(run_id, account_id)`, SHA-256 query/spend digests, known freshness/reconciliation/source-class/need/candidate enums, model-intent FK). Historical rows are not rewritten. Account/source deletion still DELETE/scrubs these tables; no content UPDATE in 050. No dependency, service, public API, provider route, prompt, or spend default. Source text cannot create query approval, raise budget, or change consent. Production intent remains rules plus a provenance-checked overlay (`RESEARCH_INTENT_CAPABILITY`); no semantic-intent model operation. `planTypedQuery` stays lexicon/standards and must not copy private/source wording into public expansions.

Regression ownership: retrieval-evidence integration covers cross-account/source-granted audit inserts, digest/outcome CHECKs, deletion scrub, and S01 adversarial source text on `performPublicSearch`. P0 S01 fixture path asserts budget, consent, allowance, and query-authorization unchanged. research-core injection, intent-compiler, query-intelligence, and research-beta-intelligence suites own the unit gates.

Rollback: stop applying 050 on new databases; retain readers, deletion, publication, unknown holds, and existing 044 kind/proof constraints. Do not restore unconstrained cross-account audit inserts or treat the intent compiler as a general semantic planner.

Parent session owns canonical STATUS/handoff/acceptance-matrix regen and exact-SHA full verification. This lane does not claim Research Beta, live spend, native, or hosted CI.

## Checks executed (isolated `deep_phase_a_api`, no live spend)

Environment: `TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_phase_a_api`. Fabricated fixture/search transport only.

| Command | Exit | Result |
|---|---|---|
| `pnpm --filter @deep/research-core exec vitest run --config vitest.config.ts test/intent-compiler.test.ts test/research-beta-intelligence.test.ts test/query-intelligence.test.ts test/policy.test.ts` | 0 | 59/59 |
| `pnpm --filter @deep/research-core typecheck && pnpm --filter @deep/backend typecheck` | 0 | |
| `DATABASE_URL=... pnpm --filter @deep/backend db:migrate` (twice) | 0 | 050 idempotent |
| `vitest run --config vitest.integration.config.ts test/retrieval-evidence.integration.test.ts` | 0 | 9/9 |
| `vitest run --config vitest.integration.config.ts test/p0-smoke.integration.test.ts -t S01` | 0 | 1 passed, 15 skipped by filter |
| `vitest run --config vitest.integration.config.ts test/source-deletion.integration.test.ts` | 0 | 7/7 |
| `python3 scripts/validate_review.py` | 0 | ok |

Not run: full PostgreSQL suite, `pnpm verify`, live, native, hosted CI.
