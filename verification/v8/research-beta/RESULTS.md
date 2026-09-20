# Research Beta acceptance evidence — grok-v8/research-beta-integration

Filled kit `35_ACCEPTANCE_MATRIX.csv` lives next to this file.

| Item | Value |
|---|---|
| Integration branch | `grok-v8/research-beta-integration` |
| Phase A engineering SHA | `f627b2b5e8d6700b76e1bf3fa9ddde556b81436d` |
| Docs HEAD at fill | (commit of this file) |
| Product APK git | historical `2eb385b` — **not this SHA**; Phase A did not change mobile functional code |
| `main` | `8a7b1a997aefc53f8b06497346c0f915e2d455a7` **unmerged** |
| Migrations | `042`…`046` plus Phase A `047_state_identity` `048_provider_admission` `049_retrieval_recovery` `050_phase_a_invariants` |
| Last full PG | **541/541 twice** `deep_v8_pg1` / `deep_v8_pg2` at SHA `f627b2b` |
| `pnpm verify` | EXIT 0 twice (core 312 / backend 240 / mobile 291 / governance 6) at `f627b2b` |
| Extraction | **55/55 EXIT 0** at `f627b2b` |
| Intent NL | **52** unique questions; 32 focused tests EXIT 0 2026-09-19 |

**Research Beta is not declared.** Two genuine external blockers remain: GitHub Actions billing lock (RB-CI-01) and live public-web J1–J12 spend/hold (RB-LIVE-01/02/03). See `EXTERNAL_BLOCKERS.md`.

## Kit 28 / 46–58 (summary)

| spec | result |
|---|---|
| 28 repository | PASS except merge-to-main (blocked) |
| 28 engineering | PASS except hosted CI |
| 28 research live | BLOCKER spend/hold |
| 28 privacy | PASS unit/integration |
| 28 model/cost | PASS; escalation honest |
| 28 product/UI | PASS device matrix; HTTPS-only preview/production |
| 28 honesty | PASS; fixture labeled Sample |
| 46–58 | Implemented on the production path with unit/integration evidence; live parity blocked by spend |

## Do not merge yet

`main` stays at `8a7b1a9`.
