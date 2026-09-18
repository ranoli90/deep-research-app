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
# Session B handoff — retrieval / evidence / document intelligence

Assigned lane: Session B (retrieval, query intelligence, source strategy, evidence selection, document/web, independence, freshness, OSS radar).
Worktree: `/home/oranolio/Desktop/deep-v7-retrieval`
Branch: `grok-v7/retrieval-evidence`
Base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`
Final SHA: `bf9f95233767a95a2256c35138b7889d06461e74` (not merged to `main`).

## Implemented requirements

- Query provenance classification and bounded safe expansion (`query-provenance.v1`).
- Private-derived public-search fail-closed; mixed-document search still requires explicit approval.
- Source-type planning that changes class on weak/duplicative/stale evidence.
- Evidence-value adaptive breadth with hard discovery ceiling; `not found` is coverage, not nonexistence.
- Whole-passage selector neighbor bundles now include heading/table/footnote/exception/date-version context; inventory veto and empty-selection recovery unchanged.
- Origin clustering so syndicated copies count as one confirmation.
- Criterion-specific freshness policy persisted **and evaluated** from stored `publication_date` (`sourcesHaveUnmetFreshness`; a null date is unknown, not stale). Search adoption parses ISO dates from snippets and `insertSource` writes them.
- Opening discovery records its source class so a weak/stale follow-up does not repeat `plan.primary`; `nextSourceClass([], {weak:true})` returns the first fallback.
- Document/web reconciliation outcomes with permission requirement for private-only terms.
- OSS radar with measured Adopt/Experiment/Watch/Reject. No new shipped dependency.

## Files / migrations / dependencies

- New research-core: `query-intelligence.ts`, `source-strategy.ts`, `adaptive-breadth.ts`, `freshness.ts`, `reconciliation.ts`; independence clustering; evidence-selection structural neighbors.
- Backend: `modules/retrieval-intelligence.ts`, `worker/public-search.ts`, `worker/structured-research.ts`, `modules/search-sources.ts`, `modules/evidence.ts`, `modules/access.ts`, `modules/source-deletion.ts`.
- Migration `044_retrieval_intelligence.sql` (avoids Session C `042_model_portfolio` and Session A `043_model_portfolio`).
- Tests: research-core query/source/selection-heldout/independence/freshness/reconciliation; `apps/backend/test/retrieval-evidence.integration.test.ts`.
- Docs: ADR062, `specs/features/retrieval-evidence/README.md`, ENGINE_CONTRACTS, STATUS, HANDOFF, EXECUTION_LEDGER.
- New npm/Python dependencies: none.
- Licenses reviewed: no new packages. Existing Trafilatura Apache-2.0 / Docling Parse remain.

## OSS experiments

| Candidate | Outcome | Why |
|---|---|---|
| Criterion-aware structural overlay on whole-passage.v1 | Adopt (policy only, no new dep) | Held-out recall/qualifier retention ≥ baseline; replay identity preserved |
| In-process BM25 ranker | Reject | No neighbor/heading/footnote contract; would break inventory replay |
| Cross-encoder (ms-marco MiniLM / bge-reranker) | Experiment / not adopted | Not installed; would add model assets and non-replayable scores |
| Full Docling/ML | Watch / not adopted | `docling` missing from extraction runtime; `docling_parse` already used |
| easyocr / pytesseract | Reject until scanned corpus | Modules missing; OCR remains an explicit unavailable class |
| Playwright / Crawl4AI | Reject for now | Static-reader failures on allowed sources not quantified beyond existing partial/unavailable outcomes; would expand network authority |

## Tests (deterministic)

| Command | Exit | Notes |
|---|---|---|
| `pnpm --filter @deep/research-core test` | 0 | 200/200 twice |
| `TEST_DATABASE_URL=...deep_research_session_b_20260918 pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/retrieval-evidence.integration.test.ts` | 0 | 3/3 twice |
| `pnpm verify` | 0 | typecheck + 200 research-core + 170 backend unit + 206 mobile + boundaries=ok + 6 governance |
| `pnpm test:integration` (full matrix, pre-review-fix) | 1 | isolated `deep_research_session_b_full_v3_20260918`: 460 passed / 1 timeout (`W05 counterevidence … contradiction=false linked=true` at 30s). Timeout allowance added; not a weakened assertion. |
| focused retrieval-evidence after review wiring | 0 | 3/3 twice on `deep_research_session_b_20260918` |
| focused retrieval-evidence after date/class wiring | 0 | 4/4 twice on `deep_research_session_b_20260918` including persisted `publication_date` + `sourcesHaveUnmetFreshness` |
| `pnpm --filter @deep/research-core test` after date/class wiring | 0 | 201/201 |
| `TEST_DATABASE_URL=...deep_research_session_b_postreview_20260918 pnpm test:integration` at `caa0f40` | 1 | 460 passed / 1 failed. Heavy files green (model-gateway 136, passage-capacity 17, retrieval-evidence 3). Remaining: `W03 deletion winning the account lock prevents a waiting append from reviving the document` resolved instead of rejecting. Isolated re-run of that file: 11/11 exit 0. Treated as lock-race flake under a 26-minute suite, not a weakened assertion. |
| `TEST_DATABASE_URL=...deep_research_session_b_extraction_20260918 EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime pnpm --filter @deep/backend test:extraction` | 0 | serial after integration: 55/55. Concurrent earlier run timed out the upload PDF journey at 30s; 120s allowance added; upload case then 21434ms. |

Live OpenRouter semantic journeys: **unrun** (not a Session B gate).
Native Android: **unrun**. Do not take the shared phone. If document/evidence surfaces change in mobile, Session C should verify source sheet/report caveats for independence/freshness/reconciliation metadata.

## Failures retained

- Historical v6 ZDR/live semantic failures are unchanged and not rewritten.
- Backend unit timeouts observed under parallel load (`eval-live`, `frozen-documents`, `generation-receipt` GC, `governance` graph walk) were re-run serially; they are not new assertion weakenings.
- Concurrent extraction+integration run timed out the upload PDF journey at 30s; serial re-run after that timeout allowance was 55/55.

## Security implications

- Private canaries never authorized into search adapter input.
- Mixed-document search fail-closed without `query_authorizations.kind='approved'`.
- Retrieved text remains untrusted. SSRF, size/time, sandbox extraction, deletion fences retained.
- New tables purge on account/source deletion.

## Remaining limitations

- Expansion lexicon is bounded and English-centric; it is not open-ended LLM reformulation.
- Origin clustering uses titles/snippets/explicit clusters, not a graph database.
- Dynamic JS sites still fail as `fetch_unavailable` / `extraction_unavailable`; no browser reader.
- OCR/scanned PDFs remain explicit unavailable.
- Session C must build approval UX for private-derived terms and merge this branch.
- Session A owns model governor/policy/evaluation; this lane consumed existing contracts.

## Session C integration

1. Do not merge by rewriting this branch. Integrate onto an integration branch. Re-merge latest Session A (`043_model_portfolio.sql`) **before** this branch so you do not keep two `042_*` files. This lane uses **`044_retrieval_intelligence.sql`** and **ADR062**.
2. Union `access.ts` / `source-deletion.ts` deletes: keep B’s five retrieval tables **and** A’s `model_portfolio_resolutions`. Union `packages/research-core/src/index.ts` exports.
3. Wire mobile approval of `query_authorizations.kind='approved'` with the term list; never infer approval from source text. There is no new public HTTP route in this lane — add GET/POST for pending terms on the integration branch. Do not reuse geography `continue`.
4. Structured worker honors `kind='approved'` for mixed-document discovery; without it the run still unresolved with `document_search_requires_public_query_approval`. After attachments, `reconcileOwnedDocumentClaims` persists outcomes.
5. Surface independence caveats (syndicated copies via `origin_relation` / `source_origin_links`) and freshness/reconciliation outcomes in report/source UI if those contracts are displayed.
6. Re-run `pnpm verify`, isolated `pnpm test:integration`, extraction, then live/native gates under existing authority.
7. Do not edit this lane's retrieval files except to resolve merge conflicts conservatively.

## Rollback

Disable structured discovery / stop new admissions. Keep migration044 tables and readers, private-query blocks, selection proofs, inventory veto, empty-selection recovery, deletion and unknown holds. Do not flip admitted runs to send all evidence.
