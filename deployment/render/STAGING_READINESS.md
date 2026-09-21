# Norrow protected-staging deployment preparation

Evidence date: 2026-09-21 UTC. Scope: takeover §9 / AGENTS security and evidence gates. This is a deployment-asset change and read-only provider inventory, not a deployed or accepted application. Source base: `460df0f69ce3cb398b1fd7c77ed62a624da65a30`. The tested deployment commit and combined application SHA must be recorded separately after integration.

## Current provider readback

Official Render Public API `GET` calls authenticated from the existing project environment returned HTTP 200 without printing credentials, connection URLs, response bodies or customer data:

| Resource | Exact current readback |
| --- | --- |
| Workspace/project | `tea-dao7f3740ujc73e6rdag` / `prj-dao8rh3m8hqs73do2ag0` |
| Staging environment | `evm-dao8rh3m8hqs73do2ah0`; `protectedStatus=protected`; cross-environment network isolation enabled; one database, zero services |
| Production environment | `evm-dao8rh3m8hqs73do2ai0`; same protections; one database, zero services |
| Staging PostgreSQL | `dpg-dao8s5jm8hqs73do4cag-a`; available, not suspended; PostgreSQL 16, Oregon, `0.5c-1g`, 5 GB, no HA; external `ipAllowList=[]`; recovery status `AVAILABLE` |
| Production PostgreSQL | `dpg-dao8sfg473hc739d47h0-a`; available, not suspended; PostgreSQL 16, Oregon, `1c-2g`, 10 GB, HA; external `ipAllowList=[]`; recovery status `AVAILABLE` |
| Services | Workspace list returned zero; both environment `serviceIds` arrays are empty. No API, worker, migration job or hosted research journey exists. |

Environment-level ingress still defaults to `0.0.0.0/0`; protection is an operator permission boundary, **not** application request authorization or a private web endpoint. Empty *database* allowlists are separate external-database protection. `AVAILABLE` is not proof of a restore, PITR window or failover. See [Render projects and environments](https://render.com/docs/projects) and [environment variables and secrets](https://render.com/docs/configure-environment-variables).

Clerk Backend API `GET /v1/instance` returned HTTP 200 for `ins_3JcB20N0jPnpXio97hZH6AhPMD6`, still `development`. That endpoint does not disclose the requested sign-in strategy configuration. No authenticated Clerk platform/Dashboard session exists here, so current Apple/Google/email-code state and production-instance configuration are **not verified**. The donor's email-code-disabled observation remains historical. The existing Backend API key is not assumed to grant [Platform API](https://clerk.com/docs/reference/platform-api) or Dashboard settings authority.

## Image and staging sequence

The Docker context now allowlists only root manifests, backend, its declared local packages and Render deployment files. Mobile and signing material do not enter that context. The image copies explicit roots, builds the backend typechecked TypeScript source, supplies Node 20 plus Python 3.12 (matching the existing x86_64 hash-locked parser wheels) and `bubblewrap`, uses a nonroot UID, and starts the real API or worker. The launch scripts do not directly invoke migration; at this base SHA, application entrypoints still do, so the backend-owner change below remains a hard prerequisite. Render's `PORT` takes precedence over `API_PORT` in the web launcher. There is intentionally no image-wide healthcheck: the same image runs a worker without an HTTP listener; set `/ready` as the web service's health path only.

The application-side prerequisite is a dedicated serialized migration command under a migration-only database role, followed by API and worker startup under separate least-privilege DML/queue roles. This source change belongs to the backend owner. A migration must be applied once per accepted schema version before either service starts; do not put it in both service start commands or both predeploy hooks. Retain an existing-schema compatibility assertion in API/worker. Keep `DATABASE_URL` values service-scoped and out of build arguments, image layers, files, and logs.

After an approved service-spend/deployment decision, provision only staging services in the existing staging environment: one web API using `start-api.sh`, one background worker using `start-worker.sh`, and a separately serialized migration operation from the same reviewed image. Pin exact source/image/configuration identities. Disable automatic deploys during initial protected verification. Set production-mode authentication only after the Clerk verifier and internal mapping are accepted. Keep fixture, public guest admission, model/retrieval activation and paid allowances default-denied for deterministic tests; an owner-approved bounded live grant is separate. Do not share a migration-owner credential with runtime replicas. Confirm the database connection budget against service count and pg-boss pool use before enabling workers. Scope staging secrets to staging; never link production DB or provider credentials.

The web `/ready` check is only readiness when its accepted backend implementation verifies database/schema without writes and without disclosing research content. HTTP 200 or a Docker health status does not prove authentication, guest claim, research quality, extraction, privacy, graceful shutdown or full hosted acceptance. Protected Render environments can still host publicly reachable web services, so work-creating endpoints must fail closed in the app and access to staging test flows must be controlled before any web service is exposed.

## Checks, unresolved observations and rollback

`node --test deployment/render/verify-assets.mjs`: 4/4, exit 0, static context/image-source, POSIX shell syntax and launcher behavior only. `python3 scripts/validate_review.py`: exit 0, review-package structure only; zero application tests. `git diff --check`: exit 0. Docker CLI exists, but `docker info` exits 1 with permission denied on `/var/run/docker.sock`; `ctr version` exits 1 with permission denied on `/run/containerd/containerd.sock`; podman, nerdctl and buildah are absent. No host permission escalation was attempted. Therefore the Docker image has **not** been built or booted; the Python wheel install, nonroot launch, port/listen/readiness, worker SIGTERM drain and actual parser operation inside Render's user-namespace/seccomp policy are unverified. If Render denies `bubblewrap`, extraction must remain unavailable; no unsandboxed fallback is allowed. Test the built image and an actual parser/API/worker flow in a legitimate container environment before deploying an accepted staging application.

No Render service, role, migration, environment group, deploy, domain or public route was created or changed in this lane. No new spending authorization is inferred from existing credentials or databases. Rollback of these source assets is a normal code revert; preserve any admitted records, deletion tombstones, receipts, unknown holds and database resources. Do not delete/resize/suspend the existing Render project or databases as rollback.

Impact review: adds no npm dependency or public schema; packages existing hash-locked Python extraction dependencies into the container and adds OS `bubblewrap`. Security impact is narrower build context and unchanged fail-closed extraction; cost impact is potentially larger image/build duration, not authorized runtime service spend. Independent image/runtime review is still required.
