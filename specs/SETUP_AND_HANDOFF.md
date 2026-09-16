# Setup and handoff — revision 3
Owner role: engineering/reliability lead. Status: reviewed instructions. No mobile/backend build system exists in this kit.

## What works here
```sh
python scripts/validate_review.py
python -m unittest discover -s scripts -p 'test_review_validator.py' -v
```
These run with Python 3.10+ standard library. They verify the review’s manifests, references, dates, scenario IDs and command-status honesty plus mutation tests for that validator. They do not test application behavior. See `verification/COMMANDS.json` for all actual/proposed commands and `EXECUTION_LEDGER.md` for results.

## First authorized application setup
Inspect the actual repository and branches, preserve changes, and establish the selected compatible package versions. Use one package manager with a committed lockfile. Implement reproducible workspace, strict type/lint checks and architecture boundaries; create real modules only as code needs them. Avoid an empty package forest.

Provide project-specific configuration for native public client identifiers, server API URL, authentication issuer/audience, Postgres runtime/migration credentials, private storage, queue, model gateway, one retrieval path, cost limits and effective processing policy. Optional notification/purchase/export credentials remain explicitly optional until their features ship. Server secrets must not be Expo public values.

No paid credentials, service creation, production data, store submission or subscription changes are authorized by this review. A no-paid-key fixture mode must be obvious on screen and fail production startup. Use synthetic files and users for development.

## Commands to implement, not commands that already exist
`pnpm doctor`, `pnpm dev:demo`, `pnpm dev:live`, `pnpm db:migrate`, `pnpm db:seed:demo`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e:ios`, `pnpm test:e2e:android`, `pnpm eval:fixture`, `pnpm eval:live`, `pnpm verify`, `pnpm build`.

Register each only after implementation. `verify` is deterministic and nonbillable. Live probes use a separate explicit flag/command with budget and authorized credentials. Doctor checks configuration, identity, DB permissions/schema, queue enqueue/lease/recovery, storage access, provider capabilities and required native callback identifiers. It must not print secrets or return success for missing mandatory checks.

## Minimum native evidence
Actual iOS/Android development builds, device/OS/build ID, launch and authenticated input, research start, app closure, reopen, report/citation inspection, correction, text scaling, offline restoration and deletion. A web preview, screenshot mockup or TypeScript compile does not establish these. Missing Mac/signing/emulator access must be named, not faked.

## Minimum backend evidence
Real selected Postgres/queue configuration with transactional admission, duplicate delivery, lease expiry, cancellation while writing, late outcomes, allowance race and deletion. Record exact database/queue versions, extensions, connection mode, migration/runtime permissions and executed tests; SQLite or a mock is not equivalent. A locally run PostgreSQL/queue instance (for example Docker Compose, with no cloud provisioning) satisfies P0-D database correctness evidence for the paths actually executed. Use the same migration and queue code intended for deployment; environment differences require later parity checks.

Hosted Supabase/Render provisioning is not a prerequisite for these local database tests. Local PostgreSQL alone does not verify managed authentication, RLS/roles, object storage policies, hosted poolers, network or recovery settings. A local auth/storage test implementation must be explicitly development-only, exercise ownership/consent guards and fail production startup; managed-service paths remain unverified until tested. Live model/retrieval evidence and native lifecycle evidence remain separate P0-L/P0-N gates under `IMPLEMENTATION_PLAN.md`. The read-only hosted baseline must expose only capabilities actually received.

## Deploy and operate only when authorized
Use separate API/worker processes with environment-specific config, health/readiness, restricted credentials and documented migrations. Validate restore and tombstone replay. Keep prior report schema readable during rollback. A build pipeline file is not proof of a deployment. Native stores require real accounts/signing/privacy/purchase/review setup and current policy checks.

## Handoff evidence
Include actual base/final commit or not-a-repository, changed requirements, commands/exit codes/environment, artifacts, provider receipts where permitted, known failures, missing inputs, rollback and next concrete task. Update canonical docs once; do not create a second all-in-one handoff bible that contradicts the contracts. Preserve fixture/live distinction throughout.

## Honest blocked status
`blocked by a named external dependency` is a correct reporting outcome, not verified implementation and not failure to comply with autonomy instructions. Missing credentials, budgets, an iOS runtime, a store account, a purchase sandbox or competitor entitlement can block different checks; name the exact check and input, do not label the entire project blocked. Use an available simulator/development environment when sufficient for the claimed check rather than assuming store distribution is required. Continue independent safe work and preserve the unpassed gate. The first-checkpoint scope and three evidence gates are owned by `IMPLEMENTATION_PLAN.md`.

## Additional revision-3 artifact checks
```sh
python scripts/validate_builder_handoff.py
python -m unittest discover -s scripts -p 'test_builder_handoff.py' -v
```
These validate the planning package's disposition coverage, preserved input hashes, gate labels and notification-contract wording; they do not execute any application logic. After application implementation, use actual application CI/evidence rather than changing this historical snapshot checker to claim runtime readiness.
