# Exact remaining Research Beta blockers (outside this session)

Research Beta is **not** declared. `main` stays at `8a7b1a9`. Integration branch `grok-v8/research-beta-integration` is not merged.

## 1. Live public-web journeys — RB-LIVE-01 / RB-LIVE-02 / RB-LIVE-03

**Not authorized:** leftover MC-D01 money, or inferring spend from an API key.

| Item | Value |
|---|---|
| Existing grant | $0.40 MC-D01, **frozen SQLite only** |
| Confirmed spend | $0.0005388 (539 µ) |
| Unknown hold | **21,658 µ** ($0.021658), unreleased |
| Protocol | `legacyUnknownsReleased: false`; any new unknown stops |
| Per-run budget | `DEFAULT_RUN_BUDGET_MICRO` = 100,000 µ = **$0.10** |
| Journeys | kit `38_USER_JOURNEYS.md` J1–J12 |

**Required authorization (exact scope):**

- New spend identity, **not** MC-D01.
- Live **public web**: admission → intent → public search → source read → evidence → verification → report → reopen → source inspection → correction → updated report.
- **Amount:** at least **$1.20** (12 × $0.10). **$2.00 recommended** to cover J7 correction, J9 follow-up, J10 steering, and a new unknown-hold buffer.
- **Plus** explicit release of the 21,658 µ MC-D01 unknown hold (or a written statement that new runs may proceed with that hold still on the ledger).

Record: `verification/v6/paid-readiness/AUTHORIZATION.json`.

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

## After both

Re-run live J1–J12 and hosted CI. Merge to `main` **only if** those gates PASS. This session does not merge.
