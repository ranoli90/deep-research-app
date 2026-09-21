# RES-02/03/05 local verification — 2026-09-20

Scope: BB-02 / RES-02 / RES-03 / RES-05. Branch `codex/v8-res02-freshness`; base `3116f6e88074b51cd8f222e775ffcb2fdb8d4d9d`. Local Linux, Node 20.20.2, pnpm 9.15.9, PostgreSQL at `127.0.0.1:55432`. Provider transport in worker tests was fabricated and nonbillable. No external network/provider, push, merge, deployment or active/shared service was used.

| Requirement | Command | Exit/result | Artifact/scope |
|---|---|---:|---|
| RES-02/03 pure semantic policy | `pnpm --filter @deep/research-core exec vitest run test/research-coverage.test.ts test/independence-freshness.test.ts test/historical-shortcut-heldout.test.ts --reporter=verbose` | 0; 62/62 | wrong-scope mention; crossed and complete entity×fact pairs; bare expand; prior held-outs |
| Research-core regression | `pnpm --filter @deep/research-core test` | 0; 364/364 | 32 files |
| RES-02/03/05 production worker | `TEST_DATABASE_URL=postgres://…/deep_res020305_final_20260920_183955 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/historical-shortcut-heldout.integration.test.ts -t 'RES-02\|RES-03\|RES-05' --reporter=verbose` | 0; 3/3, 4 skipped | final code; unique isolated database; no forced unresolved fixture |
| Historical worker sibling controls | `TEST_DATABASE_URL=postgres://…/deep_res020305_pairs_full_20260920_185500 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/historical-shortcut-heldout.integration.test.ts --reporter=verbose` | 0; 8/8 | final pair repair; atomic, wrong-scope, crossed-pair, current, resume and readable-page controls |
| First-write + v3/v4 immutable replay | `TEST_DATABASE_URL=postgres://…/deep_res05_persist_final_20260920_183955 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/retrieval-evidence.integration.test.ts -t 'issues an approved public query\|restores valid v3/v4' --reporter=verbose` | 0; 2/2, 18 skipped | final code; valid restore plus semantic/row/JSON-key/owner/version tamper rejection |
| Backend source guard | `pnpm --filter @deep/backend exec vitest run test/token-budget.unit.test.ts` | 0; 9/9 | focused no-source-shortcut guard |
| Types | `pnpm --filter @deep/research-core typecheck`; `pnpm --filter @deep/backend typecheck` | 0; 0 | unsuppressed TypeScript |
| Boundaries | `node scripts/check-boundaries.mjs` | 0; `boundaries=ok` | repository import boundary |
| Canonical docs | `python3 scripts/validate_review.py`; `python3 -m unittest discover -s scripts -p 'test_review_validator.py' -v` | 0; 16/16 | review package validator only |

Independent review rejected heads `3677bd83e028ac6f52d162cf707cd2094793c7c7` and `6eb29dd28fce399c78bfa6d54ff6a2e6b089dc9d`. The first masked incomplete production coverage with a forced fixture. The second accepted an incidental entity mention contrary to assertion scope and recombined independent entity/fact sets. The final repair uses question-bound entity×fact pairs and exercises both failures through the production Evidence Need and limited-publication path. Full `pnpm verify`, the full PostgreSQL suite, hosted/native/release checks, and live model quality were not run and are not claimed.

Observed acceptance:

- RES-02: wrong-scope prose mention cannot cover another entity. Crossed Ardent-founding/Brindle-expansion evidence leaves the opposite pairs unresolved; the Evidence Need stays missing and publication is only `completed_with_limitations` with exact critical-question and criterion disclosures.
- RES-03: undated employee/workforce variants are current; fiscal/FY, quarter, end-of-period and fixed-date variants are historical. The production worker persisted the founding and present employee siblings independently.
- RES-05: a seeded v2 default row retained the same policy identity and meaning. Valid v3/v4 rows replayed exactly; self-consistent wrong semantics, row/JSON mismatch, extra JSON keys, owner mismatch and version mismatch failed closed without overwrite.

Rollback: stop assigning v4 to new runs, but retain v2/v3/v4 readers and admitted rows. Preserve Evidence Needs, consent/cancellation/budget/ownership/deletion/publication fences and unknown holds. Never relabel a stored policy identity.
