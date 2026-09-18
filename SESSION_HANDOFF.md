# Session C handoff — Product/UI + Integration

Date: 2026-09-18  
Lane: Product/UI + Integration  
Worktree: `/home/oranolio/Desktop/deep-v7-product`  
Branch: `grok-v7/product-integration`  
Base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`  
Final SHA: see `git rev-parse HEAD` on this branch after the merge commit.

## Worker SHAs

- Session A merged: `1155204` (implementation `e9af55c1738134c9965c0c366a75ab4e85fceec9`; earlier pin `8bae4c3` / `4c10e2c`). Conflicts: `SESSION_HANDOFF.md` kept as this integration document and recorded A's live-semantic receipts. Other files auto-merged.
- Session B merged: none. Retrieval worktree remains at `66df545` with uncommitted files and no final SHA.

## Architecture

Mobile is organized by product domain (`ResearchComposer`, `ResearchActivity`, `ResearchBriefCard`, `ReportView`, `LibraryList`, evidence/uncertainty/correction copy). Backend public run/event/report APIs are consumed; no new spend/privacy gates. Session A intent assumptions appear on the researching-this card when the persisted brief has them. Clarification is blocking only on `awaiting_input` or `materialClarification`.

## Android

- Path: EAS cloud APK (`--profile device`), Expo token, not host Gradle.
- Installed build: `4a142400-ddac-41be-a7a7-8115c448f0d6` (commit `369bc5b`).
- Device: `10.0.0.167:43417` 25098RA98G, `adb reverse tcp:8787`.
- First APK failed sign-in (cleartext). Manifest plugin sets `usesCleartextTraffic=true`. Shell curl had already succeeded.
- Two fixture journeys: laptop under $2000 with correction; close/reopen; `should I move to Texas`.

## Tests

- `pnpm --filter @deep/mobile test` and `typecheck` after the UX and A merge.
- Session A `test/model-governor.unit.test.ts` and `test/portfolio-eval.unit.test.ts` after merge.
- Session A live semantic: bounded Azure briefs in `verification/v7/live-semantic/RESULTS.json`. Confirmed spend recorded there. Freshness `outcome_unknown` held without retry. Not a full source-backed report+correction journey and not product-quality verified.
- `pnpm verify` after Session B is not claimed here.

## Research Beta honesty

Fixture one-sentence UX, activity-from-events, editorial report, source sheet, correction, library, and settings are implemented and device-checked. Session A bounded live briefs exist and are not relabeled as Research Beta product quality. Session B retrieval intelligence, iOS, hosted auth, purchases, and store release remain incomplete. Do not merge this branch to `main` until B hands off and the integration gate is re-run.

## Rollback

Revert `grok-v7/product-integration`. For HTTPS-only builds omit `./plugins/with-cleartext.js`. Session A rollback remains disable new portfolio/intent admission; keep unknown holds and live-semantic receipts as historical evidence.
