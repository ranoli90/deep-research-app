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

## 2. Hosted GitHub Actions — RB-CI-01

| Run | SHA | Result |
|---|---|---|
| `35411856817` | `3db3f5e` | job not started: account locked due to a billing issue |
| `35421735059` | `9c80076` | same annotation |
| `35422066858` | later integration HEAD | same billing lock |

Annotation: *The job was not started because your account is locked due to a billing issue.* Job `deterministic` had empty steps and no runner. Local `pnpm verify` is not a substitute.

**Required:** unlock GitHub Actions billing for `ranoli90/deep-research-app`, then dispatch `.github/workflows/verification.yml` on `grok-v8/research-beta-integration`. Do not dispatch while locked.

## After both

Re-run live J1–J12 and hosted CI. Merge to `main` **only if** those gates PASS. This session does not merge.
