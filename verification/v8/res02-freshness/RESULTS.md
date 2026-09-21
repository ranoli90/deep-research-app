# RES-02/03/05 local verification — 2026-09-20

Scope: BB-02 / RES-02 / RES-03 / RES-05. Branch `codex/v8-res02-freshness`; base `3116f6e88074b51cd8f222e775ffcb2fdb8d4d9d`. Local Linux, Node 20.20.2, pnpm 9.15.9, PostgreSQL at `127.0.0.1:55432`. Provider transport in worker tests was fabricated and nonbillable. No external network/provider, push, merge, deployment or active/shared service was used.

| Requirement | Command | Exit/result | Artifact/scope |
|---|---|---:|---|
| RES-02/03 pure semantic policy | `pnpm --filter @deep/research-core exec vitest run test/research-coverage.test.ts test/historical-shortcut-heldout.test.ts test/independence-freshness.test.ts --reporter=verbose` | 0; 63/63 | lowercase/case-mixed/list subjects, ambiguous-plural fail-close, entity×fact binding, fiscal/current held-outs, exact v2 classification |
| Research-core regression | `pnpm --filter @deep/research-core test` | 0; 365/365 | 32 files |
| Historical worker siblings | `TEST_DATABASE_URL=postgres://…/deep_res020305_final_lower_v2_20260920_1955 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/historical-shortcut-heldout.integration.test.ts --reporter=verbose` | 0; 8/8 | lowercase compound, wrong-scope/crossed-pair Evidence Needs and limited publication, fixed fiscal/current, atomic, v2 resume, readable-page controls |
| First-write + v2/v3/v4 immutable replay | `TEST_DATABASE_URL=postgres://…/deep_res020305_persistence_v2_20260920_1950 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/retrieval-evidence.integration.test.ts -t 'issues an approved public query\|restores valid v2/v3/v4' --reporter=verbose` | 0; 2/2, 18 skipped | authoritative first write; valid legacy v2; wrong question and self-consistent wrong v2 semantics; v3/v4 semantic/row/JSON-key/owner/version tamper rejection |
| Backend source guard | `pnpm --filter @deep/backend exec vitest run test/token-budget.unit.test.ts` | 0; 9/9 | focused no-source-shortcut guard |
| Types | `pnpm typecheck` | 0 | contracts, design, research-core and backend unsuppressed TypeScript |
| Boundaries/governance | `node scripts/check-boundaries.mjs`; `pnpm --filter @deep/backend test:governance` | 0; `boundaries=ok`; 6/6 | repository import and governance controls |
| Canonical docs | `python3 scripts/validate_review.py`; `python3 -m unittest discover -s scripts -p 'test_review_validator.py' -v`; `python3 scripts/validate_builder_handoff.py`; `python3 -m unittest discover -s scripts -p 'test_builder_handoff.py' -v` | 0; 16/16 and 12/12 | review and revision-3 handoff document integrity only |

Independent review rejected heads `3677bd83e028ac6f52d162cf707cd2094793c7c7`, `6eb29dd28fce399c78bfa6d54ff6a2e6b089dc9d`, and `7a4d70fb9df8d98157fe78c587a91ccb4d8545d9`. The first masked incomplete production coverage with a forced fixture. The second accepted an incidental entity mention contrary to assertion scope and recombined independent entity/fact sets. The third remained capitalization-dependent and accepted self-consistent wrong v2 semantics. The final repair exercises these classes through production Evidence Needs, limited publication and database restore. Full `pnpm verify`, the full PostgreSQL suite, hosted/native/release checks, and live model quality were not run and are not claimed.

Observed acceptance:

- RES-02: lowercase/list compound subjects derive bound obligations. Wrong-scope prose cannot cover another entity. Crossed Ardent-founding/Brindle-expansion evidence leaves the opposite pairs unresolved; the Evidence Need stays missing and publication is only `completed_with_limitations` with exact critical-question and criterion disclosures. Unknown plural subjects also fail closed.
- RES-03: undated employee/workforce variants are current; fiscal-year ended/ending, fiscal/FY, quarter, end-of-period and fixed-date variants are historical; explicit current/live wording stays current.
- RES-05: a valid v2 default row retained the same policy identity and meaning. A different question and self-consistent but wrong v2 semantics failed closed. Valid v3/v4 rows replayed exactly; semantic, row/JSON, extra-key, owner and version mismatches failed closed without overwrite.

Rollback: stop assigning v4 to new runs, but retain v2/v3/v4 readers and admitted rows. Preserve Evidence Needs, consent/cancellation/budget/ownership/deletion/publication fences and unknown holds. Never relabel a stored policy identity.
