# Execution status — application implementation
As of 2026-09-16. This workspace now contains a runnable TypeScript monorepo plus the Revision 3 canonical documents.

## P0 gates
| Gate | Status | Evidence |
|---|---|---|
| P0-D local Postgres/queue + twelve smoke + fencing | implemented and verified | `pnpm test:integration` 15/15 twice; `pnpm p0:launch` twice; postgres:16.10-alpine on 55432; pg-boss 10.0.4 |
| P0-L live model/retrieval | blocked by a named external dependency | No `OPENROUTER_API_KEY` or live retrieval keys; `LIVE_SPEND_CAP_MICRO=0` |
| P0-N iOS | blocked by a named external dependency | Linux host, no Xcode |
| P0-N Android | blocked by a named external dependency | SDK present, no AVD/device online. Structural app + lifecycle unit tests exist |

P0 is **not** fully verified. `all_required_gates_must_pass_for_p0_verified` remains true.

## What exists
- `packages/contracts`, `packages/research-core`, `packages/design`
- `apps/backend` Fastify API + durable pg-boss worker, fixture catalog, OpenRouter adapter (gated)
- `apps/mobile` Expo app: Research, Library, Settings, composer, progress, report, source sheet
- Migrations, Docker Compose Postgres, mechanical import-boundary check
- Development-only bearer sessions; production startup refuses that auth mode

## Not claimed
Hosted Supabase/Render/auth/RLS/storage/pooler parity. Live research quality. Native device journeys. Store purchases or live push. Competitive advantage. Seed eval cases remain unvalidated.

## Next executable task
1. Provide `OPENROUTER_API_KEY` and a non-zero `LIVE_SPEND_CAP_MICRO` to run P0-L.
2. Create/start an Android AVD (system image `android-34;google_apis;x86_64` is installed) and run the Expo app for P0-N Android.
3. Use a macOS/Xcode host for P0-N iOS.
