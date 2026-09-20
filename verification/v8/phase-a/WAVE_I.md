# Phase A Wave I — engineering SHA `f627b2b`

Branch `grok-v8/research-beta-integration`. Worktree `/home/oranolio/Desktop/deep-v8-integration`. **Not merged to `main` (`8a7b1a9`).** No GitHub Actions. No new paid spend. Research Beta is not declared.

Engineering commit: `f627b2b5e8d6700b76e1bf3fa9ddde556b81436d`.

## Commands at this SHA

| Check | Command | DB / env | Result |
|---|---|---|---|
| `pnpm verify` #1 | `pnpm verify` | n/a | EXIT 0; research-core 312; backend unit 240; mobile 291; governance 6/6 |
| `pnpm verify` #2 | `pnpm verify` | n/a | EXIT 0; same counts |
| Fresh migrate | `DATABASE_URL=…/deep_phase_a_fresh_f627 pnpm db:migrate` | `deep_phase_a_fresh_f627` | EXIT 0; 49 `schema_migrations`; tail `050_phase_a_invariants` |
| Upgrade migrate | apply `001`–`046` (no `032`) then `pnpm db:migrate` | `deep_phase_a_upgrade_f627` | EXIT 0; 49 rows including `047`–`050` |
| PG full #1 | `TEST_DATABASE_URL=…/deep_v8_pg1 pnpm --filter @deep/backend test:integration` | `deep_v8_pg1` | **541/541 EXIT 0** (~1063s) |
| PG full #2 | same on `deep_v8_pg2` | `deep_v8_pg2` | **541/541 EXIT 0** (~1140s) |
| Extraction | `EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime TEST_DATABASE_URL=…/deep_v8_extract2 pnpm --filter @deep/backend test:extraction` | `deep_v8_extract2` | **55/55 EXIT 0** |

Logs: `verification/v8/research-beta/logs/*f627b2b*`.

## What this SHA proves

- Requested-verification publication uses restored verification proof, not ranking/candidate completeness.
- Fixture reports disclose current research limitations before `publishReport`.
- Fixture confirmed intents count simulated tariff in `/cost`.
- `conclusionChanged` is assertion add/remove; outcome/limitation text is `reportStateChanged`.
- Ranking prose does not treat “not an exhaustive …” as an unbounded completeness claim.
- Asking what firmware is required does not treat missing `applicable_version` metadata as unmet compatibility freshness.
- Known-zero `failed` live intents do not remain HOLDs; `issued` / `outcome-unknown` still consume the cap.

## Not transferred

Historical PG 505/505 at `d88cf62`, APK `435d1bf` / `2eb385b`, and product SHA `487e08f` are not this SHA’s evidence. Mobile functional code was not changed in Phase A; no new APK.

## External blockers unchanged

- Hosted GitHub Actions owner-declined.
- Live J8/J11 and MC-D01 21,658 µ unknown hold: no new paid spend inferred; hold not released.
- iOS native proof not available on this Linux host.
