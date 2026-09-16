# Builder handoff

Working tree: `main`. Run `git rev-parse HEAD` for the exact commit after pull.

## Working behavior
- `sudo docker compose up -d --wait` — Postgres 16.10 on **55432**.
- `pnpm db:migrate && pnpm test:integration && pnpm verify && pnpm dev:demo`
- Fixture research: consent → idempotent create → worker persists passages → cited report.
- P1: compatibility questions escalate from review summaries to a vendor matrix (V2-01/V2-02).
- P2: relaxing a 50 EUR cap to 120 EUR discovers Vendor C, which was absent from the tight-budget listing (V2-04). Dose unit corrections recompute without reopening discovery (V2-05). Unknown dependency completeness forces a bounded full rerun flag (V2-06).

## Commands (latest session)
| Command | Exit | Notes |
|---|---|---|
| `pnpm test:integration` | 0, twice | 33 tests (16 P0 smoke + 17 launch-scope) |
| `pnpm verify` | 0 | typecheck, unit, AST boundaries; nonbillable |
| `pnpm test:e2e:android` / `ios` | 2 | no device / no Xcode |

## Blockers (unchanged)
- **P0-L:** `OPENROUTER_API_KEY` and authorized `LIVE_SPEND_CAP_MICRO>0`.
- **P0-N iOS:** Xcode.
- **P0-N Android:** emulator/device (SDK image on disk is not registered with avdmanager).

## Unresolved
- Not every original 90 acceptance ID has an executable test yet.
- PDF parser is text-only; purchases and live push stay gated.
- P1/P2 are fixture-proven only.

## Next
Supply live keys for P0-L, or start an Android emulator for P0-N. Continue converting remaining acceptance IDs on the fixture/Postgres path while those gates stay blocked.
