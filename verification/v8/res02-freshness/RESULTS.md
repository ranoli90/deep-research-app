# RES-02/03/05 local verification — 2026-09-20

Scope: BB-02 / RES-02 / RES-03 / RES-05. Branch `codex/v8-res02-freshness`; base `3116f6e88074b51cd8f222e775ffcb2fdb8d4d9d`. Local Linux, Node 20.20.2, pnpm 9.15.9, PostgreSQL at `127.0.0.1:55432`. Provider transport in worker tests was fabricated and nonbillable. No external network/provider, push, merge, deployment or active/shared service was used.

| Requirement | Command | Exit/result | Artifact/scope |
|---|---|---:|---|
| RES-02/03 pure semantic policy | `pnpm --filter @deep/research-core exec vitest run test/independence-freshness.test.ts test/historical-shortcut-heldout.test.ts` | 0; 45/45 | held-out atomic/compound/current/fixed-date/version controls |
| Research-core regression | `pnpm --filter @deep/research-core test` | 0; 360/360 | 32 files |
| RES-02/03/05 production worker + persistence | `TEST_DATABASE_URL=postgres://…/deep_res020305_exact_20260920_1809 pnpm --filter @deep/backend exec vitest run test/historical-shortcut-heldout.integration.test.ts -t 'RES-02\|RES-03\|RES-05' --reporter=verbose` | 0; 3/3, 4 skipped | unique isolated database `deep_res020305_exact_20260920_1809` |
| Atomic/current worker controls | `TEST_DATABASE_URL=postgres://…/deep_res02_controls_20260920_1759 pnpm --filter @deep/backend exec vitest run test/historical-shortcut-heldout.integration.test.ts -t 'BB02-01\|BB02-03' --reporter=verbose` | 0; 2/2, 5 skipped | unique isolated database `deep_res02_controls_20260920_1759` |
| Backend source guard | `pnpm --filter @deep/backend exec vitest run test/token-budget.unit.test.ts` | 0; 9/9 | focused no-source-shortcut guard |
| Types | `pnpm --filter @deep/research-core typecheck`; `pnpm --filter @deep/backend typecheck` | 0; 0 | unsuppressed TypeScript |
| Boundaries | `node scripts/check-boundaries.mjs` | 0; `boundaries=ok` | repository import boundary |
| Canonical docs | `python3 scripts/validate_review.py`; `python3 -m unittest discover -s scripts -p 'test_review_validator.py' -v` | 0; 16/16 | review package validator only |

The first whole-file PostgreSQL invocation used isolated database `deep_res02_20260920_1752` and was interrupted with exit 130 after three minutes without interim per-test output. No product failure was inferred. Each new case then completed alone in 15–25 seconds, and the exact-source combined RES-02/03/05 run completed 3/3 in 44.67 seconds. Full `pnpm verify`, the full PostgreSQL suite, hosted/native/release checks, and live model quality were not run and are not claimed.

Observed acceptance:

- RES-02: a supported Ardent assertion bound to the shared `founding_dates` key did not satisfy the two-entity task; the Evidence Need stayed unsatisfied, `discovery_exhausted` retained the key, and terminal outcome was not `completed`.
- RES-03: the founding criterion persisted historical/no-freshness-required while the natural present-tense employee criterion persisted nonhistorical/freshness-required and triggered targeted work.
- RES-05: a seeded v2 default row remained the only row with the same policy fields and historical meaning after production-worker resume; no v4 or criterion row overwrote it.

Rollback: stop assigning v4 to new runs, but retain v2/v3/v4 readers and admitted rows. Preserve Evidence Needs, consent/cancellation/budget/ownership/deletion/publication fences and unknown holds. Never relabel a stored policy identity.
