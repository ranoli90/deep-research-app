# Norrow Render resource journal

Scope: Render infrastructure operator lane for the Norrow guest-first implementation. This journal intentionally excludes credentials, database connection information, user email addresses, request headers, and response bodies that may contain secrets.

## Operator boundary

- Workspace: `tea-dao7f3740ujc73e6rdag` (readback name: Dalton's workspace).
- Mutation authority: this lane only; no API, worker, website, object-storage, deploy, or domain creation.
- Candidate branch/worktree at lane start: `codex/norrow-render-clerk-guest-auth` / `/home/oranolio/Desktop/deep-norrow-render-clerk`.
- Current deployment posture: no public guest admission; no application services will be created in this lane.

## Pre-write inventory — 2026-09-20

| Item | Read operation | Result | State |
| --- | --- | --- | --- |
| Render Public API schema | `GET https://api-docs.render.com/openapi/render-public-api-1.json` | OpenAPI 3.0.2, Render Public API 1.0.0; project, environment and Postgres create/read schemas retrieved. | READBACK_VERIFIED |
| Authorized owners | `GET /v1/owners?limit=100` | One accessible team workspace; ID matches approved workspace. | READBACK_VERIFIED |
| Norrow project | `GET /v1/projects?ownerId=tea-dao7f3740ujc73e6rdag&limit=100` | No project returned. | READBACK_VERIFIED |
| Managed Postgres | `GET /v1/postgres?limit=100` | No instance returned. | READBACK_VERIFIED |
| Environment listing schema behavior | `GET /v1/environments?limit=100` | Rejected with `at least one projectID is required`; no creation attempted. | READBACK_VERIFIED |

## Intended bounded topology

| Scope | Name | Required creation/readback properties |
| --- | --- | --- |
| Project | Norrow | Approved workspace only. |
| Environment | Staging | `protected`, network isolation enabled. Current workspace tier cannot configure a restrictive environment-level IP allowlist; no service is attached. |
| Environment | Production | `protected`, network isolation enabled. Current workspace tier cannot configure a restrictive environment-level IP allowlist; no service is attached. |
| Database | Norrow Staging PostgreSQL | Region `oregon`, PostgreSQL 16, plan `0.5c-1g`, 5 GB, no HA, no disk autoscaling, no pooler, `ipAllowList: []`. |
| Database | Norrow Production PostgreSQL | Region `oregon`, PostgreSQL 16, plan `1c-2g`, 10 GB, HA, no disk autoscaling, no pooler, `ipAllowList: []`. |

The plan/region/version values were checked against the current public schema. The exact recurring price, workspace plan eligibility, HA availability and PITR window are not exposed by the Public API schema and must be established from successful creation/readback or an official authenticated billing/control surface; they are not inferred from historical price notes.

## Mutation receipts

| Time | Operation | Result | Reconciliation |
| --- | --- | --- | --- |
| 2026-09-20 | `POST /v1/projects` with Norrow plus both environments, protected/network-isolated and empty environment `ipAllowList` | `400`: `IP Allow Lists are only available for Enterprise workspaces`. No project ID returned. | Creation halted; project must be re-listed before any revised request. This does **not** alter the managed-Postgres requirement for atomic `ipAllowList: []`, which the Postgres create schema separately supports. |
| 2026-09-20 | Re-listed Norrow projects in the approved workspace | Zero matching projects. | Confirms the rejected request had no partial creation. |
| 2026-09-20 | `POST /v1/projects` (revised after reconciliation, omitting unsupported environment allowlists) | Created project `prj-dao8rh3m8hqs73do2ag0` with environment IDs `evm-dao8rh3m8hqs73do2ah0` (Staging) and `evm-dao8rh3m8hqs73do2ai0` (Production). | Creation acknowledged; readback follows. |
| 2026-09-20 | `GET /v1/projects/prj-dao8rh3m8hqs73do2ag0` and environments by project | Both environments read back as `protected` with `networkIsolationEnabled: true`; no services or databases attached. Render defaulted each environment `ipAllowList` to `0.0.0.0/0`, while its create/update API rejects environment allowlists on this workspace as Enterprise-only. | READBACK_VERIFIED for project, protection and isolation. The permissive environment ingress default is a workspace-tier limitation, not treated as secure or as an external database-control substitute; it is presently non-exposing because no service exists. |
| 2026-09-20 | `POST /v1/postgres` for staging | Created `dpg-dao8s5jm8hqs73do4cag-a` (Norrow Staging PostgreSQL), initially `creating`. Response echoed environment `evm-dao8rh3m8hqs73do2ah0`, Oregon, PostgreSQL 16, `0.5c-1g`, 5 GB, HA off, disk autoscaling off, no pooler and `ipAllowList: []`. | Acknowledge only; status and all fields must be read back before this is marked configured. |
| 2026-09-20 | `POST /v1/postgres` for production | Created `dpg-dao8sfg473hc739d47h0-a` (Norrow Production PostgreSQL), initially `creating`. Response echoed environment `evm-dao8rh3m8hqs73do2ai0`, Oregon, PostgreSQL 16, `1c-2g`, 10 GB, HA on, disk autoscaling off, no pooler and `ipAllowList: []`. | Acknowledge only; status and all fields must be read back before this is marked configured. |
| 2026-09-20 | `GET /v1/postgres/dpg-dao8s5jm8hqs73do4cag-a` | `available`; readback exactly matched Staging environment, Oregon, PostgreSQL 16, `0.5c-1g`, 5 GB, HA false, disk autoscaling false, pooler `none` and `ipAllowList: []`. | READBACK_VERIFIED. |
| 2026-09-20 | `GET /v1/postgres/dpg-dao8sfg473hc739d47h0-a` | `available`; readback exactly matched Production environment, Oregon, PostgreSQL 16, `1c-2g`, 10 GB, HA true, disk autoscaling false, pooler `none` and `ipAllowList: []`. | READBACK_VERIFIED. |
| 2026-09-20 | `GET /v1/postgres/{id}/recovery` | Staging: `AVAILABLE`, recovery starts at `2026-09-21T01:55:19Z`. Production: `BACKUP_NOT_READY`. | Staging provider recovery capability is readback-verified; neither a PITR window nor restore was inferred. Production recovery is not yet ready and no retry/restore is authorized in this lane. |

The current workspace cannot configure environment-level IP allowlists. The supported environment controls to be preserved in a revised request are protection and cross-environment network isolation. No creation response is accepted as final until it is re-read by resource ID and each supported required property is present.

## Security and exposure verification

- The database create requests contained `ipAllowList: []`; both database readbacks returned exactly `[]`.
- Render's current Postgres documentation states that an empty database IP allowlist blocks all external connections. This is a **configuration/readback** denial validation; no external URL, connection credential, or trial connection was retrieved or used.
- Both project environments are protected and network-isolated. Their tier-limited environment-level allowlist remains the provider default `0.0.0.0/0`; that scope is not a database allowlist and no service is attached to either environment. This limitation must be resolved before a public service is ever created, rather than being described as secure ingress.
- No API, worker, website, domain, object store, configuration group, deploy, database role, migration, connection-pool change, or public guest-admission path was created. Consequently, automatic deployment/preview settings, app-level default-deny admission, health checks, alerts and runtime secret scoping are NOT_APPLICABLE/NOT_STARTED—not configured claims.

## Cost boundary

Current Render pricing was checked on 2026-09-20 from `https://render.com/pricing`: Postgres `0.5c-1g` is listed at USD 19/month, `1c-2g` at USD 40/month and storage at USD 0.30/GB-month. Render's HA documentation states the standby has the same compute and storage and is billed accordingly.

| Resource | List-price calculation | Estimated recurring cost |
| --- | --- | --- |
| Staging Postgres | 19 + (5 GB × 0.30) | USD 20.50/month |
| Production Postgres with HA | 2 × (40 + (10 GB × 0.30)) | USD 86.00/month |
| Database subtotal | 20.50 + 86.00 | USD 106.50/month |

These are public list-price estimates, not an invoice or a hard account-wide cap. They exclude workspace subscription, tax, services, build usage, storage outside these database disks, model/search vendors and any later infrastructure.

## Historical foundation-script audit

`reference/previous_render_foundation/provision_foundation.py` was inspected but not executed. Its desired names, staging protection setting and scope no longer match this lane: it proposes an unprotected staging environment, creates unrelated environment groups and changes workspace notification settings, and uses different database names. Its project response ownership assertion expects `ownerId`, while the current project create/read schema returns an `owner` object. It was therefore not reused for live mutations. Its safety ideas (pre-write inventory, no destructive retry and allowlisted evidence) were retained manually.

## Rollback boundary

No destructive rollback was executed. If the owner later directs removal before data is admitted, a separate Render-only change must first verify there are still no services, roles, migrations, backups needing retention, or customer data; then explicitly target the two database IDs before the project ID and read back absence. Do not delete, suspend, resize, or alter these resources as part of this implementation lane without that separate instruction.

## Explicit non-evidence

No external-database connection was made, no role/grant/migration was run, no backup restore/failover was attempted, no application service was deployed, and no public guest path was opened. Those are separate later gates.
