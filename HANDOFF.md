# Builder handoff

Working tree: `main` at `74ae4ddf6a0a329f696345476e1ea48b87baf576`. Run `git rev-parse HEAD` after pull.

## Working behavior
- `sudo docker compose up -d --wait` — Postgres 16.10 on **55432**.
- `pnpm db:migrate && pnpm test:integration && pnpm verify && pnpm dev:demo`
- Fixture research: consent → idempotent create → worker persists passages → cited report.
- P1: compatibility questions escalate from review summaries to a vendor matrix (V2-01/V2-02).
- P2: relaxing a 50 EUR cap to 120 EUR discovers Vendor C (V2-04). Dose unit corrections recompute without reopening discovery (V2-05). Unknown dependency completeness forces a bounded full rerun flag (V2-06).
- P3 (fixture/native-structural): attachments, share/flag, clarification continue, follow-up, lease reclaim, writing reserve, freshness/translation, unsigned purchase reject, application-level completion outbox.
- Close/reopen restores token, draft, and last run via `persistSession`/`hydrateOnLaunch`. Library opens a saved run on Research immediately. Cancel during writing is asserted by `pnpm p0:launch`.

## Commands (latest session)
| Command | Exit | Notes |
|---|---|---|
| `pnpm test:integration` | 0 | 69 tests |
| `pnpm verify` | 0 | typecheck, unit, AST boundaries; nonbillable |
| `pnpm --filter @deep/mobile test` | 0 | 20 tests including persist/hydrate round-trip |
| `pnpm p0:launch` | 0, twice | citations resolve; cancel during writing; no late report |
| `pnpm test:e2e:android` / `ios` | 2 | no device / no Xcode |

## Blockers (unchanged)
- **P0-L:** `OPENROUTER_API_KEY` and authorized `LIVE_SPEND_CAP_MICRO>0`.
- **P0-N iOS:** Xcode.
- **P0-N Android:** emulator/device (SDK image on disk is not registered with avdmanager).

## Unresolved
- Device VoiceOver/TalkBack, iOS/Android close/reopen, and purchase sandbox (M01/M02/M11) are not executed on hardware.
- J14 proves application outbox dedupe, not OS push delivery. Live push remains gated.
- S08 rejects unsigned payloads; signed store webhooks need sandbox credentials.
- PDF parser is text-only. Hosted Supabase/Render/auth/RLS/storage/pooler unverified.
- P1/P2/P3 fixture tests are not a competitor win.

## Next
Supply live keys for P0-L, or start an Android emulator for P0-N. Remaining device/purchase/push/hosted gates stay honestly blocked.
