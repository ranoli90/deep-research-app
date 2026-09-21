# Render container deployment preparation validation

Scope: bounded container-preparation evidence only. This does not configure a
Render service, change an environment, deploy code, or establish hosted
readiness.

Tested source SHA: `724637a10f126b1d63191c7d05a06587e2862be4`.

| Requirement | Command | Exit | Result |
| --- | --- | --- | --- |
| Actual backend TypeScript production entrypoints typecheck | `pnpm --filter @deep/backend build` | 0 | The API (`src/api/server.ts`) and durable worker (`src/worker/main.ts`) source used by the new image both pass the repository backend build. |
| Container launch scripts are valid POSIX shell | `sh -n deployment/render/start-api.sh && sh -n deployment/render/start-worker.sh` | 0 | API maps Render `PORT` to the application's strict `API_PORT` config; worker starts the actual worker entrypoint. |
| Runtime launcher exists in the installed workspace | `test -x node_modules/.bin/tsx` | 0 | Launchers do not depend on a runtime Corepack download. |
| Patch is whitespace-safe | `git diff --check` | 0 | No whitespace errors. |
| Local container-engine availability | `docker info --format '{{.ServerVersion}} {{.OSType}}'` | 1 | Docker CLI is installed but this operator cannot access `/var/run/docker.sock`; therefore image build, API listen, healthcheck, and shutdown were **not exercised**. |

The image is deliberately limited to the shipped code: it runs
`apps/backend/src/api/server.ts` or `apps/backend/src/worker/main.ts`, not a
fixture or diagnostic entrypoint. It performs the existing startup migration
path and will fail closed on missing/invalid runtime configuration.

## Current source blockers to a protected Clerk/guest staging deployment

1. `loadConfig` currently requires `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` for `APP_AUTH_MODE=production`; it has no Clerk
   verifier configuration. `buildApp` likewise calls only the Supabase identity
   verifier. A container cannot truthfully provide the requested Clerk runtime
   until the backend-owner integration changes that source path.
2. The worker has no application-level SIGTERM drain/queue-stop handler. An
   orchestrator signal ends the process but this is not evidence of graceful
   worker shutdown. That lifecycle change is backend-owner work, not modified
   by this deployment-preparation lane.
3. There is no accepted service configuration, database role/connection
   secret, deployed migration authority, or approved protected-staging runtime
   configuration. No service was created as a substitute for those gates.

Rollback: do not deploy these files. Removing a later service is a separate
authorized Render operation; reverting this bounded source commit removes only
the container preparation artifacts.
