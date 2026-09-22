## LIVE_STATE — integration candidate `3ee41f5` (version-based consentRevision whole-update boundary fix merged) — 2026-09-22

- **Source SHA:** `3ee41f5e54e5ee90f79eca713615226820f5709d` on `codex/norrow-phaseab-integration-20260921`; remote readback `git ls-remote origin codex/norrow-phaseab-integration-20260921` returns the same SHA. Merge is `--no-ff` with parents `feeaba2` (integration) and `c316067` (`norrow/stage1-consent-epoch-fix`); `git merge-base feeaba2 c316067` is `feeaba2`, and the merge tree is byte-identical to `c316067` (`git diff c316067 HEAD` empty), so the merge introduced no content beyond the source branch.
- **Fix review (`feeaba2..c316067`):** exactly six mobile-only paths changed — `apps/mobile/App.tsx`, `apps/mobile/src/state.ts`, `apps/mobile/src/persist.ts`, `apps/mobile/src/constraint-delta.ts`, `apps/mobile/test/constraint-delta.test.ts`, `apps/mobile/test/guest-consent-grant.component.test.tsx`; `git diff --stat feeaba2 c316067 -- ':!apps/mobile'` is empty (no backend, package, contract, schema, migration, prompt or provider-route file).
- **New semantics (`state.ts`):** `UiState.consentRevision` is a monotonic counter; `withConsent(state, granted)` advances it and is called only on a confirmed decision; `mergeConsent(next, latest)` returns the **higher** revision's `consentGranted` (tie keeps `next`, safe because a tie means neither side changed consent). `parseState` normalizes old persisted data (`number`+safe-integer+`≥0`, else `consentGranted ? 1 : 0`). Every consent transition in `App.tsx` routes through `withConsent`/`mergeConsent`/`revokedState` — no direct `consentGranted` write to `UiState` remains except the startup restore (`App.tsx:1709`, see below).
- **Fail-closed proof:** a revocation always advances the revision (`revokedState` +1; remote revocation via `withConsent(..., false)`; member sign-in `withConsent(s,false)`), so a higher-revision revocation wins the boundary in both `saveGuestReader` and member adoption. The old render-sync guard `consentGranted: latest.consentGranted !== consentAtEntry ? …` was replaced by the version boundary plus the `latestUi.current` guard (`App.tsx:147-154`): an echo of a pre-decision frame carries the same lower revision and cannot roll the ref back. No assertion, error boundary, ownership/budget/consent gate or type was loosened; `constraint-delta.ts` only adds the `consentRevision` field/`revokedState` advance.
- **Review concern (non-blocking):** `App.tsx:1709` forces `consentGranted: false` for a guest-under-member restore **without** bumping the revision, so the "same revision ⇒ same value" invariant holds only outside that startup path. It runs once before any in-flight writer exists and moves in the fail-closed direction, so it cannot resurrect consent; flagged as a latent invariant, not a defect.
- **Backend-unchanged proof:** `git diff feeaba29 HEAD -- apps/backend packages` is empty (exit 0); `git diff --name-only feeaba2 HEAD` lists only the six mobile paths above. No backend source change, so no PostgreSQL Gate A/B rerun is required.
- **Gates (local deterministic, 2026-09-22, all exit 0):** `pnpm --filter @deep/mobile typecheck`; `pnpm --filter @deep/mobile test` (**76 files, 696/696**); `node scripts/check-boundaries.mjs` (`boundaries=ok`); `pnpm verify` (research-core, backend unit, mobile **696/696** across 76 files, governance **7/7**, workspace types and boundaries).
- **Remaining owner actions (external, not candidate defects):** (1) EAS rebuild on this candidate `3ee41f5` (prior build `3a6c8b41` predates the react-dom and both consent fixes); (2) on-device visual/functional pass over that build (install/launch/type/submit/navigate, including the guest consent grant/revocation toggle mid-write) — a screenshot does not satisfy this; (3) staging API redeploy and the Clerk Dashboard email/verification configuration from the prior checkpoint.
- **UI gap list / evidence:** `/tmp/opencode/norrow-evidence/ui-review/post-send-review.md` (code-level post-send UI/UX gaps; device-only items still unverified).
- **Leases / bounds:** this worktree only. No `main` merge, no force-push/rebase, no GHA dispatch, and no secret was read, printed or written.
- **Rollback:** revert the merge back to `feeaba2`; preserve the fix branch `c316067` (never retry an unknown remote build outcome).

## Historical checkpoint — integration candidate `56c1256` (guest consent grant whole-update boundary fix merged) — 2026-09-22

- **Source SHA:** `56c12560469c61b8fbcddae9a935f217a2927ea2` on `codex/norrow-phaseab-integration-20260921`; remote readback `git ls-remote origin codex/norrow-phaseab-integration-20260921` returns the same SHA. Merge is `--no-ff` with parents `b4a2e42` (integration) and `f26d163` (`norrow/stage1-guest-consent-fix`); the merge tree is byte-identical to `f26d163` (`git diff f26d163 HEAD` empty), so the merge introduced no content beyond the source branch.
- **Fix review (`b4a2e42..f26d163`):** exactly two mobile-only paths changed — `apps/mobile/App.tsx` and the new `apps/mobile/test/guest-consent-grant.component.test.tsx`; no backend, package, contract, schema, migration, prompt or provider-route file. No guard was weakened: `saveGuestReader` now compares `consentGranted` against its pre-write entry value exactly as the sibling `draft` field already did, so only a concurrent grant/revocation during the durable write wins and a stale ref can no longer clobber a newer writer; the grant/revocation callers mirror the confirmed value into `latestUi.current` before the write, matching the existing member branch at `App.tsx:1375`. No assertion, error boundary or type was loosened.
- **Regression meaningfulness:** `CONSENT-GUEST-01` drives the real guest device store plus mounted `AppInner` grant path and asserts the granted frame stays durable, the Settings toggle reads ON, and the send is admitted to `POST /v1/runs`. Run against pre-fix `b4a2e42` it fails at `test/guest-consent-grant.component.test.tsx:133` (`expected false to be true` on the persisted `consentGranted`), so it encodes the defect rather than the fix.
- **Backend-unchanged proof:** `git diff b4a2e42 HEAD -- apps/backend packages` is empty (exit 0); `git diff --name-only b4a2e42 HEAD` lists only `apps/mobile/App.tsx` and `apps/mobile/test/guest-consent-grant.component.test.tsx`. No backend source change, so no PostgreSQL Gate A/B rerun is required; local deterministic gates were rerun on the merged candidate.
- **Gates (local deterministic, 2026-09-22, all exit 0):** `pnpm --filter @deep/mobile typecheck`; `pnpm --filter @deep/mobile test` (**76 files, 695/695**); `node scripts/check-boundaries.mjs` (`boundaries=ok`); `pnpm verify` (research-core **397/397** across 34 files, backend unit **260/260** across 32 files, mobile **695/695** across 76 files, governance **7/7**, workspace types and boundaries).
- **Remaining owner actions (external, not candidate defects):** (1) EAS rebuild on this candidate `56c1256` (prior build `3a6c8b41` predates both the react-dom and consent fixes); (2) on-device visual/functional pass over that build (install/launch/type/submit/navigate, including the guest consent grant/revocation toggle) — a screenshot does not satisfy this; (3) staging API redeploy and the Clerk Dashboard email/verification configuration from the prior checkpoint.
- **UI gap list / evidence:** `/tmp/opencode/norrow-evidence/ui-review/post-send-review.md` (code-level post-send UI/UX gaps; device-only items still unverified). Pre-fix failure run retained in this session's transcript; no separate artifact was committed for it.
- **Leases / bounds:** this worktree only. No `main` merge, no force-push/rebase, no GHA dispatch, and no secret was read, printed or written.
- **Rollback:** revert the merge back to `b4a2e42`; preserve the fix branch `f26d163` (never retry an unknown remote build outcome).

## Historical checkpoint — integration candidate `a77678c` (react-dom launch-crash fix merged) — 2026-09-22

- **Source SHA:** `a77678c579b03843ebc995a46c1991a7743faa8f` on `codex/norrow-phaseab-integration-20260921`; remote readback `git ls-remote origin codex/norrow-phaseab-integration-20260921` returns the same SHA. Merge is `--no-ff` with parents `fa2e4b5` (integration) and `058707a` (`norrow/stage1-reactdom-fix`).
- **react-dom fix review (`fa2e4b5..058707a`):** exactly two files changed — root `package.json` (adds `pnpm.overrides.react-dom: 19.1.0`) and `pnpm-lock.yaml`. No source, App, backend, schema, migration, prompt or provider-route change; `git diff fa2e4b5 058707a --name-only` lists only those two. Fixes the launch crash (React error #527) from `react-dom@19.3.0` running against `react@19.1.0` on Expo SDK 54.
- **Lockfile proof:** `grep -oE "react-dom@[0-9.]+" pnpm-lock.yaml | sort -u` returns only `react-dom@19.1.0`; `react@19.3.0` count is `0`; `react-dom@19.3.0` and its `scheduler@0.28.0` are removed and `react-dom@19.1.0` now pulls `scheduler@0.26.0`, matching `react@19.1.0`. Clerk peer keys (`@clerk/backend`, `@clerk/react`, `@clerk/shared`, `@clerk/clerk-js`, `@clerk/expo`) re-pinned to `react-dom@19.1.0`. No unrelated churn beyond this resolution cascade.
- **Backend-unchanged proof:** `git diff fa2e4b5 HEAD -- apps/backend packages` is empty (exit 0); the merge changed only `package.json` + `pnpm-lock.yaml`. No backend source change, so no PostgreSQL Gate A/B rerun is required; local deterministic gates were rerun on the merged candidate.
- **Gates (local deterministic, 2026-09-22, all exit 0):** `pnpm install --frozen-lockfile` (lockfile up to date); `pnpm verify`; `pnpm --filter @deep/mobile typecheck`; `node scripts/check-boundaries.mjs` (`boundaries=ok`); `pnpm --filter @deep/mobile test` (**75 files, 694/694**). `pnpm verify` includes research-core, backend unit, mobile, governance and workspace types/boundaries.
- **Remaining owner actions (external, not candidate defects):** (1) EAS rebuild on this candidate `a77678c` (prior build `3a6c8b41` predates the react-dom fix); (2) on-device visual/functional pass over that build (install/launch/type/submit/navigate) — a screenshot does not satisfy this; (3) staging API redeploy and the Clerk Dashboard email/verification configuration from the prior checkpoint.
- **UI gap list:** `/tmp/opencode/norrow-evidence/ui-review/post-send-review.md` (code-level post-send UI/UX gaps; device-only items still unverified).
- **Leases / bounds:** this worktree only. No `main` merge, no force-push/rebase, no GHA dispatch, and no secret was read, printed or written.
- **Rollback:** revert the merge back to `fa2e4b5`; preserve the fix branch `058707a` (never retry an unknown remote build outcome).

## Historical checkpoint — integration candidate `d50bb1b` (native profile fix merged) — 2026-09-22

- **Source SHA:** `d50bb1b7836315e7f2f5872d6589586e0a3193c3` on `codex/norrow-phaseab-integration-20260921`; remote readback `git ls-remote origin codex/norrow-phaseab-integration-20260921` returns the same SHA. Merge is `--no-ff` with parents `541e68d` (integration) and `4881447` (`norrow/stage1-native-profile-fix`).
- **Native-fix review (`541e68d..4881447`):** only mobile configuration changed — `apps/mobile/eas.json` (adds `staging-device` profile: APK, remote signing, `EXPO_PUBLIC_API_URL=https://norrow-staging-api-esrs.onrender.com`), `apps/mobile/app.json` (drops the `@clerk/expo-google-signin` plugin), `apps/mobile/package.json` (drops that dependency), `pnpm-lock.yaml` (29-line prune). No production endpoint change: `production`/`preview` remain `https://example.invalid`. No application source, schema, migration, prompt, dependency beyond that removal, or provider-route change.
- **Backend-identical proof:** `git diff 541e68d 4881447 -- apps/backend` is empty (exit 0) and the backend tree hash is `ea49e5f73c282d479f370d359a200cf0077e27a4` at all three of `541e68d`, `4881447` and `d50bb1b`. The merge tree `96660b7a…` equals the native-fix tree, so the merge introduced no source change. **Full PostgreSQL Gate A/B rerun not required and not run** because backend code is byte-identical; the local deterministic gates below were rerun on the merged candidate.
- **Gates (local deterministic, 2026-09-22, all exit 0):** `pnpm --filter @deep/mobile typecheck`; `pnpm --filter @deep/backend typecheck`; `node scripts/check-boundaries.mjs` (`boundaries=ok`); `pnpm --filter @deep/mobile test` (**75 files, 694/694**); `pnpm verify` (research-core **397/397**, backend unit **260/260**, mobile **694/694**, governance **7/7**, workspace types and boundaries).
- **Native build:** EAS cloud build `3a6c8b41` on `4881447` was reported FINISHED by the owner. No artifact, spend receipt or device pass was produced or verified in this lane, so no native acceptance is claimed.
- **Pending owner actions (external, not candidate defects):** (1) redeploy the staging API so the `staging-device` profile target is current; (2) on-device pass over the staging build (install/launch/type/submit/navigate) — a screenshot does not satisfy this; (3) Clerk Dashboard operator action to enable the email/verification configuration in the development instance.
- **Leases / bounds:** this worktree only. No `main` merge, no force-push/rebase, no GHA dispatch, and no secret was read, printed or written.
- **Rollback:** revert the merge back to `541e68d`; preserve the native-fix branch `4881447` and EAS build identity `3a6c8b41` (never retry an unknown outcome).

## Norrow Phase A/B local donor integration checkpoint — 2026-09-21

The isolated `codex/norrow-phaseab-integration-20260921` branch merges the complete 22-commit donor history at `766eb6a8f8a130087e158896ed6b16eca4e72625` onto clean recovery `4f2a235b3da65eaef0a3c3ddcf1b52b5c788ed4e` from shared base `bb80cfd2d2a3b14e224e516b165871fc60e58105`. This is a local source import, not an App/backend/auth/claim integration or a merge to `main` or the remote integration branch. The donor's journal, sign-in sheet, focused tests, Render launch assets and readbacks are preserved. The recovery Gate A/B, extraction, BB/RES and EAS-guard evidence remains version-pinned below; it is not promoted to the combined candidate.

Four shared documents were reconciled manually with the current recovery checkpoint first and the donor's 2026-09-20 assertions retained as historical evidence. The donor guest-control ADR is now ADR079, leaving recovery ADR075–078 and their distinct meanings intact. The imported Dockerfile uses `COPY . .`; the donor `.dockerignore` omitted local credentials and private signing keys. The integration excludes `**/.credentials` and `**/*.p8` and adds a governance regression. Against the donor ignore file the regression failed as intended (6 pass/1 fail); after the exclusion it passed 7/7. Docker image construction remains untested because access to the daemon socket is denied; no image was built or secret read.

On the merged local source, the donor-focused journal/sheet command passes **27/27**; mobile typecheck exits 0; `pnpm verify` exits 0 with research-core **395/395**, backend unit **255/255**, mobile **583/583**, governance **7/7**, configured workspace types and boundaries. Both documentation validators and their suites pass (**16/16**, **12/12**). These are deterministic local results, not native, PostgreSQL, Clerk/provider, hosted, public guest or 132-scenario acceptance. No paid/live/model/provider, EAS, GHA, Render mutation, phone operation, main edit or push occurred in this import.

## EAS device-build guard rereview repair — 2026-09-21

Independent review **rejected** evidence head `6dc706fa17ac110648b3514c3b4589f3ebe190f5`: the first guard accepted build-affecting `device`/inherited-profile overrides such as `distribution=store` and `android.gradleCommand`, and its approval receipt did not prove full write plus file/directory durability before CLI dispatch. The exact adversarial fake-CLI run against that head was **15 passed / 7 failed**. Functional repair `e78c5cc05e747d9cf6255d4028d1912aaf078924` (tree `a7128ac7a285f564d5de69853de5a6e1a91dfd65`) exact-allowlists the inherited `preview`, `device` and effective profile, including distribution, APK type, remote signer and environment. Unexpected overrides fail before creating a receipt. The receipt now loops over short positive writes, rejects zero/incomplete writes, fsyncs its file and directory, and only then starts the CLI; a failure leaves the exclusive approval identity held. Fake-CLI controls prove no invocation and no second dispatch after write-zero, file-fsync or directory-fsync failure. Repaired focus **22/22**, full `pnpm verify` EXIT 0 (core **395**, backend **254**, mobile **556**, governance **6**, types/boundaries), mobile typecheck EXIT 0; both document validators and their **16/16** and **12/12** tests pass. No real EAS CLI, auth token, remote build, credit, APK or phone operation was used for this repair. This head is **pending independent rereview**, not self-approved; prior local Gate A/B application-source identity `87e4371` is unchanged. Rollback must retain any consumed approval receipt and never retry an unknown build.

## Guarded Android EAS device-build preparation — 2026-09-21

Implementation `74a9839d482fffde87a699295b71dfc44c7365c7` (tree `1f42d2c84575611e79c9ee8985aa7da3b45afb61`) adds only a registered mobile-owned, noninteractive Android `device` APK build entrypoint and its tests; it does **not** change the app runtime, `eas.json`, dependencies, production endpoint or the local Gate A/B tested source `87e43715f5fc5582116408f80e23a313c6603748`. The command requires passwordless `EXPO_TOKEN`, a positive owner-approved USD build amount and approval ID, a trusted absolute EAS CLI path, exact project/profile/loopback configuration and a durable external one-use approval receipt before starting the CLI. It fixes Android/device/noninteractive/wait, strips unrelated provider environment, redacts the token from captured CLI output, and never installs or auto-submits. Reuse after an unknown CLI result fails closed. The amount is **not an EAS-enforced hard cap**; owner billing/allowance readback and approval must precede an actual remote build. APK package/version/ABI/signer and phone-data compatibility remain a separate post-build gate.

Deterministic fake-CLI controls pass **13/13**, mobile typecheck EXIT 0 and final `pnpm verify` EXIT 0: core **395/395**, backend **254/254**, mobile **547/547**, governance **6/6**, types/boundaries. An initial `pnpm verify` EXIT 1 caught a forbidden literal provider-key name in the new mobile test fixture; the fixture constructs that name without embedding the literal and retains its environment-isolation assertion. Final review and builder validators and their **16/16** and **12/12** unit suites pass. With ambient Expo credentials unset, the registered wrapper exits **2 before any CLI/network request**. No EAS build, APK, signed artifact, spend or device install follows from this packet.

By separate, user-authorized, read-only transient auth check, cached EAS CLI 16.17.4 `whoami` and `project:info` each exited 0 and matched expected owner `jobeezyapp` and project ID `52197359-d453-48a6-876f-ea00ba253528`; raw CLI output and credential were not recorded. The current ambient `EXPO_TOKEN`/`EAS_TOKEN` remain absent. The supported cached CLI has no account plan/build-credit readback; remaining Android build allowance and paid-plan overage exposure are **unknown**, so no build budget decision or remote build occurred. Expo credentials supplied in chat are not retained in this repository and should not be treated as reusable authentication. Local one-use receipts were exercised only with fake credentials and a fake CLI in temporary test directories. Impact and rollback: ADR078 and `specs/SETUP_AND_HANDOFF.md`; removing the new command must not erase any future approval/build identity or retry an unknown remote outcome.

## Current-source Android diagnostic boundary — 2026-09-21

On recovery documentation HEAD `ddfe89a0eadf57d50729ba4874a0cc65daf077cc` (application source remains exact clean `87e43715f5fc5582116408f80e23a313c6603748`), an isolated checkout built a local x86_64 Android **debug** APK from that source: registered `:app:assembleDebug` EXIT 0, APK SHA-256 `f476f7f410b37ef9cc98d953ee7efffceef4ca497cc3798b2205071b38556aa6`; persistent build log SHA-256 `2fb7bf922b5cd5c1eed07de48b4beda79dbb87c57d3702424611658054966cda` under `/home/oranolio/Desktop/deep-native-ddfe89a-20260921/apps/mobile/android/build/`. Public Maven debug AARs resolved under Gradle metadata checksums; no provider call or build-service spend occurred. `pnpm test:e2e:android` EXIT 0 with the local emulator online, but is only a device-presence check. The x86 APK installed and launched on the emulator; UI inspection had no usable controls before the attempt was interrupted. The emulator was canceled at the user's request, with only its reverse mappings removed; its AVD/build evidence was retained. An earlier host restart had no confirmed kernel OOM cause. **No current-source native type/submit/navigate/empty/error flow passed.**

The user-provided wireless-debugging phone `10.0.0.167:34015` authorized as Android 16 model `25098RA98G`. Its existing `app.deepresearch.mobile` version `0.1.0`/code `1` and data were preserved; a read-only APK backup is retained as `installed-phone-before.apk` (SHA-256 `2021251ce740838b436e739ff0777397a53ba34cea63dff5f80d6e135e8966a4`). The x86 APK `adb install -r` failed `INSTALL_FAILED_NO_MATCHING_ABIS` because the phone is arm64; no uninstall, clear, reverse mapping or request submission followed. The subsequently authorized arm64 local build was canceled at the user's override (Gradle EXIT 130); **no arm64 APK or phone app flow exists**. Diagnostic API/Metro listeners on task-owned 8899/8081 were stopped. Its exact isolated local database `deep_native_ddfe89a_20260921` was verified empty (0 accounts, runs, reports and connections), dropped and verified absent; this empty diagnostic DB cannot be recovered. Persistent source checkout, x86 APK, both build logs and phone APK backup remain outside the recovery tree.

The user's preferred EAS route was **not started**. `apps/mobile/eas.json` has an internal `device` Android APK profile with `http://127.0.0.1:8787` and remote signing; `preview`/`production` still use `https://example.invalid` (production Android is an AAB). Device-only diagnostic use would require an approved local API/reverse mapping, and the EAS signer may not match the existing debug-signed phone app; in-place installation without clearing data is unproved. Neither `EXPO_TOKEN` nor `EAS_TOKEN` is present in the current or clean child environment; approved local Expo state has no auth/session/token keys; cached EAS CLI 16.17.4 noninteractive `whoami` EXIT 1 and Expo `whoami` is unusable. `verification/COMMANDS.json` registers local Android commands but no EAS build/auth/install command. Account plan/build-credit availability is unknown without authentication; no EAS build, quota use, signed artifact, hosted or release claim follows. In-repo profile/endpoint/signing and command-registration preparation remains possible under a separate assignment; this evidence-only checkpoint makes no registry or release configuration change.

## Gate A/B local deterministic verification — 2026-09-21

Exact clean tested source head `87e43715f5fc5582116408f80e23a313c6603748` (tree `75a65fdd69185a10317c7417d13d4d77ebc2de62`) passes the full backend PostgreSQL Gate A and Gate B sequentially on separate fresh databases: **49/49 files, 585/585 tests, EXIT 0** in each. Gate A log `/tmp/deep-gate-a-87e4371-zCdCSq/full-integration.log` SHA-256 `89eb844bd157e9eb954b9fcf689f1ae37d1f55707a1d9649ec2e0cfded155728`; Gate B log `/tmp/deep-gate-b-87e4371-L3aHuW/full-integration.log` SHA-256 `d4946825353ea00d32cba544ae552dfb0ddc5f3d3145ae1a97d3de43fe2557cd`. Both unique Gate databases were dropped and verified absent. The earlier `c7c68e8` **574/584** failure log remains preserved below; it is not rewritten as a pass.

At the same clean source head, full extraction passes **8/8 files, 55/55 tests, EXIT 0** with actual parser/API/worker controls and fabricated model transport. Log `/tmp/deep-full-extraction-87e4371-usO67r/full-extraction.log` SHA-256 `ba9afb1d4e1e8a9c2955c39bbb7b68526884159e88d3bb04effa9738a765b677`; matched artifact SHA-256 `0bab652d0c3e055e5e59107cba0eaeb9e386231983c879e34f91bc1867b4f532`; evaluator-control artifact SHA-256 `7df31aa3ba446c315f7fdabde0d42fab70a0fbfe2371aff22164d4e33c2007a7`. The matched manifest binds that exact clean commit and executable helper SHA-256 `576e06c8b438bf5344928ea99b72197810cb7d6ab07e104ef4fde75634d9f003`, with zero new paid calls/cost and no semantic scores or human adjudication. The extraction suite database was dropped; its test-owned `deep_eval_control_5949e5e56907438b8f71ebd9809874b5` remains retained. These are local deterministic and fabricated-transport results, not live-model quality, hosted CI, native acceptance or release authorization. This documentation-only evidence synthesis does not change the tested source tree; `main` and remote refs remain untouched.

## FINAL Gate-A fixture alignment — 2026-09-20

The independently approved fixture packet `840e04b79c2781244f70afc39b3de88b064b1209` was fast-forwarded from exact base `c7c68e80416d45a1a7c9ee03bf970c04409cc98e` into local recovery branch `codex/v8-recovery-20260920`; neither branch was pushed or merged to `main`. The preserved full Gate-A log `/tmp/deep-gate-a-c7c68e8-20260920-2140/full-integration.log` (SHA-256 `979ed94a0a377f47e2752a702094401964e90718f48567caac61dfaa3bcef920`) remains the pre-repair evidence: **45/49 files**, **574/584 tests**, ten fixture-expectation failures, and no production failure. This packet changes only four integration-test fixtures plus canonical evidence/docs; production source, contracts, schemas, migrations, dependencies, prompts, routes and model policies are byte-identical to the base.

W06 now binds the Linux and Windows assertions to their authoritative entity scopes. A null/mis-scoped control remains incomplete, performs one new read, retries only the exact original-question span `Linux or Windows`, and leaves `need-platform` open. Model-gateway positive controls now supply exact two-entity tasks, evidence and scopes; their incomplete, tamper, replay, counterevidence and crash checks remain active. The independent BB02 heldouts assert exact evidence-conditional need identities/states/freshness across restart. Wave5 distinguishes the durable raw `export` hint from the one exact outbound expansion `export vendor documentation`, preserves it across restart, requires a distinct third query and excludes token lookalikes.

Independent review rejected fixture head `c1f98dea427ec5ff856dc1de0ea112c95911b80d` solely because BB02-03 did not pin the production-observed freshness publication boundary. The follow-up adds exact terminal/report `completed_with_limitations` assertions and exact limitation `Required source freshness remains unknown.` while retaining the satisfied current-headcount need and its required freshness/search/read checks. The selected BB02-03 control passes **1/1** and the full independent heldout file passes **6/6** on separate fresh databases.

The prior fresh isolated PostgreSQL four-file verification on `deep_gatea_fixture_final_20260920_2257` passes **4/4 files, 178/178 tests**; the final three-assertion amendment separately passes BB02-03 **1/1** and full independent heldout **6/6**. All temporary databases were dropped. On the fast-forwarded recovery branch, `pnpm verify` passes core **395/395**, backend unit **254/254**, mobile **534/534**, governance **6/6**, workspace types and boundaries. At this 2026-09-20 checkpoint the full 49-file Gate A had not yet been rerun; the subsequent 2026-09-21 Gate A/B passes are recorded above. No live/paid/provider/native/EAS/GHA command, shared database, migration, service, main or remote mutation was performed. Rollback the local fixture/evidence commit series to exact base `c7c68e80416d45a1a7c9ee03bf970c04409cc98e`; production behavior and all consent, budget, ownership, cancel, publication and unknown-outcome fences remain unchanged.

## V8 repaired recovery candidate — 2026-09-20

Local branch `codex/v8-recovery-20260920` remains based on refreshed `origin/grok-v8/research-beta-integration` `bb80cfd2d2a3b14e224e516b165871fc60e58105`. Preservation head `4ba21a6` retains the exact independent BB-01/02/03 suites; rejected integrated heads `19a0bd38` and `f70a3f6` and every rejected repair remain in ancestry. The follow-ons were imported once: RES-02 `2cc678f` then `187a2f0`, independently approved RES-05 `0d48bb0`, RES-04 `1b7640a`/rejected evidence `a7b6d52` then approved `62a374c`/evidence `6a03137`, and W08 `cfe382b` then approved `5e76f51`/evidence `e61c655`. Patch-equivalent b818/55ea/3116 bases were not replayed.

RES-01 still transfers an accepted parent view only to its exact owned child after durable accepted identity and strict owned-child refresh. RES-04 now strict-parses every non-null follow-up, assumption and correction journal before binder, hydration, admission, New Research, routed follow-up or Android Back phase decisions. Damaged `adopted`, `rejected` or `withdrawn` rows remain held without identity minting, POST, adoption or clear; confirmation remains same-parent. Reviews rejected foreign confirmation at `9327b21`, terminal phase-before-parse at `2abcbd1`, and phase-only state gates at `a7b6d52`; approved `62a374c` closes all three classes while retaining the RES-01 lease contract.

RES-02/03/05 uses `requested-obligations.v2` question-bound entity×fact pairs, authoritative assertion scope and Evidence Need/limited-publication disclosure. Reviews rejected `3677bd8`, `6eb29dd`, `7a4d70f`, and `2cc678f`; approved `187a2f0` adds capitalization-independent grammar binding and removes only strict fallback aliases such as phantom `ARDENT` from `ARDENT labs`, without coalescing explicit `Alpha`/`Alpha Labs`, acronyms or single-word entities. Integrated candidate `f70a3f6` was then rejected because validating legacy v2 rows only against the final v2 classifier denied meanings actually admitted by earlier v2 write epochs. Independently approved RES-05 `0d48bb0` freezes epochs `003c55a`, `f627b2b`, `9677232`, and `cde2a94`; a default v2 row restores only for its exact admitted original question when its canonical policy matches at least one epoch. This preserves old firmware-compatibility and established-generic identities without admitting impossible current-price history, unknown rationale/shape, owner/question mismatch, overwrite, or relabeling. New writes remain `criterion-freshness.v4`; v3/v4 remain exact-version and fail closed on semantic, owner, column, or canonical-JSON mismatch. Present workforce/current remains current; fiscal, quarter, end/start and explicit as-of controls remain historical.

Approved RES-05 source evidence: full research-core **367/367**, focused semantic coverage/freshness **65/65**, fresh legacy persistence **3/3**, fresh production-worker v2 resume **1/1**, workspace types and boundaries. The recovery integration reruns are recorded below and in the recovery result artifact; all PostgreSQL transport is local and fabricated/nonbillable.

W08 preserves the rejected `19a0bd38` extraction result **54/55** and rejected `cfe382b` substring/provenance artifacts. Approved `5e76f51` uses NFKC/lowercased Unicode tokens, adjacent exact `offline` + `editing`, and exact token `export`; seven unit controls cover `preoffline editing`, `offline editingly`, `exportable`, case, spacing and genuine mixed queries. The manifest hashes the executable helper. Exact-clean source evidence remains focused **3/3**, full extraction **55/55**, with helper SHA-256 `576e06c8…`; the final integrated clean-code head `0a48cf4` independently passes focused extraction **3/3** with artifact `/tmp/deep-v8-integrated-w08.zi4KA3/document-controls.json` SHA-256 `f25d23d1…`.

Integrated deterministic checks at clean code head `0a48cf4`: focused core **64/64**, focused mobile journal union **156/156**, `pnpm verify` with core **394/394**, backend unit **254/254**, mobile **534/534**, governance **6/6**, all configured workspace types and boundaries. No skips, conflict markers, `ts-nocheck`, assertion deletion or exclusion were introduced. The interrupted RES-02 PostgreSQL EXIT130 occurred against a mixed, concurrently changing source tree and is retained only as invalid historical evidence. Approved source-lane isolated PostgreSQL evidence remains worker siblings **8/8**, policy replay/tamper **2/2**, and alias crossed/full-four controls **2/2**; it was not rerun here.

Post-RES-05 integrated checks at clean code head `002fc4f`: focused semantic/compound/freshness **65/65**; fresh isolated persistence database **3/3**; separate fresh real-worker/compound database **9/9**; mobile journal union **156/156**; W08 token-boundary units **7/7**. `pnpm verify` passes core **395/395**, backend unit **254/254**, mobile **534/534**, governance **6/6**, all configured workspace types and boundaries. Both documentation validators pass **16/16** and **12/12**. The two uniquely named PostgreSQL databases were dropped after verification; no shared database was used.

APPLE-01 remains prior owner-authorized readback only: team `W6MVPS68ZU`, App ID `app.deepresearch.mobile`, App Store Connect app `6814282574`, version `1.0`, `PREPARE_FOR_SUBMISSION`. This lane made no credential, build, upload, release, live-provider, native, service/port, shared-database, source-worktree, main, visual-QA or remote mutation. `https://example.invalid` still blocks a functional production build. Rollback returns the candidate to `19a0bd38` (or preservation point `4ba21a6`) while retaining durable readers, held journal identities, source evidence, Evidence Needs, consent/cancel/budget/ownership/deletion/publication fences and financial/unknown holds.
## Historical Norrow donor checkpoint — 2026-09-20

This isolated lane is `codex/norrow-render-clerk-guest-auth`, based on integration `bb80cfd2d2a3b14e224e516b165871fc60e58105`, with application-source and remote Norrow HEAD `2f98442c71bb14d3ba97aa8ec8b2d8352cfcaa14`. Source after the prior journal checkpoint includes Render container preparation `6144828`, controller-driven sheet `e7ea282`, serialized-attempt race repair `4c667e8`, stale-error suppression `ef00907`, and immediate durable dismissal `2f98442`. It is unmerged to integration and `main`; there is no deployed app build. The protocol received independent approval only as additive implementation authority; it is not evidence that the backend, database, Clerk, or native product path exists.

At `2f98442`, the focused mobile suite `pnpm --filter @deep/mobile test -- guest-pending-action.test.ts guest-sign-in-sheet-state.test.ts guest-sign-in-attempt-gate.test.ts` exits 0 (**27/27**). Independent review approves only the sheet/pending-action presentation seam: dismissal now durably suppresses continuation without waiting for an unresolved preparation result, and a late preparation cannot emit begin or launch a provider. No App integration, Clerk/provider flow, server admission/claim, native journey, hosted app, or combined-product acceptance is implied.

Render readback is real infrastructure evidence, not a hosted application result: project `prj-dao8rh3m8hqs73do2ag0` (Norrow) is in the approved workspace; staging database `dpg-dao8s5jm8hqs73do4cag-a` and production database `dpg-dao8sfg473hc739d47h0-a` both read `available`. Staging is Oregon/PostgreSQL 16/`0.5c-1g`/5 GB/no HA; production is Oregon/PostgreSQL 16/`1c-2g`/10 GB/HA; both have database `ipAllowList: []`. The project environments are protected and network-isolated, but their environment ingress defaults remain permissive because this workspace tier does not support environment IP allowlists. There is **no API or worker service, service role, migration, deploy, external database connection, domain, health check, observability configuration, or public guest activation**. See `verification/norrow-render-clerk/RESOURCE_JOURNAL.md` for the resource receipts, cost boundary, and safe rollback boundary.

Clerk instance `ins_3JcB20N0jPnpXio97hZH6AhPMD6` is a development/test instance. Native API is enabled; Apple and Google factors are configuration-level only. Email address is disabled and email verification strategies are empty. `verification/norrow-render-clerk/CLERK_CONFIGURATION_READBACK.md` records that BAPI cannot enable email-code and the available Clerk CLI has no platform session (`clerk whoami --mode agent` → `auth_required`); a legitimate Dashboard or CLI/platform-authenticated operator must configure it. No redirect URLs/origins are configured; no provider flow, login, webhook, user, claim, or native journey was exercised. Apple App Store Connect JWT probe returned `401 NOT_AUTHORIZED`; no Norrow Sign in with Apple Service ID/key, Google OAuth client/domain, or hosted provider callback is verified. These are **BLOCKED/CONFIGURED_NOT_EXERCISED**, not an authentication integration.

The branch contains durable journal expiry/terminal-state and claim-scope repairs through `724637a`, independently accepted at **17/17** (`pnpm --filter @deep/mobile test -- guest-pending-action`); that is not proof of external exactly-once execution. `e7ea282` makes the sign-in sheet controller-driven and `4c667e8` serializes attempts so dismissal/newer attempts cannot be overtaken by a late preparation result. The focused combined sheet/journal test command passed **27/27** at `4c667e8`. This remains an isolated seam, not an application integration: it has no Clerk SDK flow, backend claim, server-owned admission, or continuation. `apps/mobile/App.tsx` remains owned by the `phase-a-state` lane. The proposed packet is the nontracked local [coordination record](/home/oranolio/Desktop/Deep/.git/norrow-render-clerk-coordination.md), at base `bb80cfd2d2a3b14e224e516b165871fc60e58105`/then-tip `cebbfd502af49cb8929ecba0eb7fa8ec76a6bbb8`; it has no live owner contact or recorded acceptance. It assigns the mobile state seam to its existing owner and requires a backend owner to accept `apps/backend/src/api/app.ts`, verifier/authority/admission/claim/lifecycle, access/runs/worker fences, strict contracts, migration after `051_closure_identities.sql`, and endpoint/race/webhook tests. Until that transfer is recorded, API/contracts, persistence/migrations, Clerk verification/webhooks, lockfile, and devices remain untouched by this lane. Do not enable guest issuance or substitute a frontend counter: the approved protocol requires server-owned admission, atomic sponsor ledger, immutable execution ownership, scoped claim, consent/deletion/cancellation/HOLD fences, and safe continuation/reconciliation.

Evidence executed in this lane: authenticated Render `GET /v1/projects/{id}` and `GET /v1/postgres/{id}` readbacks (exit 0); authenticated Clerk `GET /v1/instance` and public JWKS reachability (exit 0); Git inventory (exit 0); journal **17/17** at `724637a`; focused sheet/journal **27/27** at `4c667e8`; and `pnpm --filter @deep/backend build` exit 0 for `6144828`, all on 2026-09-20 from the local operator environment. Docker image boot/listen/health/shutdown were not exercised because the Docker daemon denied socket access. Both Render recovery endpoints read `AVAILABLE`, which is provider recovery availability only; no backup restore, failover, app recovery, or service has run. `pnpm --filter @deep/mobile typecheck` at the controller-sheet source exits **2** only at unrelated `apps/mobile/test/query-authorization.test.ts:67:71` (obsolete `outcome` on typed payload), so current combined mobile verification remains blocked pending its owner repair. No migration, native flow, hosted app journey, provider login, load, restore, or 132-scenario acceptance test was run by this lane. Database list-price estimate is USD 106.50/month before tax/workspace/services/model vendors; it is an estimate, not a spend cap or invoice. Rollback is a separately authorized Render-only operation: first prove no data/services/retention obligations, then explicitly remove the two databases before the project and read back absence; never erase claim/tombstone/hold data to roll back an eventual application implementation.
## R-05 deepen investigation + synthetic J8/J11 production — 2026-09-20

Isolated worktree from `9677232`. **Not merged to `main` (`8a7b1a9`).** No GHA. No live OpenRouter. Research Beta is not declared.

Deepen is an investigation instruction on the child `desiredOutcome`. `originalQuestion` is unchanged. Opening public discovery uses a unique original-question span of that focus when one exists; otherwise the original question remains the query. Extract context includes planning state for that investigation. Deepen does not fall through into requested verification.

Synthetic J8 (private attachment) and J11 (hierarchical writer) now run through `processStructuredResearch` / `createResearchDraft` / follow-up deepen with fabricated nonbillable transport. Focused isolated PG `deep_r05_01a0bfe8`: research-core coverage+intelligence **35/35**, r05-deepen-j8-j11 **3/3**, followup-explain **8/8**. Live J8 still needs a user attachment. Live J11 writer quality is still grant-gated.

## R-02 / CL-07 hierarchical writer restore — 2026-09-20

Isolated worktree from `9677232` on `grok-v8/r02-cl07-writer-restore`. **Not merged to `main` (`8a7b1a9`).** No GHA. No new EAS.

Restore of an accepted write now uses the recorded attempt policy, not the run’s primary `model_policy_id`. Failover Azure results stay Azure; the run stamp stays Structured. Composition is inserted after each section, locked with `FOR UPDATE`, and a completed row cannot shrink on a prefix replay. A crash after the first section leaves a one-section composition that `restoreWriterDraft` refuses; `createResearchDraft` resumes, extends, and restores the full stitch. Calculated reports remain a single `write_report`. `sectionWrite` stays on ModelContext / `model-input.v8`. `planHierarchicalWrite` still dedupes section `claimKeys`.

Focused evidence on isolated `TEST_DATABASE_URL=.../deep_r02_a0bfe8`: production `createResearchDraft` / `restoreWriterDraft` **4/4** (distinct section purposes, fallback-policy restore + publication, crash-between-sections resume, completed-composition keep). Writer hierarchy units **6/6**. Backend `tsc` 0. Full `pnpm verify` and two PG suites were **not** run. Live J11 not granted.

## R-04 / CL-01 continue races and declared fields — 2026-09-20

Isolated worktree on `grok-v8/r04-cl01-continue` from `9677232`. **Not merged to `main`.** No GHA. No EAS.

Paused `/continue` now fail-closes the resume against `awaiting_input` + pending identity + `cancellation_epoch` before committing a brief revision. Cancel and terminal clear pending identity. GET omits `pendingInput` unless the run is still `awaiting_input`. `clarificationAnswersFromContinue` accepts a declared field set: a single pending field still 400s extras; an explicit multi-field identity accepts only those fields. Sibling follow-up/assumption-replace/empty continue cannot resume a pause. Child continue does not mutate the parent brief or budget. Original question stays immutable.

Focused `TEST_DATABASE_URL=.../deep_r04_cl01_7f3a`: brief-continue **19/19**, production continue **1/1**, followup-explain **8/8**, cancellation-atomicity **7/7**. Mobile pending-input **5/5**. Full `pnpm verify` and two PG are not this SHA.

## Merged Phase A/B remaining gates — 2026-09-20

`grok-v8/research-beta-integration` HEAD **`8bb7563`**. **Not merged to `main` (`8a7b1a9`).** No GHA. Research Beta is not declared.

Twelve independent agents finished remaining CLs, then this checkout merged their worktrees and fixed PG collisions:

- Idle Stop, unique-quote brief locate on admitted strict-v4 (legacy text-v1 still rejects mismatched spans), counterevidence 3-read bound, historical discovery stop, IME/query-approval/cancelling copy, journal failure matrix, continue vs cancel, fallback writer restore, deepen + synthetic J8/J11 production tests.
- Local Gradle APK of `9677232` installed on `10.0.0.167:41299` (sha256 `2021251c…`); Demo off, live reverse `8787→8789`, Stop cancelled a live run.
- `pnpm verify` EXIT 0: research-core **327**, backend unit **247**, mobile **350**, governance **6**, boundaries ok.
- Extraction isolated **55/55**. Fresh/upgrade migrate **50** including `051`.
- PG1 on `deep_merge_pg1` **567/567 EXIT 0** (~1442s, sha256 `63411164…`). PG2 on `deep_merge_pg2` **567/567 EXIT 0** (~1378s, sha256 `ab6550c7…`).
- Live taco HTTP run `e96499ef` did **not** publish (counterevidence 4-read overflow; now capped). iOS and hosted GHA remain blocked. Live J8 still needs a real private attachment.

## Phase B remaining functional UI — 2026-09-20

Isolated worktree `grok-v8/phase-b-functional-ui` from parent `9677232`. **Not merged to `main`.** No GHA. No new UI libraries. No EAS rebuild.

Functional consumer UI remaining after the existing Stop-beside-Send / Demo / Stopping / Reduce Motion / claim-picker / settings-order work:

- Android IME: `composerDockBottomInset` still lifts Send and Stop when adjustResize reports height 0, so the Gboard suggestion strip cannot cover the controls. Unit tests prove Send/Stop clearance.
- Query authorization: pending exact terms are the only approve body; stuck pending cannot continue as a clarification or start a silent search. Malformed pending fails closed.
- Cancelling copy is Stopping; terminal copy is `Research cancelled.`
- Follow-up explain stays enabled when a report exists even if paid correction is unavailable.
- Multi-claim citation picker uses `pickUniqueClaimId` and never sends `claimIds[0]` for several conclusions.

Installed APK remains `75dee72` (no EAS). Device IME recapture is a leftover. iOS unavailable.

## Simple historical-fact discovery stop — 2026-09-20

Isolated worktree from `9677232` (`grok-v8/research-beta-integration`). **Not merged to `main` (`8a7b1a9`).** No GHA. No live OpenRouter.

`when was Taco Bell founded` still ran extra discovery after the matcher fix because `structured-research.ts` treated coverage-incomplete and `freshnessUnmet` as unresolved consequential criteria. Historical class now ignores undated/2015 pages; `discoveryContinuationGaps` stops continuation once assertions are supported, including when the coverage model complains about generic one-year freshness. Born / established / signed-treaty questions share that class. `readAdoptedSources` stops further fetches after two independent readable pages on that class only. Citation and support still run. No parallel demo/fast-lookup path.

Focused evidence: research-core **325/325**; historical-fact-discovery.integration **1/1** on `deep_simple_01a0bfe8`; token-budget unit **9/9**. Typecheck research-core and backend EXIT 0. Full `pnpm verify` and two PG suites are not this SHA.

## R-03 / CL-04 follow-up journal failure matrix — 2026-09-20

Isolated worktree from `9677232` on `grok-v8/r03-followup-journal`. **Not merged to `main` (`8a7b1a9`).** No GHA. No new EAS.

Mutating follow-up, assumption replace/confirm, and text correction now persist journal phases `prepared` → `sent` → `accepted` → `adopted` (or `rejected` / `withdrawn`) before POST and before clearing. Callback failures, double-tap reuse, 401, 409, empty mutating bodies, and superseded views keep the last durable phase. An unresolved journal blocks a different mutation. Read-only explain records the answer without clearing a pending mutation. SHA-256 `mutatingFollowUpKey` is unchanged. Hermes still uses `newId()`, not `crypto.randomUUID()`. Mobile still cannot import `@deep/research-core` (boundary checker).

`pnpm --filter @deep/mobile test` **340/340** EXIT 0. `pnpm --filter @deep/mobile typecheck` EXIT 0. `scripts/check-boundaries.mjs` `boundaries=ok`. Device double-tap and current-HEAD APK remain unrun. Rollback: revert this commit.

## Founded-year freshness — 2026-09-20

`when was Taco Bell founded` was classified as generic (1-year freshness) because the historical matcher required `founding`, not `founded`. Old official pages then looked stale and discovery kept going. Matcher now includes founded/established/incorporated. Not merged to `main`.

## Device live path, Stop completion, brief quote location — 2026-09-20

`grok-v8/research-beta-integration` worktree `/home/oranolio/Desktop/deep-v8-integration`. **Not merged to `main` (`8a7b1a9`).** No GHA. No new EAS. Research Beta is not declared.

The installed APK still defaults to Demo (`routeMode=fixture`) and talks to `127.0.0.1:8787` via adb reverse. Sample headlines are fixture runs. Stop appeared broken because cancel set `cancelling` and nothing finished the run when no diagnostic worker was on the fixture DB, and a live worker that hit `LostWorkerLease` after Stop left the run cancelling.

This SHA: idle Stop completes when there is no active lease and no `issued` provider call; the worker aborts the fenced session when lifecycle is `cancelling` and finishes that cancel after the lease drops; unique owned question quotes are located for brief on the admitted strict-v4 route (invented quotes still fail). Sign-in keeps the device Demo/Research switch. Activity shows Stopping while cancel is in flight.

Device live stack (do not kill 8788 fixture or 8790 J12): API `127.0.0.1:8789`, DB `deep_v8_device_live`, `LIVE_BUDGET_SCOPE=device-live-20260920`, `EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime`, adb reverse `tcp:8787 -> tcp:8789`. Phone: Demo off, signed in, AI processing on. Live Taco Bell run searched and read public sources (no Sample prefix). Stop on that run requested cancel; after the lease dropped the run is terminal cancelled.

Focused tests: cancellation-atomicity **7/7**, model-gateway brief offset locate **1/1** plus invented-quote still invalid, mobile research-activity **14/14**, lifecycle **12/12**. Full `pnpm verify` and two PG are **not** this SHA. Frozen `21190ed` PG **544/544** twice remains prior evidence. Installed APK is still `75dee72` (no new EAS). iOS unavailable.

## Typed constraint, continue cardinality, section purpose, follow-up journal — 2026-09-20

`grok-v8/research-beta-integration` worktree `/home/oranolio/Desktop/deep-v8-integration`. **Not merged to `main` (`8a7b1a9`).** No GHA. No new EAS. Research Beta is not declared.

Production repairs on this tree (uncommitted until the product SHA below):

- **R-01 / CL-03 budget:** `parseCorrection` reads the change message’s ceiling. Follow-up `change_constraint` applies `applyCorrectionToConstraints` and keeps `originalQuestion`. Mobile no longer concatenates via `onCorrect`. HTTP test: `$2k` → `$1,500` with Indiana retained.
- **R-04 / CL-01 continue:** `clarificationAnswersFromContinue` rejects extra/conflicting/mixed fields. GET omits `field` when the column is null (no clarify-event fallback). Rejections leave brief/pending unchanged.
- **R-02 / CL-07 sections:** `sectionWrite` (question text + responsibility) is in ModelContext, provider body, and `model-input.v8`. Distinct questions sharing evidence get distinct manifests. Restore uses the recorded attempt’s policy, not only the primary policy id. Composition is persisted after each section and kept on replay.
- **R-03 / CL-04 journal:** SHA-256 payload digest (Aa vs BB no longer collide). Unresolved mutation is not replaced. Explain does not clear a pending mutation. Mutating success requires a run id before adoption.
- **R-05 deepen:** child `desiredOutcome` carries the focus; command text is not stored as an assumption.
- **R-06 claims:** GET `/v1/reports/:id` returns `{id,text}`; picker shows claim wording; verify without a selection leaves the sheet open.

Focused evidence: research-core **317**, backend unit **247**, mobile **323**, tsc 0. Isolated HTTP `deep_r01_continue`: brief-continue **12/12**, followup-explain **8/8**. Writer production test for shared-evidence section purposes **1/1**. Full `pnpm verify` and two PG suites are **not** this SHA yet.

Installed APK remains EAS `16412bce` git `9ae92fe` / product `75dee72`. Device unlocked; captures in `verification/v8/research-beta/visual-qa/v8-closure-75dee72/`. That APK does not contain these repairs. Live J8/J11 and hosted GHA still blocked. iOS unavailable.

## Remaining CL closures — 2026-09-20

`grok-v8/research-beta-integration` product SHA **`75dee72a1ba77717262a0ca683a6b5a52c965d97`**. Isolated worktree. **Not merged to `main` (`8a7b1a9`).** No GHA. No new paid spend. Research Beta is not declared. Phase A engineering for these contracts is implemented and locally verified; Phase B chrome repairs (Stop-with-draft, quote-first sheet, settings order) shipped in the same tree. Native current-HEAD APK not yet rebuilt. PG 544/544 ran on this code immediately before the commit.

`pnpm verify` EXIT 0: research-core **314**, backend unit **246**, mobile **321**, governance **6/6**, boundaries ok. Fresh migrate **50** including `051_closure_identities`. Upgrade `001`–`050` (49) then `051` → **50**. Extraction **55/55**. Isolated PG **544/544** twice — `deep_closure_pg1` 1092s EXIT 0 and `deep_closure_pg2` 935s EXIT 0. Focused brief-continue **10/10**, followup-explain **6/6**. EAS **`16412bce`** git **`9ae92fe`** (docs on product `75dee72`) sha256 `c888095a…` **installed** on `10.0.0.167:41299`. Device lockscreen blocked visual recapture. Live J8/J11 not granted.

## Deepen HTTP + child adoption tests — 2026-09-20

POST `/v1/runs/:id/follow-up` `{message:"Go deeper on battery life",expectedBriefRevision}` returns `kind:"deepen"` on a child that keeps `originalQuestion`; controlled-research fallthrough is not verification 400. Mobile `adoptReturnedChild` is the shipped select/refresh/poll helper for follow-up and assumption replace; unit test fails if the parent is polled. followup-explain **5/5**. Mobile **318/318**. Built on product SHA `71a14a3`. **Not merged to `main`.** Native APK and live J8/J11 still blocked.

## Closure gate SHA 71a14a3 — 2026-09-20

`grok-v8/research-beta-integration` product SHA **`71a14a39d0b30174835f9875a8019ee0ed234f15`**. Isolated worktree. **Not merged to `main` (`8a7b1a9`).** No GHA. No new paid spend. Research Beta is not declared. Phase A and Phase B are not complete.

At this SHA: `pnpm verify` EXIT 0 (research-core **314**, backend unit **245**, mobile **316**, governance **6/6**, boundaries ok). Isolated `TEST_DATABASE_URL` PG **541/541** twice — `deep_resume_pg1` 1052s EXIT 0 and `deep_resume_pg2` 1068s EXIT 0. Hierarchical comparison writes omit job-level `scopeComparison` on singleton sections, so Wave 5 independent-challenge no longer fails `claimKeys` min-2. `wave5-intelligence.integration` **3/3** on the shipped writer. Wireless ADB `10.0.0.167:43417` still connection refused (host pings). Historical `f627b2b` PG and `95432e9` APK are not this SHA.

## Contract closures CL-01–CL-03/CL-07 — 2026-09-20

Shared `ContinueRunRequestSchema` / `AssumptionsRequestSchema` / `routeFollowUp` in `@deep/contracts`. Mobile continue now sends server-issued `pendingInputId` + `expectedBriefRevision` + typed `field`. Assumption replace sends revision and adopts a child run. Deepen no longer falls into verification. Hierarchical write plans from the original assertion basis with deduped section keys. Mobile **311/311**. Backend unit **242/242**. brief-continue **9/9**. followup-explain **4/4**. **Not merged to `main`.** Native current-HEAD APK still blocked. Exact-SHA PG 541/541 still `f627b2b`. Live J8/J11 not rerun.

## Review closures — 2026-09-19

Product work after `95432e9` on `grok-v8/research-beta-integration`. Ordinary follow-ups (`Why did you choose that one?`) POST `/v1/runs/:id/follow-up` as `{message}` and render an inline explanation without a child run. The composer stays editable while research is running; an empty field still morphs to Stop. Evidence-sheet **Verify this conclusion** binds `claimIdForReportBlock` for the opened citation. Reduce Motion no longer stops the elapsed-time clock. Complex writer jobs call `write_report` per hierarchical section and `stitchSectionDrafts`. Mobile **308/308**. Backend unit **242/242**. Follow-up explain integration **4/4**. Synthetic 100-block/100-citation workload test. **Not merged to `main`.** Native 95432e9 APK still uninstalled (wireless adb drop). Live J8/J11 not rerun. No competitor-superiority claim.

## Phase B freeze SHA — 2026-09-19

`grok-v8/research-beta-integration` **`95432e9`**. Phase A gate held at `f627b2b`. Mobile **304/304**. Clarification activity now carries the consumer-safe needed-detail text; the phone reads it into the blocking card.

Native: EAS **`a7e10417`** git **`95432e9`** sha256 `af2bba0e8c41a431b45e593edd20ca0b284c0cfe1d2dca3d3dbbc110002caaa8` **built**. `adb install` failed after download: wireless debugging on `10.0.0.167:43417` dropped (host still pings; TCP 43417 connection refused). Last successful device install is EAS **`fa55ec29`** git **`ae395ef`** (TOC gate: no jump-list on the 8-block fixture report). 45ccf87 still holds IME/library/sheet/empty/settings captures.

**Not merged to `main` (`8a7b1a9`).** No GHA. No new paid spend. Research Beta is not declared. No competitor-superiority claim. Remaining: 95432e9 clarification-card device recapture until adb returns; iOS; live J8/J11.

## Phase B remaining consumer chrome — 2026-09-19

`grok-v8/research-beta-integration` worktree `/home/oranolio/Desktop/deep-v8-integration`. Composer optical sizes (52pt dock, 36px send, 44px hit, 4-line cap), live Research Trace (phase groups from public-activity.v1, row/collapse motion, follow-latest unless the user scrolls up), long-report TOC, quote-first sheet with `Technical details ›`, Library preview/share, Settings 56pt rows + Help/About. **No new dependencies.** `pnpm --filter @deep/mobile test` **300/300**. Typecheck 0. **Not merged to `main`.** No APK; native screenshots remain a parent-owned visual loop. Rollback: revert this feat(mobile) commit.

## Phase B consumer chrome — 2026-09-19

SHA **`8266c91`** plus elapsed-clock fix on this commit. Product-state map, composer/trace/report/library chrome, no new UI libraries. Mobile **300/300**. EAS Android `device` **`d06aa7f7-0ff9-4546-873f-b824dfda29bb`** FINISHED; APK sha256 `4c678aef…` installed on `10.0.0.167:43417`. Captures: empty home, library, settings, clarification. UI DoD **not** closed (IME, dark, report, Gboard). **Not merged to `main`.**

## Phase B product-state map — 2026-09-19

Phase A gate held at engineering SHA `f627b2b` (docs `3c8383e`). Product-state → UI-state map is `verification/v8/phase-b/PRODUCT_STATE_UI.md`. Composer placeholders and collapsed Research Trace copy follow specs 14–15. Mobile 292/292. **Not merged to `main`.** No new APK yet. Native visual loop not done.

## Phase A Wave I engineering SHA — 2026-09-19

`grok-v8/research-beta-integration` **`f627b2b`**. Isolated worktree. **Not merged to `main` (`8a7b1a9`).** No GHA. No new paid spend. Research Beta is not declared.

At this SHA: `pnpm verify` twice EXIT 0 (core 312 / backend unit 240 / mobile 291 / governance 6/6); fresh migrate 49 including `050`; upgrade from main-era `001`–`046` to `050`; PG full **541/541** twice (`deep_v8_pg1`, `deep_v8_pg2`); extraction **55/55**. Mobile functional code unchanged; historical APKs are not this SHA. Phase B UI has not started.

## Phase A Wave D retrieval (ENG-011–021) — 2026-09-19

Lane `codex/phase-a-retrieval` merged onto integration. Durable iteration bounds, confirmed+held remaining (not lagging `spent_micro`), per-source read degrade, unknown abandoned reads, URL canonicalization, redirect policy, prefer vs only, curated vendor/standards primary hosts, required unknown freshness, effective date/version metadata, and best authorized source version. Attachment challenge searches still use exact query approval (not a permanent block). Migration `049_retrieval_recovery.sql`. **Not merged to `main`.** Isolated PG `deep_phase_a_retrieval_waved`; no live spend.

## Phase A API/DB/injection (ENG-037/043/044/045) — 2026-09-19

Lane `grok-v8/phase-a-api` merged onto integration. Additive migration `050_phase_a_invariants.sql`. Owner/spend FKs and CHECKs on 042–046 tables are `NOT VALID`; historical rows are not rewritten. Source-injection S01 extended. Intent compiler labeled `rules_plus_provenance_checked_overlay`. `planTypedQuery` does not copy private/source wording. **Not merged to `main`.** Research Beta is not declared.

## Phase A follow-up grounded explanation — 2026-09-19

Lane `grok-v8/phase-a-followup` on Wave A SHA `73d5526`. **Not merged to `main`.** ENG-033: `POST /v1/runs/:id/follow-up` kind `explain` now answers from the latest owned report and authorized passage exact texts (`explain-from-existing-evidence.v1`). It does not mutate the brief, invent citations, or admit a child run. Incomplete owned evidence returns an honest answer plus `needsTargetedResearch`. Error handler preserves HTTP 400–599.

## P0 revision/cost/reconciliation — 2026-09-19

`/continue` and assumption **replace** commit a new brief row and bump `runs.brief_revision`; the prior brief stays. Confirm-only updates confirmation metadata. Known-zero `failed` 404s settle; 429/transport HOLD. Reconciliation v2 does not confirm from paraphrase overlap. **Not merged to `main`.**

## Full PG twice at d88cf62 — 2026-09-19

`grok-v8/research-beta-integration` SHA `d88cf62`. Isolated fabricated-transport PG:

- `deep_v8_int13` **505/505 EXIT 0** (1025s)
- `deep_v8_int14` **505/505 EXIT 0** (998s)

`RB-TEST-02` is PASS at this SHA. **Not merged to `main`.** Research Beta is **not** declared (live journeys, native IME, visual overhaul, and remaining matrix FAILs remain).

## Full PG int12 — 2026-09-19

SHA `6280f95` isolated `deep_v8_int12`: **501 passed / 4 failed / 505**. Failures were Wave 5 per-conclusion challenge adding a second plugin search in the counterevidence crash test (target preservation still held). Test updated to allow bounded extra challenge searches and require a `conclusion_challenges` row. **Not merged to `main`.** Research Beta is not declared.

## Wave 1 briefs ported (FP-001/002/007/008) — 2026-09-19

Ported onto integration after independent review rejected a wholesale merge (would revert Wave 3 unclassified fail-close). `/continue` does not rewrite `originalQuestion`. Confirmed geography is appended to the public query only. Manifest accepts `model-input.v6`. Production Indiana continue test passed on isolated `deep_v8_wave1_port`. Residual: same `brief_revision` still mutated in place. **Not merged to `main`.**

## Wave 7 public activity contract (FP-077/078) — 2026-09-19

Merged `grok-v8/fix-wave7-mobile-contract` `c3d7da1` (repair `3d936a8`) onto integration after independent review. `/events` returns `public-activity.v1` only. Schema-fail phase is canned `researching`. RFC1918/`.internal` cannot become `sourceDomain`. **FP-085 IME is not closed** (no physical Gboard shot). Worker-local ADR067 remapped to ADR072. **Not merged to `main`.**

## Wave 2 provider attempt chain (FP-011/012/014) — 2026-09-19

Merged `grok-v8/fix-wave2-provider` `7d78510` (impl `8fcf103`) onto integration after independent review. Extract/support `repairPass` requires known-cost `invalid_output`; unknown HOLD is not resent. Migration `045_model_operation_attempts.sql`. Worker-local ADR070 remapped to ADR071. **Not merged to `main`.**

## Wave 5 intelligence (FP-030/049/051/052/053) — 2026-09-19

Merged `grok-v8/fix-wave5-intelligence` `b51c878` (impl `27beb17`) onto integration after union with Wave 3 `runPublicSearch`. Migration `046_research_controller_state.sql`. Opening search keeps digest-scoped approval and skips re-issue on crash via durable `search_operations`. Completeness requires durable `queriesAttempted` plus exhaustion stop proof. **RB-CAND-01 is not PASS.** **Not merged to `main`.**

## Wave 3 query-privacy (FP-022–025) — 2026-09-19

Merged to integration after review. Unknown tokens unclassified/blocked; pending approval consumed in place; digest+term proofs. Residual worker Gate A is fail-closed. **Not merged to main.** FP-025 not fully closed.

## Wave 6 FP-068 limited-publication coverage — 2026-09-19

Lane `grok-v8/fix-wave6-publication` `5141bbd` merged to integration after independent review. **Not merged to `main`.** Limited reports restore structured coverage; dropping an unresolved critical criterion is rejected. Arithmetic tests not weakened.

## Wave 4 search/read (FP-029/FP-033) — 2026-09-19

Lane `grok-v8/fix-wave4-search-read` `b01f37e` merged to integration after independent review. **Not merged to `main`.** New Azure live searches use `public-discovery-azure-zdr.v3` with `max_results=8`; frozen v1/v2 stay 3. `executeSourceRead` reports finished `full-text` as readable. No paid live 8-hit receipt. Research Beta is not declared.

## Engineering fix-pass started — 2026-09-19

Audit ingested. Isolated implementers running for Waves 1–4 and 7. Full PG **480/480 EXIT 0** on `deep_v8_int10` (process started on the calculationKeys tree). Second fresh-DB run `deep_v8_int11` launched against `72c78ea`. **Not merged to `main`.**

## Engineering fix-pass started — 2026-09-19 (audit import)

Audit package ingested at `verification/v8/engineering-fix-pass/` against SHA `906c00f`. **UI phase deferred.** `main` stays `8a7b1a9`. 126 findings in `ISSUE_REGISTRY.csv`. Wave 1 starts with immutable originalQuestion (FP-001/002/008). Writer `calculationKeys` no longer stripped by `selected:false` (FP-073). **Not merged to `main`. Research Beta is not declared.**

## Fail-closed checkpoint (WIP) — 2026-09-19

Lane `grok-v8/research-beta-integration`. **Not merged to `main` (`8a7b1a9`). Research Beta is not declared.**

Live-quality salvage had fail-opened deterministic gates. This checkpoint keeps the repairs plus honest red PG:

- `repairSupportAssessments` does not invent extract assessments or fill explicit empty evidence.
- `repairCoverageReview` does not invent a full review from zero questions.
- Brief span salvage is not applied to strict `openrouter-azure-mini-zdr-text-v1`.
- Null-scope selected contradictions are inspected again.
- Extract-support after an evidence-revision bump throws `support_extraction_basis_changed`.
- Counterevidence runs on supported claims again.
- Coverage continuation requires a distinct criterion query; generic-web does not pivot on the same question after unreadable hits.

**PostgreSQL (`deep_v8_int9`):** 473 passed / **7 failed** / 480 at the first fail-closed commit. Follow-up: subsumed criterion queries are not re-issued; `invalid_output` with unknown cost HOLDs (404 stays failed). Focused gateway retest: readable true/false, correction membership, and unknown-support **passed**; **2 still failed** — arithmetic parent `completed_with_limitations` vs `completed`, and `unsupportedProse` unpublished.

**`pnpm verify`:** recorded on this tree immediately before push (see ledger). **Do not treat 475/475 at `09c5633` as current.** Hosted GHA still owner-declined. APK `1021057` is behind this checkpoint.

## Native APK 1021057 visual QA — 2026-09-19

EAS `5f4cd0e7` device APK git `1021057` sha256 `a3adc4de…` installed `adb -r` on `10.0.0.167:43417` (no wipe). Full v8k screenshot matrix reviewed. IME suggestion bar still covers send. **Not merged to `main`.**

## J11/J12 live + caveat tests — 2026-09-19

Focused research-core 76/76 and backend units 224/224 after caveat-citation and token-admission tests. Live J12 `51f73565` published OWASP Prompt Injection `d8c5ebcc`. J11-c extract grounded 321-mile / $37,900; writer body unpublished. Ledger **1,070,594 µ**. Device unlocked; installed APK is not HEAD. **Not merged to `main`.**

## J10 official-source cited wage report — 2026-09-19

Lane `grok-v8/research-beta-integration`. Live J10-e run `6fb90ce8` published report `3e4eb8d8` (`completed_with_limitations`) after mid-run `Only use official sources` (`kind=steer`, identities not mutated). Adopted sources were dol.gov and uscode.house.gov. Owned US Code span `(C) $7.25 an hour, beginning 24 months after that 60th day;`. Ledger **919,563 µ** of the **2,000,000 µ** cap. Unknown holds not retried. **Not merged to `main`. Research Beta is not declared.**

Remaining external blockers: hosted GitHub Actions owner-declined; physical Android recapture while `mDreamingLockscreen=true`; J8 needs a user private attachment.

## Live public-web grant used — 2026-09-19

User authorized the OpenRouter key for a **new $2.00 public-web cap**. Isolated ledger `deep_v8_live_j12`. Confirmed spend **72,555 µ**. Azure ZDR search and source reads ran; no published report yet (`extraction_invalid_output` on a later pass). MC-D01 unknown hold **not** released. Hosted `verification.yml` still billing-locked; local equivalent ran (integration R01 timeframe assertion updated). **main not merged. Research Beta not declared.**

## Research Beta matrix fill — 2026-09-19

Filled kit `35_ACCEPTANCE_MATRIX.csv` at `verification/v8/research-beta/35_ACCEPTANCE_MATRIX.csv`. Product APK `2eb385b` / EAS `7e4b02c8` visual matrix recaptured (clarification, expanded activity, correction, large text, offline Retry). Intent NL corpus is 52 unique questions. **Not merged to `main` (`8a7b1a9`). Research Beta is not declared.**

External blockers (user action required):

1. **RB-CI-01** — hosted `verification.yml` run `35437540425` on `6cfec73` did not start (0 steps): GitHub account locked for billing. Prior runs `35411856817` / `35421735059` / `35422066858` same. Local `pnpm verify` is not a substitute.
2. **RB-LIVE-01/02/03** — need a **new** OpenRouter public-web grant **≥ $1.20** (recommended **$2.00**) distinct from $0.40 MC-D01 frozen-SQLite, **and** explicit release of the **21,658 µ** unknown hold. A key being present is not that grant.

See `verification/v8/research-beta/EXTERNAL_BLOCKERS.md`.

## Consumer brief card + cited-in — 2026-09-19

HEAD `2eb385b`. EAS `7e4b02c8` APK sha256 `6ded85d00989a33bc89aeb186261f4d715b7f62de71aaa6781141b3d141df9cb` installed on `10.0.0.167:43417`. Non-blocking brief no longer dumps desiredOutcome; source-sheet “Cited in” ellipsizes. Device source-sheet recaptured. **Not merged to `main`.** Research Beta is not declared. External blockers unchanged.

## Native APK 4a4948e visual QA — 2026-09-19

EAS `d2a06da7-a9c1-411a-83e3-843bc6da5797` git `4a4948e`. Installed on `10.0.0.167:43417` (`adb install -r`, no wipe). APK sha256 `1becfe79fc548dc2591a5d55744b91b25275d5b4e2402b16373b4579fcbc397e`. Screenshot matrix under implementer `visual-qa/v8i/`. Composer, empty light/dark, keyboard, clarification (composer hidden), expanded real activity, report, source sheet, Library hairlines, Settings, large text, offline Retry reviewed on device. **Not merged to `main`. Research Beta is not declared.** External blockers unchanged: GitHub billing lock; live public-web grant ≥ $1.20 + 21,658 µ hold release.

## Public activity + deep discovery wiring — 2026-09-19

Lane: `grok-v8/research-beta-integration`. **Not merged to `main`.**

**Applied:** Mobile activity labels now include intent/search/source/evidence/report events that the worker actually emits. Admission records `intent_compiled`. Discovery continuation can use the deep ceiling (6) and a distinct source class without repeating a spent class. Library rows use theme hairlines (no hardcoded black). Tests: research-core coverage ceiling, mobile activity/library, public-activity mapping.

## Hybrid intent compiler v2 — 2026-09-19

Lane: `grok-v8/research-beta-integration`. **Not merged to `main`.** Research Beta is not declared.

**Implemented:** `research-intent-compiler.v2` — deterministic preflight plus provenance-checked structured semantic overlay. `should I take the Seattle offer?` is `relocation_decision` with geography seattle, not `other`. External overlays that invent California or grant tools/budget/consent are rejected. Typed material clarification fields (jurisdiction, budget, use case, population, timeframe, platform, private-search, unnamed subject) ask at most two times; default remains assume/branch. Mobile: `ResearchHeader` / `EmptyHome` / `useKeyboardInset` extracted from `App.tsx`; composer hidden while `awaiting_input`; clarification placeholder is field-specific.

**Verified:** `@deep/research-core` 235 tests; `@deep/mobile` 280 tests + typecheck; `validate_review.py` ok. No live spend. No new APK (chrome split, not a visual overhaul).

**True external blockers unchanged:** GitHub Actions billing lock (latest run `35422066858`); live J1–J12 needs a **new** OpenRouter public-web grant ≥ $1.20 (recommended $2.00) and release of the 21,658 µ MC-D01 unknown hold. A key being present is not that grant.

## Research Beta integration checkpoint — 2026-09-18

Lane: `grok-v8/research-beta-integration` at `5c3be97`. Starts at `main@8a7b1a9`. Merged C `0a694f9`, final A `8abcffd`, current B `e0b00df`. Canonical migrations `042_model_portfolio.sql` then `043_retrieval_intelligence.sql`. **Not merged to `main`.** Research Beta is not declared.

**Executed:** Full PostgreSQL **475/475 twice** (`deep_v8_int5`, `deep_v8_int6`). Device APK `30ceccbe` (`5c3be97`) installed; New research from awaiting_input and Android Back stay inside Deep (`v8h`). `pnpm verify` EXIT 0; frozen extraction 9/9; discovery v3 `max_results=8`.

**True external blockers (user action required before merge):**

1. **Live J1–J12 (RB-LIVE-01/02/03).** Recorded grant is **$0.40 MC-D01 frozen SQLite only** (confirmed $0.0005388; **21,658 µ unknown hold unreleased**; `legacyUnknownsReleased: false`). That grant does **not** cover public-web admission → search → source read → report → correction. A key being present is not new authority. Required: a **new** OpenRouter live public-web spend identity, distinct from MC-D01, of **at least $1.20** (12 × `DEFAULT_RUN_BUDGET_MICRO` $0.10) and **$2.00 recommended** to cover J7 correction plus unknown-hold buffer; **and** explicit release of the 21,658 µ MC-D01 unknown hold. Scope: kit `38_USER_JOURNEYS.md` J1–J12.

2. **Hosted CI (RB-CI-01).** Workflow `verification.yml` on `grok-v8/research-beta-integration` still does not start: run `35421735059` (HEAD `9c80076`) annotation *The job was not started because your account is locked due to a billing issue.* Prior run `35411856817` same. Unlock GitHub billing, then re-dispatch.

Rollback: leave `main` at `8a7b1a9`; do not merge this branch.

## Integration merge B — 2026-09-18

Lane: Research Beta integration. Session B `e0b00df` merged after C and final A. Retrieval intelligence will be canonicalized to `043_retrieval_intelligence.sql`.

## Integration merge A — 2026-09-18

Lane: Research Beta integration. Final Session A `8abcffd` merged after Session C. Portfolio migration from A is `043_model_portfolio.sql` (C had `042`); canonicalization is next. Session B not yet merged.

## Integration merge C — 2026-09-18

Lane: Research Beta integration. Branch `grok-v8/research-beta-integration` from `main@8a7b1a9`. Session C `0a694f9` merged as product/UI baseline. Main-only correctness is preserved. Not yet merged: final Session A tip `8abcffd`, Session B `e0b00df`. Duplicate portfolio migrations not yet canonicalized.

## Wave 5 intelligence persistence — 2026-09-19

Branch `grok-v8/fix-wave5-intelligence` SHA `ef0b679` off `origin/grok-v8/research-beta-integration` (`b30073e`). **Do not merge `main` or integration.** Migration is `046_research_controller_state.sql` (not 044/045). FP-030/049/051/053: production structured worker reconstructs discovery queries/classes from `search_operations`, persists Evidence Needs, wires the candidate ledger with exclusion evidence, and stores independent per-conclusion challenges. Existing `counterevidence_checks` unique key is unchanged.

Focused evidence after rename: Wave 5 PostgreSQL `processRun` 3/3, 54.75s, exit 0. Not a full PG twice claim and not Research Beta. **RB-CAND-01 is not PASS.**

## Subagent implementation checkpoint — 2026-09-18

GitHub main already contains66df545 and all previously outstanding commits. User-authorized subagents completed bounded database authorization batching, exact deletion-race synchronization, mobile source focus/Android Back repairs, redacted schema diagnostics, and immutable Azure discovery-v3 routing. Root added explicit registered continuation for a distinct task while the earlier timeout remains held (ADR061/062). Consent2026-09-18.2 clarifies discovery generation and requires renewal. No new paid call has occurred yet.

Intermediate combined verify passes173core/192backend/216mobile plus configured types/boundaries. Focused actual PostgreSQL:13append/context,3held-intent,6discovery/span/diagnostic cases pass; selected25-passage journey passes unchanged. Prior frozen f12c2fc suite finished456pass/2fail with one unhandled rejection; failures and repairs are preserved. Frozen8a7b1a9 verify passes173core/192backend/216mobile/6governance/types/boundaries; Android JavaScript export passes (not native). Frozen PostgreSQL finished456pass/11fail across36files in1782.83s:10timeouts and one counterevidence replay expected2transportcalls but observed3 (cause unverified). Shared workstation memory/swap pressure is recorded separately and does not excuse failed assertions. Focused query timing and replay-call reproduction are next; no limits/assertions changed.

The $0.40 aggregate OpenRouter cap still includes539micro accounted confirmed cost and21658micro retained unknown reserve. Next registered task is MC-D03 using public Python documentation, same account/key/scope, distinct from the timed-out SQLite question. Any new unknown stops the run. Useful real-model report/correction and broader heldout quality remain unproved; W10 native/hosted/release gates stay separate. Rollback disables new continuation/v3 admission while retaining all historical policy readers, privacy/publication checks, receipts and holds.

## Session C visual overhaul (tabs/search/plus/header) — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Implemented:** Research is the only home. No bottom tabs. Header: Library glyph, “Deep” / truncated question, New research pencil, avatar → Settings. Searching is a live sentence + 4-dot shimmer + elapsed, not a bordered Researching card. Composer: quiet ring when empty, teal ↑ when text, Stop while running, Retry when pending. Plus opens Add sources (Files + Paste note). Empty home is only “What do you want to know?” plus example chips. After answer: flush-left body, `[n]` citations, follow-up questions, no Concise/Detailed, no always-on Correction card, no previous-version twin. Adversarial review cycle applied (visual, RN lifecycle, truthfulness) and re-run; remaining majors fixed (Back/source order, source counts, continue-thread attachments).

**Verified deterministic:** `pnpm --filter @deep/mobile typecheck` exit 0; `pnpm --filter @deep/mobile test` 259 passed. **Native for this pass:** EAS device APK in progress after this commit.

Rollback: revert the visual-overhaul commit on this branch.

## Session C error/offline/empty-progress one-liners — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Specified + implemented:** offline / failed research / cancelled / waiting for server are one status line each (Retry when applicable); composer stays mounted; no Sample-answers chip banner and no status card for empty progress. Canonical: `specs/MOBILE_SCREEN_STATES.md` §5 + Failures chrome; helper `apps/mobile/src/research-status.ts`.

**Verified deterministic:** `pnpm --filter @deep/mobile test` 259 passed; typecheck exit 0; `validate_review.py` ok. **Native for this pass:** no.

Rollback: restore Sample-answers banner, offline caveat paragraph, and ResearchActivity card for zero-event waiting.

## Session C continue-thread composer — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Fixed Update vs Research leftover after a report:** continue-thread composer uses placeholder `Ask anything`, circular up-arrow send (not an Update pill), and header New chat as a pencil (`create-outline`) instead of a “New research” text link. Corrections still submit through that composer (`composerContinues` → `onCorrect`). Fresh empty research keeps `What should I research?` + Research pill. Mobile typecheck + 259 Vitest pass. Native rebuild of this pass: no.

Rollback: restore Update/`Add a detail or correction…`/`New research` text chrome on the continue path.

## Session C follow-up chips — questions above composer — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Specified and implemented:** suggested next asks sit in the composer dock above the field (not under the answer), max 3, question copy from unresolved/caveats/limitations, labels ≤42 / prompts ≤160, stay visible with the keyboard, never dump multi-kilobyte caveat text into the draft. Canonical: `specs/MOBILE_SCREEN_STATES.md` §8; `apps/mobile/src/follow-ups.ts`. Focused Vitest `test/follow-ups.test.ts` covers the contract.

Rollback: revert the follow-up module/App draft-fill/spec hunks; prior truncated-caveat chips return.

## Session C live source appearance — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Specified + implemented (truthful):** During search — Grok-style activity lines; domain pills only when a public event `publicSummary` already contains a safe `http(s)` URL; no inventing hosts; no third-party favicon CDN (`faviconUri` stays null until owned icon bytes exist). After search — numbered citation chips (no UUIDs); quote-first source sheet unchanged. Canonical: `specs/MOBILE_SCREEN_STATES.md` §§4 and 7; helper `apps/mobile/src/live-source-appearance.ts`; wired in `ResearchActivity`.

**Verified deterministic:** focused `@deep/mobile` Vitest (`live-source-appearance`, `citation-chips`, `research-activity`, `source-sheet-evidence`) + typecheck exit 0. **Native for this pass:** no. Public events still omit payload locators, so pills stay empty on current fixture/live summaries unless a URL is literally in `publicSummary`.

Rollback: remove pills helper/wiring and §4/§7 live-source paragraphs; numbered chips and quote-first sheet remain.

## Session C calm Profile + ADR062 chrome — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Implemented:** No bottom tabs. Research is primary; Library is full-screen from header **Menu** and **Profile → Saved reports**; Done/Android back return to Research. Calm Profile: avatar/account, Appearance (system/light/dark, AsyncStorage), Privacy (consent switch + disclosures/deletion), quiet Demo mode switch, Sign out. Purchases/push remain unavailable. Canonical: `specs/MOBILE_SCREEN_STATES.md` Navigation + Profile paragraph; ADR064. Wide left-drawer Library and swipe Share/Delete polish remain open.

**Verified deterministic:** `pnpm --filter @deep/mobile test` 259 passed; typecheck exit 0. **Native for this pass:** no.

Rollback: restore two-tab chrome and the jargon Settings scroll; keep deletion confirmation and route identities.

## Session C Library navigation spec — ADR064 — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Specified (chrome now landed above):** Library survives without a bottom tab. Research is the sole primary destination. Library opens full-screen on phone (left drawer/pane on wide layouts) from header Menu and from Profile → Library. Rows: title, status Ready/Researching/…, version, time; search, share, swipe; dark/light via design tokens. New research clears local focus from Research or Library chrome without cancelling server jobs or deleting history. Canonical: `specs/MOBILE_SCREEN_STATES.md` Navigation + §9; ADR064.

Rollback: revert the ADR064/doc commit; prior two-tab chrome remains until implementation lands.

## Session C dark chrome tokens — isolated branch checkpoint — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`, worktree `/home/oranolio/Desktop/deep-v7-product`. Not merged to `main`.

**Specified dark (and matching light) chrome tokens** in `packages/design`: `composer`, `thinking`, `userBubble`, `stop`. Dark keeps cream/ink/teal calm contrast — warm raised composer pill `#1F1C19` + teal send `#7EC4BC`, not DeepSeek `#0F0F0F`, ChatGPT green, or a Grok black-circle stop. Wired into composer pill, activity trail, question bubble, and Stop chip. Spec note in `MOBILE_SCREEN_STATES.md`.

**Verified deterministic:** `@deep/design` typecheck; `@deep/mobile` typecheck; focused Vitest including `design-chrome-tokens`. **Verified native for this pass:** no. **Product-quality verified:** no.

Rollback: revert the chrome-token commit on this branch.

## Session C engineer review cycle — isolated branch checkpoint — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`. Not merged to `main`.

**Fixed from aggressive client review:** composer continue no longer falls through to a leftover new run; New research exists; parent/child events no longer mix; library open no longer invents `running`; attach panel stays mounted with the keyboard; Android IME no longer double-resizes; quote-first source “Cited in”; numbered citations deduped; follow-ups stay visible and do not replace the whole question on `replace_question` without the original question; activity elapsed is not invented as `0s`; failed trails are not labeled complete.

**Verified deterministic:** `@deep/mobile` Vitest + typecheck on this pass. **Verified native for this pass:** pending EAS rebuild. **Not integrated:** Session B (uncommitted at `66df545`, migration 042 clash). **Product-quality verified:** no.

Rollback: revert the review-cycle commit on this branch.

## Session C design-review craft pass — isolated branch checkpoint — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`, worktree `/home/oranolio/Desktop/deep-v7-product`, base `66df5455de86129db0305f3c96dc3dbf1a13b7e3`. Not merged to `main`.

**Implemented from independent design critiques:** collapsed truthful activity with elapsed pulse; sentence-case trail (no ALL-CAPS details); numbered citation chips instead of UUID stubs; un-carded answer-first report; composer continues a finished report instead of leftover new-run; 1–3 follow-up chips from unresolved/caveats/limitations only; quote-first source sheet; Sample labeling; Share report; hide tabs while typing; 44pt hits; table cells do not shrink; home-indicator padding on the dock.

**Verified deterministic:** `pnpm --filter @deep/mobile test` 236 passed; `pnpm --filter @deep/mobile typecheck` exit 0. **Verified native for this pass:** no — still on the earlier EAS APK `4a142400` at commit `369bc5b`. **Not integrated:** Session B. **Product-quality verified:** no.

Rollback: revert the craft commit on this branch.

## Session C product integration — isolated branch checkpoint — 2026-09-18

Lane: Product/UI + Integration. Branch `grok-v7/product-integration`, worktree `/home/oranolio/Desktop/deep-v7-product`, base `66df5455de86129db0305f3c96dc3dbf1a13b7e3`. Not merged to `main`.

**Implemented:** one-sentence composer; researching-this brief from persisted intent/brief flags; truthful semantic activity trail; editorial report; evidence sheet with named uncertainty; conversational corrections/library/settings; EAS device APK (no host Gradle).

**Integrated:** Session A `1155204` / `e9af55c` (plus earlier `8bae4c3` / `4c10e2c`). **Not integrated:** Session B (no final committed SHA; worktree still dirty on `66df545`).

**Verified deterministic:** `@deep/mobile` Vitest including domain mapping tests. **Verified native:** EAS APK `4a142400-ddac-41be-a7a7-8115c448f0d6` on 10.0.0.167:43417, two fixture no-file journeys. **Verified live provider:** Session A's bounded Azure briefs (`verification/v7/live-semantic/`); not a full source-backed report+correction. **Product-quality verified:** no. **Blocked external:** Session B handoff commit.

Rollback: revert this branch; disable the local-dev cleartext plugin for any HTTPS-only build; Session A rollback remains disable portfolio/intent at admission.
## Session A agent contract — 2026-09-18

Root and scoped `AGENTS.md` now require: finish independent work instead of listing it; apply gates on the live path rather than only recording them; compile one-sentence questions without cosmetic interviews; keep fixture/live/native/hosted evidence distinct; edit only the assigned worktree.

## Session A intelligence governor — isolated branch checkpoint — 2026-09-18

Lane: Research Intelligence + Model Governor. Branch `grok-v7/intelligence-governor`, worktree `/home/oranolio/Desktop/deep-v7-intelligence`, base `66df5455de86129db0305f3c96dc3dbf1a13b7e3`. Not merged to `main`.

**Implemented:** one-sentence intent compiler + clarification-value; versioned `research-portfolio.v1` cheap-first routing applied on new runs (explicit pins remain privacy-admitted; parents inherit); fail-closed when no route is admitted; bounded escalation; unknown-outcome hold; optional cache token receipt fields; hierarchical verification/writing leftover enforced on live `reserveLiveAttempt` for exploration and structured; document-grounded live eval uses an owned passage; dated portfolio eval runner with no superiority claim; live semantic task-class gate on the existing fail-closed authorization path; additive migration `043_model_portfolio.sql` (final A schema; will be canonicalized to a single `042_model_portfolio.sql` on this integration branch).

**Verified deterministic:** research-core intent/policy suites; backend governor/gateway/eval-live/portfolio-eval unit tests; focused PostgreSQL `model-policy.integration.test.ts` on isolated `deep_research_session_a_governor`. Legacy OpenAI request digest unchanged.

**Verified live provider:** bounded Azure briefs via `pnpm eval:live-semantic`. After v2 span repair, criterion-question linking, and a stricter brief prompt, the previously failing classes succeeded on a new logical request (purchase, technical comparison, Germany/France correction, unknown-lot-code) with confirmed receipts in `verification/v7/live-semantic/run-fix-receipts.jsonl`. Earlier `invalid_exact_span` / `criterion_without_question` receipts and the freshness `outcome_unknown` hold are retained and were not retried. **Product-quality verified:** no (these are briefs, not source-backed reports). No routing superiority claim.

Rollback: disable new portfolio admissions and intent compilation at run admission; retain historical `model_policy_id` readers, unknown holds, publication/deletion gates. No claim that dynamic routing is better.
## Session B retrieval/evidence lane — 2026-09-18

Lane `grok-v7/retrieval-evidence` (worktree `/home/oranolio/Desktop/deep-v7-retrieval`, base `66df5455de86129db0305f3c96dc3dbf1a13b7e3`) implements provenance-aware query expansion, source-type planning, evidence-value breadth, structural neighbor selection, origin clustering, criterion freshness and document/web reconciliation (ADR062, migration044). Mixed-document public search remains blocked without explicit approval. No new npm/Python dependency. Neural rerankers, full Docling/ML, OCR and Playwright/Crawl4AI are not adopted.

Verified deterministic: research-core 198/198 twice; focused PostgreSQL `retrieval-evidence.integration.test.ts` 3/3 twice on isolated `deep_research_session_b_20260918`. Live provider, native Android and merge to `main` are unrun and owned by other lanes. W01–W09 semantic acceptance remains incomplete.

## User-authorized GitHub main checkpoint — 2026-09-18

The user explicitly requested merging all outstanding code into GitHub main and continuing work. All20 commits ahead of origin/main4d818fe belong to this continuation; the older evidence branch is already an ancestor. No deployment workflow is triggered by push (verification is manual-only). This checkpoint includes the actual provider failures and local successes; it is not a release approval or a claim of passing all checks.

The frozen f12c2fc serial PostgreSQL suite is still running. Its partial checkpoint already contains one25-passage test timeout; previous mixed-source/concurrent run had452pass/6fail. Full units/types/boundaries and six actual-parser correction controls pass. Live source-backed report/correction remains unproved. Exact evidence status: verification/v6/zdr-route/RESULTS.json. Continue verification and repair after merge; retain all timeout holds and original receipts.

## Azure route works; exact-quote repair under local verification — 2026-09-18

Runtime634a8c8 made real Azure/OpenRouter requests while preserving ZDR. Registered MC-D01 produced2attempted/4planned steps: A1 returned HTTP200 with a separately retrieved generation receipt for$0.0005388, but failed invalid_exact_span; B timed out without a provider ID. Neither produced a report; correction and full rerun remain unrun. The timeout retains21658micro of provider reserve and the admitted account allowance. Current key remaining is$4.785384 as of17:41UTC; aggregate usage does not settle the unknown request. No further paid call is being issued.

Runtimef12c2fc (ADR060) adds an opt-in immutable v2 policy for resolving unique exact quotation coordinates, followed by unchanged binding/publication checks and an intent-bound audit event. Pure7/7 and focused PostgreSQL20/20 controls pass; complete verification and actual PDF/HTML correction controls are running. The earlier broad PostgreSQL run has two timeout failures, preserved for diagnosis; it is not called green. Original user ZIPs and legacy financial rows remain intact.

Next: finish local verification and inspect the timed-out provider outcome without resending it. A new paid comparison remains gated on that outcome under the registered protocol. W01–W09 research-quality acceptance is incomplete and W10 native/hosted/release gates are separate. Rollback disables new v2/Azure admissions while preserving existing policies, privacy, evidence checks, receipts and all unknown holds.

## Azure ZDR route implementation checkpoint — 2026-09-18

ADR059 implements immutable per-run structured provider policy, explicit Azure ZDR configuration and renewed processor disclosure. Legacy request bytes and correction inheritance are preserved. Local gateway21/21, policy PostgreSQL3/3 and selected actual PDF/HTML correction4/4 controls pass; model transport in these controls is fabricated. Initial unit/type failures are retained under verification/v6/zdr-route. Broad real PostgreSQL verification is running; no Azure live success is claimed yet.

Next executable task: finish verification, reconcile only the three documented completed404 rejections if all explicit evidence conditions hold, then run a fresh registered MC-D01 comparison under the existing $0.40 cap. User monetary authority already exists. Original legacy ledger remains unchanged. Public-discovery routing and W01–W09 semantic acceptance remain incomplete; W10 release gates remain separate. Rollback disables new Azure admission while preserving admitted policy readers, privacy/publication controls, receipts and holds.

## Accounting repair verified; ZDR route incompatibility identified — 2026-09-18

The prior historical-estimate impasse is superseded by ADR058: the user authorized the repair, original financial rows are fingerprint-verified unchanged, and the new explicitly capped evaluation period uses actual current-key capacity without double-counting history. No receipt export from the user is needed to establish this new period. Current source/check artifacts: verification/v6/forward-accounting/RESULTS.json. Final verify166core/168backend/206mobile/6governance/types/boundaries and136real-PostgreSQL gateway controls pass. The actual live comparison was attempted, not passed:1of4registered steps executed and failed before extraction/report;3steps including correction remain unrun.

Three total model requests (one registered step, two separately reserved diagnostic actions) returned404. The captured error identifies account Zero Data Retention policy excluding the pinned OpenAI endpoint. The key's reported usage remains$0.2140772 and remainingquota$4.7859228; no increase is reported. Individual cost receipts are absent, so64974micro of new reservations remain rather than being relabeled as spend or released. The old $5.545 estimates are unchanged. Raw failure traces and the startup-only diagnostic import failure are retained.

Read-only /endpoints/zdr identifies Azure for the same model at the same base tariff. Next concrete implementation is a versioned, disclosed ZDR-compatible route, preserving old run/request/receipt identities, with explicit handling of these known HTTP rejections and a new registered comparison. This is engineering work, not a request to disable privacy settings or obtain another spending approval. No processor, account privacy setting, model prompt, existing report or release authority changed here. W01–W09 remains incomplete; W10 remains separate. No native build, hosted run, deploy or push. Rollback disables new admissions while preserving both ledgers, all receipts/holds and privacy/publication gates.

## ADR058 forward-accounting repair — 2026-09-18

The user authorized fixing the mistaken preflight block. All70 historical OpenRouter intents are confirmed-state on terminal runs in the pre-receipt schema; their individual actual costs remain unknown. Their $5.545 estimates are not new unpaid charges. The original database is unchanged and fingerprinted. The authorized new $0.40 evaluation period has its own local account/ledger, with no old action resend or hold release. Provider quota is checked from the actual project key before evaluation and each step; existing active-ledger unknown/same-key reservation gates are unchanged. Details: ADR058 and verification/v6/forward-accounting/SETUP.json. This supersedes the prior operator impasse; no new user permission is needed.

Thirteen quota regressions and sixteen existing evaluator unit controls pass; backend typecheck and both metadata validators pass. The real registered MC-D01 comparison is prepared but not yet executed at this checkpoint. Runtime/publication quality remains unproved until its actual receipts/results are recorded. Rollback disables new evaluation while preserving both ledgers and every receipt/hold; no key, private token, deployment or release authority is added.

## Blocked checkpoint — 2026-09-18

Goal remains incomplete. Three consecutive turns retained the same financial-provenance blocker after explicit spending authorization. The latest read-only check on709fb2d7df28bbf28649a117d69a856a06caa41b confirms unchanged legacy OpenRouter estimates; see verification/v6/paid-readiness/PROJECT_ROUTE_RECHECK.json. No current process is being awaited, no generation was sent, no hold released and no old action resent. The first two turns completed independent clean-checkout verification and canonical-plan reconciliation; further status/fixture repetition does not prove the missing real-model journey.

Resume input: the location of the project ledger or provider receipt export that reconciles the historical entries, without credentials in chat. The $0.40 initial registered comparison already has user authority; do not ask for that permission again. Next executable work is provenance reconciliation followed by MC-D01 through the registered production API/worker baseline/adaptive original/correction/full-rerun evaluator, retaining every failure and actual cost. Broader unfamiliar-task and live-discovery evidence remains required afterward. W10 hosted/native/release gates remain distinct. This checkpoint does not claim all W01–W09 acceptance is satisfied. Existing runtime/source, unknown holds, rollback controls and three user ZIPs are preserved.

## Current paid-test authorization and clean checkout — 2026-09-18

The user explicitly authorized OpenRouter spending in this session. The first registered MC-D01 public saved-SQLite original/correction/full-rerun comparison is capped by the operator at $0.40; further monetary permission is not required for that cap. This supersedes earlier statements that current spending authorization was absent. No paid generation has occurred in this continuation; new confirmed cost is $0.

Financial provenance remains unresolved, separately from authorization. A fresh read-only key check at16:33:44UTC still reports a $5 key limit and $4.7859228 remaining. Legacy route inspection confirms real OpenRouter route names:12 original planner intents and58 web intents, all historically labeled confirmed, but56 lack confirmed amounts and retain $5.545 in estimates. The old adapter discarded provider generation IDs and used reserve values as cost, so neither state labels nor these estimates prove actual receipts. No hold was released, old action resent, database migrated or key limit changed. A ledger/receipt location was requested; credentials were not requested. Evidence and authorization: `verification/v6/paid-readiness/`.

Exact detached commit672586baca8f3416ee6aa2fd47b16f630dde9805 passes offline frozen ignore-scripts install and `pnpm verify`:166core/149backend/206mobile/6governance, configured types and boundaries. Final checkout is clean. See `verification/v6/clean-recovery/RESULTS.json`. No new native/hosted/semantic evidence follows. W01–W09 remains incomplete; W10 remains separate. Next task: resolve historical financial provenance without discarding unknowns, then execute the already-authorized registered comparison. Rollback preserves all reservations, receipts, evidence/publication gates and deletion controls.

## ADR057 verified checkpoint — 2026-09-18

Runtime `abdfee1ee623b563a0164def7e73ff94fb56d4f6` adds bounded empty-context recovery after the verified inventory support veto. Final PostgreSQL451/451 across32files, actual isolated extraction51/51, verify166core/149backend/206mobile/6governance/types/boundaries and metadata checks pass. Exact receipts, preserved failures, source hashes and original/correction traces: `verification/v6/bounded-recovery/RESULTS.json` and `HANDOFF.md`. The fresh regression now reaches decisive initially omitted evidence and replays without repeated extraction. Legacy policy, four-iteration limit, unknown holds and publication veto stay enforced.

The W01–W09 research-quality milestone remains incomplete. Across four official-document controls, executed contexts now include all8 previously inspected reference spans (0misses versus3before); fabricated model transport still yields no assertions/no report, not semantic quality or fresh heldout success. No paid generation, new native build, hosted execution, deployment or push.

Current financial preflight is gated: read-only project-key metadata reports limit$5 and remaining key quota$4.7859228 as of2026-09-18T16:14:01UTC, which is not user authority or account credit balance. Configured local project ledger lacks key/receipt attribution:56 unconfirmed OpenRouter intents hold$5.545 in estimates; its$2.80 reported confirmed amount is not receipt-verified. All legacy data/holds are unchanged. The current ledger/allowance clarification is pending; do not bypass liabilities with a fresh database or treat elapsed time as approval. Next concrete task is establish financial provenance and current authorization, then run the smallest registered real-model original/correction/full-rerun comparison. Broader OCR/layout and W10 native/hosted/release gates remain separate. Rollback retains admitted recovery/selection policies, immutable proofs, inventory veto, deletion/fences, provider identities and unknown holds.

## ADR055/ADR056 verified checkpoint — 2026-09-18

Runtime `f0640db7e12d24d96e3ad4eb3334e058c83d523b` adds bounded immutable evidence selection and a separate full-inventory deterministic support veto. Final PostgreSQL446/446 across32files, real isolated extraction51/51, verify164core/149backend/206mobile/6governance/types/boundaries, and committed contradiction probe all pass. Exact commands, elapsed times, source hashes, original failures and source/correction traces: `verification/v6/evidence-selection/INVENTORY_RESULTS.json` and `HANDOFF.md`. Earlier selector baseline443passes did not prove safety: its omitted-contradiction probe failed, and that failure remains preserved separately.

The W01–W09 milestone is still incomplete. Real saved-document reference diagnostic retains3/8 omitted spans; fabricated semantic transports produce no useful report for those official questions. No live model spend/current allowance, new native build, hosted evidence, deployment or push. Next independent implementation: bounded replay-safe recovery after an empty selected-context extraction, preserving whole evidence, immutable paid identities and the inventory veto. Real-model quality/correction/full-rerun comparison requires current project monetary authority; broader OCR/layout and W10 gates stay separate. Rollback suspends new admissions while retaining existing proof/obligation readers, inventory support, ownership/deletion/fences and unknown holds.

## Previous checkpoint — ADR054

The authorized V6 W01–W09 internal milestone remains **incomplete**. Current continuation is on `codex/v6-saved-html`, based on merged main `4d818feb1dcf8808b38c980ac2f2f204977e2d7b`. ADR054 adds bounded saved-HTML ingestion and frozen evaluation through the production parser/worker, and fixes reproduced UTF-8 scope corruption with extraction structure-v4. Current evidence is in `verification/v6/current-continuation/`; runtime implementation is643e20358c5d05a0480e701215f5f1df7963d68c; numeric regression repair is47c3c1a53e637cd83b08e04e1c8d756095dc48d4. Final PostgreSQL425/425 across31files443.46s, actual extraction51/51 and verify157core/149backend/206mobile/6governance/types/boundaries pass. Prior423pass/1timeout and424pass/1UUID assertion failure are retained with deterministic reproduction and repair. No production publication rule or timeout was weakened. Earlier checkpoint records below retain their original scope.

Both V6 ZIPs hash to `d7113650d9299893a6857d79142401f4bc5a8ca3987697b74c9dfed692c8496f`; staging is `/tmp/deep-v6-evidence-staging`. All three user ZIPs remain intact and untracked. No paid calls, deployment, push or hosted provisioning occurred in this continuation. Current monetary allowance remains unknown. Current saved-HTML support supersedes historical unsupported-HTML statements below; no semantic success follows from input availability.

## Implemented and remaining scope

| Packet | Current local implementation/evidence | Remaining scope or external evidence |
|---|---|---|
| W01 | Opposite/overstrong/unmapped claims, ownership/version/digest, missing proof and limited-publication controls; scoped support/coverage/derived-answer gates | Broad factual correctness and applicability need W05/W08 semantic evaluation |
| W02 | Atomic admission/outbox/reservations, action/attempt identity, unknown holds, receipt repair, current-clock leases/fences, cancellation/event atomicity, bounded fetch and exact retry/withdrawal | Bounded mutation review found no new confirmed defect; actual live receipt/accounting application and enforceable provider-side bounds remain separately unproved |
| W03 | Owned reports/evidence, configured identity adapter, account/source deletion with descendant invalidation and replay veto, protected content/credentials, request generations, durable deletion retry | Wider native account/lifecycle/accessibility, hosted identity refresh and external retention/backup proof |
| W04 | Actual isolated digital PDF/HTML extraction, binary upload, page/geometry/source metadata and explicit partial coverage; synthetic Android picker/upload/consent/deletion proof | Broader difficult documents/tables/columns beyond current47 actual controls, OCR/layout, native dependency remediation/compatibility and broader source-reader acceptance |
| W05 | Versioned tasks, arbitrary assertions, scoped support, durable discovery/read, coverage/refinement, generic writing, comparison, exact arithmetic, required challenge proof; requested claim checks execute queued assessment with bound recovery | Real-model applicability, broader discovery/eligibility and unfamiliar tasks; saved private feedback itself is not assessed |
| W06 | Whole-question, exact-span and append-owned-document API patches; immutable source membership; snapshot/refresh; full conservative recomputation; computed changes; correction-draft recovery; required public rediscovery and corrected/full synthetic agreement | Semantic criterion editor UI, task-specific freshness policy, selective traversal only when dependencies complete, independently adjudicated full-rerun agreement |
| W07 | Research/Library/profile, document picker, source sheet, bibliography, cancellation/reopen, protected drafts/cache, admission/verification/deletion recovery, reading anchors, profile extraction, fresh configured-route preflight, document-correction recovery and remote-deletion cache invalidation | Broader physical/iOS/hosted-auth journey, account/lifecycle/reconnect/screen-reader coverage and remaining responsibility-based refactoring; bounded current Android debug journey below |
| W08 | Default-deny executable registered evaluator with frozen PDF/HTML and same-production-path baseline/adaptive controls; actual extraction traces; frozen12task/13document corpus; corrected/full source-read measurements; retained failures | Paid real-model repetitions, independent held-out adjudication, actual invoice cost/latency and any superiority claim |
| W09 | Canonical contracts/ADRs, evidence/command registry, local clean-checkout controls, manual CI configuration, dependency findings/isolated repairs | Hosted CI evidence, remaining dependency compatibility/native gates and complete milestone audit |

## Current evidence

- `verification/v6/document-evaluation-integrated/`: reviewed working tree passes **422/422 PostgreSQL tests** (29files,439.79s), **39/39 actual extraction/API tests** (8files,114.57s), verify157core/132backend/186mobile/6governance, configured types/boundaries and651module2.21MB Android JS export. Exact-ce2f889 clean proof below covers the final account-panel reset. Initial extraction36passed/3failed is retained: an earlier synthetic unattributed hold correctly blocked evaluator execution. Evaluator controls now create and retain a fresh synthetic database; accounting and assertions are unchanged. Default evaluator invocation exits2 before any paid effect. Exact-ce2f889 clean proof passes.

- `verification/v6/capacity-formatting-integrated/`: backend source committed in b15c3d8. Full **407/407 PostgreSQL integration tests** (27 files,457.80s), **33/33 actual extraction/API tests** (6 files,87.54s), verify155 core/117 backend/136 mobile/6 governance, configured types/boundaries all exit0. Real local PostgreSQL and isolated parsers; synthetic data and fabricated provider responses.
- `verification/v6/admission-preflight-integrated/`: later mobile-only source committed in0602f96. **148/148 mobile tests**, types and **648-module2.18MB Android JavaScript export** all exit0. `admission-preflight/api-contract.log` separately proves actual authenticated settings/upload/admission/recovery on local PostgreSQL with zero provider intents. Initial mocked wrong-endpoint implementation was rejected before integration; failure and old patch retained.
- Exact0602f96 clean checkout passes frozen offline install, verify155/117/148/6, types/boundaries and648module2.18MB JS export, ending clean (`clean-final-internal/`). Prior exact5fb44af proof remains historical. Hosted manual CI has not executed. JS export is not a compiled/signed native build.
- HTML structure-v3 retains list limitations, marks struck-through text in every extracted copy and excludes comments; historicalv1/v2 receipts remain readable. Actual saved SQLite document yields75 complete blocks and54KB original/corrected request bodies within unchanged financial/byte ceilings (`sqlite-context-capacity/`). This proves extraction/serialization, not a semantic answer.
- Scoped PostCSS, Vitest4 and xcode UUID dependency repairs are committed. Audit remains **exit1: zero moderate/two high image-size findings**. Metro0.83.3 remains; isolated0.83.8 experiment is unadopted pending native compatibility. Candidate iOS prebuild is not a native build.

Every failed attempt remains in its packet and EXECUTION_LEDGER. Do not sum overlapping suites. Current design typecheck is unsuppressed. Evidence manifests pin commands, revisions, environments and artifacts. Document validators prove metadata integrity only. Same-model reviews are not independent human validation.

Exact implementationce2f889 clean checkout (`clean-document-evaluation/`) passes frozen offline ignore-scripts install, verify157/132/186/6, mobiletypes and651module2.21MB JS export, ending clean. Hosted CI is unrun. Later native debug build evidence follows below.


2026-09-18 native graph follow-up on exactce2f889: isolated Android prebuild and actual Gradle releaseRuntimeClasspath resolution pass (Gradle8.14.3,12m25s). Selected CommonsIO2.6,Codec1.10,OkHttp4.9.2,Okio2.9.0,annotation1.8.1,biometric1.1.0,React/Hermes0.81.4. Apache CVE-2024-47554 affects selectedIO2.6 through XmlStreamReader; reachability is not established and no clean native-security claim follows. Official source https://commons.apache.org/proper/commons-io/security.html checked2026-09-18. Prior ADR024 unresolved-resolution statement is historical; actual graph is now inspected. No app compilation/APK/device install/release. Root source/dependencies unchanged. Local Gradle and NDK27.1.12297006 were downloaded under the existing SDK license. Evidence verification/v6/native-graph-current/RESULTS.json. Native compatibility/remediation and current device journey remain open.

## Useful-question and correction traces

The saved SQLite WAL development question preserves the network-filesystem restriction at `list:3` and single-writer limitation at `block:10`, raw SHA256 `f3467b530b883d4a00574fe1a898b3d121ed72764ae28cf66941080ac0badb9e`. Original and corrected contexts retain all75 full blocks, identities and digests; there is no model/support/worker result for this probe. Separately, synthetic Solmere/Vesper platform correction and full rerun agree on explicit reference facts through the production worker/checker: correction reads1new source and reuses1passage; full rerun reads2. Both use8fabricated provider attempts/10synthetic micro-units. This is code-path evidence, not live semantic agreement or a cost win.

W08 frozen12-task/13-document protocol retains the original SQLite omission and slower adaptive HTML control (23.580s versus18.232s). Later parser repair does not rewrite historical gold/results or prove superiority. Real-model held-out repetitions, actual cost/latency and independent adjudication remain unpassed.

## Android and external gates

Authorized REDMI Note15 5G/Android16 last at10.0.0.167:43417, ExpoGo54.0.8. Device remains locked; user was asked once to unlock. Standalone APK is old and untouched. Latest synthetic server account/content was deleted; API/Metro/reverse mappings stopped. Protected synthetic device cache/session for account1617411b-d6bd-4aeb-98b4-9f0ebb5197e3 was subsequently cleared and verified in physical-unlocked. Do not clear unrelated Expo data. Stale-agent device attempts were stopped and recorded; no successful account read or cleanup follows from them.

Earlier bounded ExpoGo checks cover picker/consent/upload digest/deletion, PDF correction recovery, unknown-admission restart/one run/withdrawal, source/share preview and cached reading-anchor restart. They do not establish the complete current authenticated research→source→correction→share journey, native source deletion/preflight, account switching/reconnect/accessibility, recipient delivery or standalone compatibility.

W10 remains separate: hosted identity/network/storage/pooler, backups/restore/retention, abuse controls, privacy/support readiness, signed current Android/iOS and both-platform acceptance. Purchases/push remain unavailable. No production readiness claim.

## Next work and rollback

The prior0602 clean proof is historical. ADR048–050 implementation is committed as ce2f889253185455ec1cef5dc85920e10ce3b816; exact clean-checkout proof passed and metadata is reconciled. The registered runner now also supports frozen PDF inputs in the reviewed working tree; HTML slots remain explicitly unrun. The bounded current Android emulator journey is complete below; after unlock, clean the bound physical-device synthetic session and extend physical acceptance. Real paid model evaluation requires a current explicit allowance; hosted/release work requires separate authority.

Rollback disables new scheduling/acceptance while preserving128-capable immutable proof readers, extractionv1/v2/v3 receipts, ownership/tombstones, required challenge/verification/discovery obligations, publication vetoes, deletion, receipt settlement and unknown holds. Never restore fixture fallback or erase pending request identities. No background continuation is promised after execution stops.


2026-09-18 native follow-up (`verification/v6/native-current-emulator/`): actual x86_64 Android debug compilation passes on isolated ce2f889 after installing the missing JDK (first failure retained). APK SHA256 `334eef0bb20ae75ba049e0f40b8e12b5adbf4fe3dea3b3f650b515cf20b30306`, Android test debug key, not release signing. Android14 emulator runs the current workspace through Metro and development identity. Actual API/worker/isolated PDF parsing plus fabricated model transport complete report→page/geometry source→cold reopen→full-question correction→added-PDF revision→owned Markdown share preview (cancelled). Three related runs,21 fabricated confirmed calls,zero paid/unknown calls; admission-to-publication9.517/2.963/11.516s are synthetic-control timing, not live quality/latency. Original source versions/digests are reused; added PDF bytes have their own parsed source. Native tests found and repaired empty-JSON DELETE requests and false WRITING progress on invalidated terminal runs. Actual retry purges the source/dependent report; corrected cold restart shows unavailable content without a spinner. Account deletion purges report/evidence content; a second account sees empty Library; logout/cold restart clears its composer. Larger-text130% control is bounded, not screen-reader acceptance. Initial bulk ADB input truncated (cause unverified); complete correction text was checked before submission. The startup System UI ANR, regression/type failures and cleanup failures remain. API SIGTERM exited143 before cleanup; exact owned second-account teardown succeeds. Final native DB has0activeaccounts,0attachmentcontent,0unconfirmedintents;10redacted/historical runs retained. Emulator/API/Metro and emulator reverses stopped, synthetic Downloads removed; physical phone untouched. These source fixes are committed in659c335; the APK dependency graph remains ce2f889 and its Metro runtime exercised those fixes.

Frozen supplied-PDF evaluation is now integrated in the working tree (ADR052), with owned binary uploads, actual parsing, exact digest traces and expiry checks around awaited uploads. Unsupported HTML slots remain explicitly unrun with their denominators retained. Paid model evaluation and independent adjudication remain separately gated.

Exact native-fix implementation `659c335cacc4762983661a7dfa52ce9a64f642a4` passes clean detached frozen offline install, verify157core/136backend/200mobile/6governance/types/boundaries, mobiletypes and651module2.21MB JSexport (5274ms), final checkout clean (`clean-native-fixes/RESULTS.json`). No DB/native/paid rerun. Raw evidence whitespace check remains exit2 for preserved terminal logs/PDF bytes; source/canonical-doc whitespace check passes. Milestone incomplete; the subsequent frozen-PDF evaluator integration is described below.

Frozen-PDF implementation committed as `d19de6bb277be24b87f7b09324698e3a058ff60e`: full local PostgreSQL integration424/424 in401.33s and verify157core/142backend/200mobile/6governance pass. Final actual extraction/API suite passes47/47 across8files in136.65s after the review-found evaluator failure-trace repair; final backend types pass. Artifacts: frozen-pdf-integrated/RESULTS.json. ADR051 retains admitted artifacts up to8MiB, matching existing upload admission; public-fetch1.5MB cap unchanged. ADR052 uses digest-pinned owned PDF uploads through the same API/worker/parser/writer/checker, durable per-upload journal and expiry checks. Official RFC9112/TMP117/ESP32 yield46/50/78actual passages but no useful report with fabricated transport: two no-relevant-assertions outcomes and one model-context-exceeds-policy. This is retained failure evidence, not semantic success. Unsupported frozenHTML, OCR/complex layout and larger-context capacity remain explicit local limitations, distinct from paid/human/hosted gates. Rollback disables new evaluation/uploads while preserving admitted8MiB artifacts, immutable proofs, deletion, financial settlement and unknown holds.

Exact frozen-PDF implementation `d19de6bb277be24b87f7b09324698e3a058ff60e` passes clean detached offline frozen ignore-scripts install and verify157core/142backend/200mobile/6governance/configuredtypes/boundaries, finalgitstatusclean (`clean-frozen-pdf/RESULTS.json`). No repeat native/export/DB/paid execution. Current local implementation/checkpoint work is complete; overall semantic milestone remains incomplete. Next requires a current bounded paid evaluation authorization and independent adjudication; broader physical/accessibility/hosted gates remain separate. UnsupportedHTML/OCR/large-context limits remain explicit local partial capabilities, not disguised external gates.

2026-09-18 unlocked physical follow-up (ADR053, verification/v6/physical-unlocked/): current Expo Go workspace on authorized REDMI Android16 completes actual synthetic PDF→report→page/geometry source→cold reopen→firmware correction with immutable reuse→cancelled native share preview→source/dependent-report deletion→account deletion→second-account emptyLibrary→draft/logout/cold cleanup.14fabricated confirmed calls,14syntheticmicro,paid0,unknown0; no semantic-quality claim or standalone APK update. Initial expired-session cleanup stranded readiness;5failed regressions then repair, final native expired-session direct sign-in passes. Invalidated refresh retained stale offline flag; separate reproduced regression repaired; corrected invalidated native retry unrun. Final206mobile tests/types/6focused pass. Previous pending old-account cleanup is resolved: no credentials/reports/drafts/journals remain.3testaccounts deleted,0active/0attachmentcontent/0unconfirmedintents,12redacted historical runs retained. SyntheticPDF/tempfiles removed; APIexit0/Metro/reverses stopped. No phone settings changed. Screen-reader/rotation/iOS/currentstandalone and hosted/paid semantic gates remain separate. Rollback retains fail-closed cleanup and generation/privacy/financial gates.

Physical phone fixes and evidence committed as `7fb6d387040edf57bb4694e488b62f4ff1cc0156`. User subsequently authorized pushing and merging all implementation work to GitHub main; this does not authorize deployment, paid model calls or hosted provisioning. Both userZIPs remain intact and untracked.

ADR054 terminal checkpoint: all registered13frozen documents can be loaded as exact supplied PDFs/HTML; this enables inputs, not semantic scores. Official SQLite retains75passages including network-filesystem and single-writer restrictions but fabricated transport yields no relevant assertions/no report. RFC9112/TMP117 retain the same no-assertion failure; ESP32 retains78passages and model-context-exceeds-policy. Synthetic HTML correction reuses3passages, agrees with full-rerun firmware4.2 qualification, and uses7fabricated calls in either arm (no call-saving claim). Actual paidcost0/currentallowanceunknown. No new native build/device/hosted/live-model execution. Next independent task: bounded evidence selection with explicit omission/qualification controls; live semantic evaluation needs current scoped spending authorization. Rollback denies new HTML admission/scheduling while retaining immutablev1-v4 receipts/bytes, deletion, owner/fence/publication gates and financial holds.

2026-09-18 W09 canonical-plan reconciliation: IMPLEMENTATION_PLAN.md still claimed no application existed, named the retired diagnostic controller as the live default, and labeled implemented correction/mobile/evaluation foundations unimplemented. Reconciled those statuses and the active W01–W09 execution order in the canonical plan; retained P0–P4 requirements and separated W10. No runtime or publication/budget policy changed. Both document validators exit0; evidence verification/v6/plan-reconciliation/RESULTS.json. This does not complete the milestone or resolve financial provenance. Rollback is documentation-only; do not restore diagnostic production routing.
## Apple setup mission checkpoint — 2026-09-20

The authorized Apple setup lanes completed their safe inspection. The repository remains on `main` at `8a7b1a9` with pre-existing user changes preserved; no portal, signing, credential, deployment, release, or paid-provider write occurred. The designated browser operator could not access an Apple session because the connected Firefox control environment could not start its required executable, so Apple team membership, agreements, app records, identifiers, keys, and App Store Connect state remain unobserved.

`APPLE_ACCOUNT_AND_RECORD`: blocked by unavailable signed-in portal session. `SECRET_CUSTODY`: blocked; no key was created or downloaded. `SIGN_IN_WITH_APPLE_E2E`: blocked by missing approved Supabase Apple configuration and missing native/runtime proof. Production currently verifies Supabase access tokens and maps issuer/subject identities without email merging; the mobile client exposes only the development session route. `SIGNING_AND_OWNER_TESTING`: blocked by absent Apple portal access, Mac/iOS runtime, and signing evidence. `LISTING_AND_COMPLIANCE_DRAFT`: conditional; `NORROW_APP_STORE_ASO_DRAFT.md` is a local hypothesis only and remains unapproved branding. `OPTIONAL_PUSH_AND_BILLING`: out of scope for this pass because no shipped implementation or approved catalog was found. `POST_LAUNCH_ASO`: unavailable until release. `PUBLIC_SUBMISSION_AND_RELEASE`: NOT AUTHORIZED / NOT PERFORMED.

Nonbillable checks on this worktree: `python3 scripts/validate_review.py` exit 0; review-validator unit tests exit 0 (16 passed); mobile typecheck exit 0; backend typecheck exit 0. Auth worker identity tests exit 0 (14 passed). No source files were changed by the Apple setup lanes. Rollback is documentation-only: remove this checkpoint and retain the prior canonical evidence; no runtime or portal state needs reversal.
## Apple portal readback — 2026-09-20 continuation

Owner-authorized visible browser work completed. Apple Developer team readback shows `Dalton Metzler — W6MVPS68ZU`; the exact App ID `app.deepresearch.mobile` is now registered as `Deep Research Mobile`, explicit, with Sign in with Apple enabled. Readback screenshots are retained under `verification/apple-app-id-registered.png`, `verification/apple-app-id-readback-loaded.png`, and `verification/apple-app-id-readback-siwa.png`.

App Store Connect readback shows only the removed `Jobeezy: Jobs Hiring Near Me` app. A new iOS draft form was populated with `Deep Research`, English (U.S.), `app.deepresearch.mobile`, SKU `deep-research-mobile-20260920`, and the bundle readback. The Create action remains disabled while Apple displays an updated Developer Program License Agreement requiring Account Holder review. No app record, numeric Apple app ID, or SKU has been created. No agreement was accepted on the owner's behalf.

Key inventory is read-only: existing Sign in with Apple key `23M5S4NQ8C` is configured as `W6MVPS68ZU.com.jobeezy.job` and remains unrelated; existing APNs key `LJ4JDXW49F` is named `Expo Push Notifications Key 20260709002400` with team-scoped sandbox and production configuration. No key was downloaded, revoked, edited, or reused. `APPLE_ACCOUNT_AND_RECORD`: App ID complete; App Store Connect record blocked by agreement. `SECRET_CUSTODY`: blocked for Deep Research key. `SIGN_IN_WITH_APPLE_E2E`: blocked; native/server integration and signed iOS proof remain absent.
## App Store Connect and API continuation — 2026-09-20

The owner clarified the required access choice and supplied the approved Norrow listing. The App Store Connect record was created with Full Access selected: `Norrow: AI Deep Research`, iOS, English (U.S.), bundle `app.deepresearch.mobile`, SKU `norrow-deep-research-20260920`, Apple app ID `6814282574`, version `1.0`, state `PREPARE_FOR_SUBMISSION`. The configured project API key successfully authenticated a read-only App Store Connect API request and then saved the supplied `en-US` title/subtitle, promotional text, description, and keywords. Readback returned HTTP 200, description length 1,480, promotional text length 133, keyword length 97 UTF-8 bytes, and description SHA-256 `76ed5dde74a100e3047f5460806671375f361bf179ed1abac5a567ae9ab9890e`.

The same authorized API lane set truthful categories to Productivity (primary) and Reference (secondary), and saved an age-rating declaration with all current mature-content, gambling, advertising, unrestricted-web, social, broad-UGC, and chat flags at their verified product values. A generated 1024×1024 icon was placed in `apps/mobile/assets/icon.png` and `apps/mobile/assets/adaptive-icon.png`, with both files read back as valid PNGs. Support, privacy-policy, and terms URLs remain blank because no verified public legal/support destination exists in the repository or approved records; no guessed URL was inserted into the description. Screenshots and release-build claims remain gated on a genuine signed iPhone/iPad build.

`APPLE_ACCOUNT_AND_RECORD`: complete for App ID and App Store Connect draft record. `SECRET_CUSTODY`: API consumer authentication succeeded using the existing project-designated key reference; private bytes were never printed or moved. `LISTING_AND_COMPLIANCE_DRAFT`: conditional; supplied metadata, categories, age-rating declaration, and icon assets are saved, while screenshots, support/privacy/terms URLs, content rights, and signed-build claim verification remain blocked by missing verified source facts or a release build. `PUBLIC_SUBMISSION_AND_RELEASE`: NOT AUTHORIZED / NOT PERFORMED. No API key was created, rotated, revoked, or downloaded.

## Norrow mobile AUTH-07 cold-restart repair — 2026-09-21

On isolated mobile base `d08b8bde92eeabb867bed448e5890c48a25f763c`, exact-commit review found that a process death after Clerk success but before local `authenticated` persistence stranded the `authenticating` action; a differently verified member could also see a previously bound guest reader/draft on restoration. Mounted tests were red **3/13** for successful-attempt continuation, unsigned cancellation and bound-reader non-disclosure before the repair. The app now resolves the original server auth-attempt ID at cold start, continues only that saved submission after verified identity, or confirms cancellation before opening another provider attempt. Unknown end stays held, and an unmounted late readback cannot claim. A guest journal bound to another verified account remains encrypted on device but is not mounted or read under that account.

Repaired mounted App suite **15/15**, full mobile **617/617** and `pnpm verify` EXIT 0 (core **395/395**, backend unit **255/255**, mobile **617/617**, governance **7/7**, configured types and boundaries). These are deterministic local/component controls, not native, live Clerk/provider or hosted proof; independent rereview of the repair commit remains required. No database, provider, device, Expo, paid or remote action ran. Rollback must retain encrypted pending submissions, auth-attempt and claim identities, guest proof fences, and server cancellation/unknown-outcome holds; do not retry an uncertain provider operation or expose a bound reader across accounts.
