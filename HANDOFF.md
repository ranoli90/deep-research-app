# Builder handoff — implemented application (P0 checkpoint)

Repository: this workspace was initialized from an empty tree plus the Revision 3 kit. Git: initialize locally after this handoff if desired; this session may record `not-a-repository` until the first commit.

## Working behavior
- `docker compose up -d --wait` starts Postgres 16.10 on **55432** (does not use the unrelated `paid-postgres` on 5432).
- `pnpm db:migrate` then `pnpm dev:demo` serves API `:8787` and a durable worker.
- `POST /v1/dev/session` (development only) → `POST /v1/consent` → `POST /v1/runs` with `Idempotency-Key`.
- Fixture route searches/fetches labeled catalog evidence, publishes a cited report whose citation IDs resolve via `GET /v1/sources/:id`.
- Cancel during writing, stale lease, deletion, and idempotent double-create are enforced in shipped publication/admission code.

## Commands actually run
| Command | Exit | Notes |
|---|---|---|
| `pnpm test:integration` | 0, twice | 15 tests including R01,R04,R05,R09,R13,E01,E02,J01,J03,J05,S01,S09 + V2-07/08 + correction |
| `pnpm p0:launch` | 0, twice | real API+worker; citations resolved; cancel → `cancelling` |
| `pnpm verify` | 0 | typecheck, unit, AST boundaries; nonbillable |
| `pnpm eval:live` | not run as pass | would exit 2 without keys |
| `pnpm test:e2e:android` | 2 | no device |
| `pnpm test:e2e:ios` | 2 | no Xcode |

Scratch artifacts (session): `p0-d-tests.log`, `p0-d-launch.log`, `p0-l-blocked.log`, `p0-n-android.log`, `p0-n-ios.log`, `governance.log`, `kit-extract.log`.

## Blockers
- **P0-L:** `OPENROUTER_API_KEY` and authorized `LIVE_SPEND_CAP_MICRO>0`.
- **P0-N iOS:** Xcode/iOS runtime.
- **P0-N Android:** emulator/device. SDK + `android-34` google_apis x86_64 image are installed; no AVD was defined.

## Unresolved defects
- Concurrent leftover pg-boss retries can still deadlock on event insert under load; advisory lock added, not load-tested.
- PDF attachments store provided text only; no real PDF parser yet (disclosed as text-only).
- Expo SDK 54 pins on the mobile package; iOS/Android native dirs are generated at prebuild time, not committed.

## Next
Create an Android AVD and drive consent/input/close-reopen/citation/cancel/correct on device. Do not label P0 fully verified until P0-L and P0-N pass or remain honestly blocked.
