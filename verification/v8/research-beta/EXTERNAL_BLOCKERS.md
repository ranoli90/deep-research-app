# Exact remaining Research Beta blockers (outside this session)

Research Beta is **not** declared. `main` stays at `8a7b1a9`. Integration branch `grok-v8/research-beta-integration` is not merged.

## 1. Live public-web journeys — remaining J8 attachment

The **$2.00** public-web grant (`research-beta-j12-20260919`) is in use on isolated DB `deep_v8_live_j12`. Ledger **919,563 µ** after J10-e. MC-D01 21,658 µ unknown hold was **not** released or retried.

Cited live families: J1–J7, J9, J10 (steer + US Code `$7.25`). J11 used the 32GB laptop’s distinct searches. J12 is unit + P0 S01 (no hosted poisoned URL).

**J8 private document** still needs a user-supplied attachment. This session does not invent one.

Record: `verification/v8/research-beta/live/LIVE.md`.

## 2. Hosted GitHub Actions — RB-CI-01 — owner declined

The repository owner stated hosted GitHub Actions will not be used. Do not dispatch `.github/workflows/verification.yml`. Do not wait on billing unlock. Local `pnpm verify` and the local verification.yml steps already captured under `verification/v8/research-beta/logs/` remain the CI evidence class for this session.

Historical lock (not retried):

| Run | SHA | Result |
|---|---|---|
| `35411856817` | `3db3f5e` | job not started: account locked due to a billing issue |
| `35421735059` | `9c80076` | same annotation |
| `35422066858` | `c005e8c` | same billing lock |
| `35437540425` | `6cfec73` (2026-09-19T10:29:25Z) | same annotation; job `deterministic` had 0 steps |

Annotation: *The job was not started because your account is locked due to a billing issue.* Job `deterministic` had empty steps and no runner. Local `pnpm verify` is not a substitute.

**Required:** none. Owner declined hosted Actions. Do not prompt for laptop/device passwords; use passwordless adb/local commands only.

## 3. Physical Android recapture — screen locked

`adb devices -l` shows `10.0.0.167:43417` (`kunzite_global` / 25098RA98G) connected. Passwordless `screencap` returns a black frame (`mDreamingLockscreen=true`). Recapture of empty/dark/keyboard/report shots on a post-2eb385b APK is blocked until the device is already unlocked. Do not send unlock/keyevents. Existing visual QA remains `verification/v8/research-beta/visual-qa/` on APK `2eb385b`.

## After remaining blockers

Merge to `main` **only if** required matrix rows are PASS or genuine external blockers. This session does not merge while hosted CI is owner-declined and native recapture is lockscreen-blocked.
