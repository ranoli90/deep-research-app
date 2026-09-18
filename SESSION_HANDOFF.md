# Session C handoff — Product/UI + Integration

Date: 2026-09-18  
Lane: Product/UI + Integration  
Worktree: `/home/oranolio/Desktop/deep-v7-product`  
Branch: `grok-v7/product-integration`  
Base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`  
Final SHA: `b266689ac3f85c7323ca4f700a06a4cafff02534` (this pin commit follows).

## Worker SHAs

- Session A merged: `8bae4c3cbdcf49bd70237a211773df0631f1e48f` (handoff named implementation `4c10e2cecde5dd6a73e241033c57647e5e1e5061`). Merge commit `e79af35`. Conflicts: none.
- Session B merged: none. Retrieval worktree remains at `66df545` with uncommitted files and no final SHA.

## Architecture

Mobile is organized by product domain (`ResearchComposer`, `ResearchActivity`, `ResearchBriefCard`, `ReportView`, `LibraryList`, evidence/uncertainty/correction copy). Backend public run/event/report APIs are consumed; no new spend/privacy gates. Session A intent assumptions appear on the researching-this card when the persisted brief has them. Clarification is blocking only on `awaiting_input` or `materialClarification`.

## Android

- Path: EAS cloud APK (`--profile device`), Expo token, not host Gradle.
- Installed build: `4a142400-ddac-41be-a7a7-8115c448f0d6` (commit `369bc5b`).
- Device: `10.0.0.167:43417` 25098RA98G, `adb reverse tcp:8787`.
- First APK failed sign-in (cleartext). Manifest plugin sets `usesCleartextTraffic=true`. Shell curl had already succeeded.
- Two fixture journeys: laptop under $2000 with correction; close/reopen; `should I move to Texas`.
- Live OpenRouter: not run.

## Tests

- `pnpm --filter @deep/mobile test` and `typecheck` after the UX and A merge.
- Session A `test/model-governor.unit.test.ts` and `test/portfolio-eval.unit.test.ts` after merge.
- `pnpm verify` after Session B is not claimed here.

## Research Beta honesty

Fixture one-sentence UX, activity-from-events, editorial report, source sheet, correction, library, and settings are implemented and device-checked. Live semantic quality, Session B retrieval intelligence, iOS, hosted auth, purchases, and store release remain incomplete. Do not merge this branch to `main` until B hands off and the integration gate is re-run.

## Rollback

Revert `grok-v7/product-integration`. For HTTPS-only builds omit `./plugins/with-cleartext.js`. Session A rollback remains disable new portfolio/intent admission.
