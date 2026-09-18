# Session C handoff — Product/UI + Integration

# Integration SESSION_HANDOFF (C product + final A)

This file previously existed independently on Sessions A and C. Both records are retained below.

Date: 2026-09-18  
Lane: Product/UI + Integration  
Worktree: `/home/oranolio/Desktop/deep-v7-product`  
Branch: `grok-v7/product-integration`  
Base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`  
Final SHA: `f9a500e` (engineer review cycle; this pin follows). Craft pass `fa80a8c`.
- lane: Session A (intelligence/planning/model-governance)
- branch: `grok-v7/intelligence-governor`
- worktree: `/home/oranolio/Desktop/deep-v7-intelligence`
- base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`
- final SHA: `e4b474f`
- not merged to `main`

## Worker SHAs

- Session A merged: `1155204` (implementation `e9af55c1738134c9965c0c366a75ab4e85fceec9`; earlier pin `8bae4c3` / `4c10e2c`). Conflicts: `SESSION_HANDOFF.md` kept as this integration document and recorded A's live-semantic receipts. Other files auto-merged.
- Session B merged: none. Retrieval worktree remains at `66df545` with uncommitted files and no final SHA.
| Acceptance item | Status | Evidence |
|---|---|---|
| one-sentence intent/clarification deterministic tests | Verified deterministic | `packages/research-core/test/intent-compiler.test.ts`; consumer `packages/research-core/scripts/compile-intent-consumer.ts` |
| immutable portfolio policy and operation routing | Verified deterministic | `apps/backend/src/model-governor/`; `apps/backend/test/model-governor.unit.test.ts` |
| privacy/ZDR and structured-output are admission criteria | Verified deterministic | cheaper ZDR-incompatible route rejected; unstructured candidate rejected |
| cheap-first + bounded escalation | Verified deterministic | `chooseAdmittedRunPolicy` stamps new runs; `nextAttemptDecision` depth 2; leftover on live reserves |
| actual receipts/cost/cache fields attributed | Verified deterministic | `apps/backend/test/model-gateway.unit.test.ts` cache-read/write + missing cost stays null |
| no blind retry on unknown outcomes | Verified deterministic | governor hold + existing gateway reuse; PostgreSQL replay 1 fetch |
| candidate portfolio evaluation runner | Verified deterministic | `runPortfolioEvaluation` dated records, `superiorityClaim: false` |
| live semantic evaluation under explicit authorization | Verified live provider (bounded briefs; not product-quality) | `pnpm eval:live-semantic` Azure receipts in `verification/v7/live-semantic/`; freshness `outcome_unknown` held without retry; no superiority claim |
| no claim dynamic routing is better until measured | Implemented | eval report and docs forbid the claim |
| canonical docs and handoff | Implemented | STATUS, HANDOFF, ADR061, EVALUATION, ENGINE_CONTRACTS, AGENTS, SESSION_HANDOFF |

## Architecture

Mobile is organized by product domain (`ResearchComposer`, `ResearchActivity`, `ResearchBriefCard`, `ReportView`, `LibraryList`, evidence/uncertainty/correction copy). After a finished report the composer continues that research (`composerFollowsReport`) instead of starting a leftover new run. Citations are numbered in first-appearance order. Follow-up chips turn unresolved/caveat/limitation lines into at most three short questions above the composer (keyboard-visible; prompts ≤160). Activity stays collapsed with a truthful current line and elapsed time. Backend public run/event/report APIs are consumed; no new spend/privacy gates. Session A intent assumptions appear on the researching-this card when the persisted brief has them. Clarification is blocking only on `awaiting_input` or `materialClarification`.
- Added: research-core intent compiler/clarification; contracts `research-intent.ts`; `apps/backend/src/model-governor/**`; `evaluation/portfolio-eval.ts`; `evaluation/live-semantic.ts`; `modules/model-portfolio.ts`; `migrations/043_model_portfolio.sql`; tests and `specs/features/intelligence-governor/README.md`
- Modified: `brief.ts` (compact-k budget + clarification-value), `run-admission.ts`, `model-gateway.ts`, `openrouter.ts`, `ports/model.ts`, canonical docs
- Dependencies: none
- Did not edit: `apps/mobile/**`, retrieval/extraction adapters, `structured-research.ts`

## Android

- Path: EAS cloud APK (`--profile device`), Expo token, not host Gradle.
- Installed build: `4a142400-ddac-41be-a7a7-8115c448f0d6` (commit `369bc5b`).
- Device: `10.0.0.167:43417` 25098RA98G, `adb reverse tcp:8787`.
- First APK failed sign-in (cleartext). Manifest plugin sets `usesCleartextTraffic=true`. Shell curl had already succeeded.
- Two fixture journeys: laptop under $2000 with correction; close/reopen; `should I move to Texas`.

## Tests

- `pnpm --filter @deep/mobile test` 236 passed and `typecheck` after the design-review craft pass. The earlier EAS APK does not include this pass.
- Session A `test/model-governor.unit.test.ts` and `test/portfolio-eval.unit.test.ts` after merge.
- Session A live semantic: bounded Azure briefs in `verification/v7/live-semantic/RESULTS.json`. Confirmed spend recorded there. Freshness `outcome_unknown` held without retry. Not a full source-backed report+correction journey and not product-quality verified.
- `pnpm verify` after Session B is not claimed here.
- Live semantic protocol: Verified live provider on bounded briefs (`verification/v7/live-semantic/RESULTS.json`). Fix run: five Azure v2 briefs succeeded (2382µ) after span/criterion repair. Prior `invalid_exact_span` / `criterion_without_question` receipts and the freshness `outcome_unknown` hold are retained without retry. Not a full source-backed report journey and not product-quality verified.
- Native: Unverified (Session C)
- Failed attempts retained: Docker daemon socket permission denied when starting compose; used already-listening Postgres with new DB `deep_research_session_a_governor`

## Research Beta honesty

Fixture one-sentence UX, activity-from-events, editorial report, source sheet, correction, library, and settings are implemented and device-checked. Session A bounded live briefs exist and are not relabeled as Research Beta product quality. ADR062 Library-without-bottom-tab chrome is implemented (header Library, full-screen Library/Settings). Wide left-drawer polish remains open. Session B retrieval intelligence, iOS, hosted auth, purchases, and store release remain incomplete. Do not merge this branch to `main` until B hands off and the integration gate is re-run.

## Rollback

Revert `grok-v7/product-integration`. For HTTPS-only builds omit `./plugins/with-cleartext.js`. Session A rollback remains disable new portfolio/intent admission; keep unknown holds and live-semantic receipts as historical evidence.
Disable new portfolio admissions and intent compilation at `admitRun`. Keep `modelPolicy()` readers, migration 041/043 rows, unknown holds, deletion and publication gates. Optional cache receipt fields remain readable as null on old rows.

## External to this lane

Full source-backed report journeys (Session B) and Research Beta mobile (Session C) are other worktrees. No superiority claim.
