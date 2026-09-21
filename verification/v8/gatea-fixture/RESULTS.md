# FINAL Gate-A fixture alignment evidence

Date: 2026-09-20
Requirement links: W05, W06, BB02, Wave5
Lane: `/home/oranolio/Desktop/deep-v8-gatea-fixture-20260920`
Branch: `codex/v8-gatea-fixture`
Exact base: `c7c68e80416d45a1a7c9ee03bf970c04409cc98e`
Evidence class: local integration fixtures against isolated local PostgreSQL with fabricated/nonbillable transports

## Preserved expected-red baseline

Artifact: `/tmp/deep-gate-a-c7c68e8-20260920-2140/full-integration.log`
Command class: registered backend `test:integration` Gate-A run
Exit: 1
Result: 45/49 files passed; 574/584 tests passed; ten failures across the four repaired fixture files. Independent review classified all ten as test-update defects and zero as production defects. This artifact is retained; it was not rewritten or promoted to passing evidence.

## Changed observable fixture behavior

- W06 positive evidence is scoped separately to Linux and Windows. The added null/mis-scoped control proves incomplete coverage, one bounded new read, exact original-question retry wording, and an open stable `need-platform`.
- Model-gateway complete controls contain exact task, evidence and authoritative scopes for both requested entities. Negative incomplete/missing/tamper/replay/final-coverage/counterevidence/crash invariants remain exercised. The distinct-query scope comparison is asserted after transport completion so a failed assertion cannot be recorded as an unknown provider outcome.
- The independent BB02 heldouts keep independent data and assert exact satisfied/open/freshness need identities before and after restart.
- BB02-03 additionally pins the current-fact freshness publication boundary: run and report remain `completed_with_limitations`, with exact limitation `Required source freshness remains unknown.`
- Wave5 keeps raw durable `queryHint: export`, sends exact `export vendor documentation` once across restart, requires a distinct third query, and excludes `exportable`, `preoffline editing` and `offline editingly` lookalikes.

## Commands and results

1. `pnpm install --offline --frozen-lockfile` — EXIT 0; local store only, zero downloads.
2. `pnpm --filter @deep/backend typecheck` — EXIT 0.
3. First repair run on `deep_gatea_fixture_20260920_2224`: four focused files, EXIT 1, 170/178. This exposed one test query against nonexistent `research_coverage.created_at` and seven stale/misaligned model fixtures; heldout **6/6** and Wave5 **3/3** were already green.
4. Corrected subset on `deep_gatea_fixture_fix2_20260920_2248`: EXIT 1, 8 passed / 1 failed selected, 161 skipped. W06, two model positive controls and all four counterevidence matrix cases passed; the remaining distinct-query failure was traced to an assertion thrown inside the transport and recorded as `writer_outcome_unknown`.
5. `TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_gatea_fixture_distinct_20260920_2255 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/model-gateway.integration.test.ts -t 'unresolved criteria trigger' --reporter=verbose` — EXIT 0, **1/1** selected, 165 skipped.
6. `TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_gatea_fixture_final_20260920_2257 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/correction-rediscovery.integration.test.ts test/model-gateway.integration.test.ts test/historical-shortcut-heldout.independent.integration.test.ts test/wave5-intelligence.integration.test.ts --reporter=dot` — EXIT 0, **4/4 files, 178/178 tests**, 514.25s.
7. `pnpm typecheck` — EXIT 0; contracts, design, research-core and backend.
8. `node scripts/check-boundaries.mjs` — EXIT 0; `boundaries=ok`.
9. `python3 scripts/validate_review.py` — EXIT 0; `ok: true`.
10. `python3 -m unittest discover -s scripts -p 'test_review_validator.py' -v` — EXIT 0; **16/16**.
11. `python3 scripts/validate_builder_handoff.py` — EXIT 0; `ok: true`.
12. `python3 -m unittest discover -s scripts -p 'test_builder_handoff.py' -v` — EXIT 0; **12/12**.
13. Project `pg` client cleanup selected the five exact temporary database names, terminated only sessions attached to those names, dropped them, and verified the exact-name query returned `[]` — EXIT 0.
14. Same-reviewer disposition: REJECT exact `c1f98dea427ec5ff856dc1de0ea112c95911b80d` / tree `e92e45d89741f4e49b301f8fe9477c87dcea5658` solely for omitted BB02-03 publication assertions; no production defect and no other test defect.
15. `TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_gatea_bb0203_20260920_2310 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/historical-shortcut-heldout.independent.integration.test.ts -t 'BB02-03' --reporter=verbose` — EXIT 0, **1/1**, 5 skipped, 16.80s.
16. `TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_gatea_heldout_20260920_2310 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/historical-shortcut-heldout.independent.integration.test.ts --reporter=verbose` — EXIT 0, **6/6**, 99.00s.
17. Project `pg` client cleanup selected the two exact amendment database names, terminated only sessions attached to those names, dropped them, and verified the exact-name query returned `[]` — EXIT 0.

No full 49-file Gate-A run was performed by design.

## Impact and rollback

Only integration tests and canonical evidence/docs changed. No production source, dependency, schema, migration, public contract, prompt, model/provider route, service or database data contract changed; no new impact checklist, ADR or spec revision is required. No live, paid, network-provider, native, EAS, GHA, push or merge command ran. Rollback is the two local fixture/evidence commits to exact base `c7c68e80416d45a1a7c9ee03bf970c04409cc98e`; production behavior and safety fences are unchanged.
