# Research Beta acceptance evidence — grok-v8/research-beta-integration

Filled kit `35_ACCEPTANCE_MATRIX.csv` lives next to this file.

| Item | Value |
|---|---|
| Integration branch | `grok-v8/research-beta-integration` |
| Docs HEAD at fill | (commit of this file) |
| Product APK git | `2eb385b871fc0465a0b4a3cfe7d0cd7705f9a7a5` |
| EAS | `7e4b02c8-6118-4307-8dc0-7593690e2a92` |
| APK sha256 | `6ded85d00989a33bc89aeb186261f4d715b7f62de71aaa6781141b3d141df9cb` |
| Device | `10.0.0.167:43417` kunzite_global 25098RA98G |
| `main` | `8a7b1a997aefc53f8b06497346c0f915e2d455a7` **unmerged** |
| Session A | `8abcffdda35f85ff7500f221375d64a24691e435` unchanged |
| Session B | `e0b00df8d945088a623445349ffe2e2dab9da067` (kit pin `d100b86` stale) |
| Session C | `0a694f90660b144fdb975826f7d0353b7d97f092` unchanged |
| Migrations | `042_model_portfolio.sql` then `043_retrieval_intelligence.sql` |
| Last full PG | **475/475 twice** `deep_v8_int5` / `deep_v8_int6` at SHA `09c5633` |
| `pnpm verify` | EXIT 0 (core 231 / backend 223 / mobile 277 / governance 6) at that suite |
| Extraction | 9 passed / 8 skipped frozen |
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
