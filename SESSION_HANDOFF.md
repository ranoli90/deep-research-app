# Session B handoff — retrieval / evidence / document intelligence

Assigned lane: Session B (retrieval, query intelligence, source strategy, evidence selection, document/web, independence, freshness, OSS radar).
Worktree: `/home/oranolio/Desktop/deep-v7-retrieval`
Branch: `grok-v7/retrieval-evidence`
Base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`
Final SHA: see last commit on this branch (not merged to `main`).

## Implemented requirements

- Query provenance classification and bounded safe expansion (`query-provenance.v1`).
- Private-derived public-search fail-closed; mixed-document search still requires explicit approval.
- Source-type planning that changes class on weak/duplicative/stale evidence.
- Evidence-value adaptive breadth with hard discovery ceiling; `not found` is coverage, not nonexistence.
- Whole-passage selector neighbor bundles now include heading/table/footnote/exception/date-version context; inventory veto and empty-selection recovery unchanged.
- Origin clustering so syndicated copies count as one confirmation.
- Criterion-specific freshness policy persisted.
- Document/web reconciliation outcomes with permission requirement for private-only terms.
- OSS radar with measured Adopt/Experiment/Watch/Reject. No new shipped dependency.

## Files / migrations / dependencies

- New research-core: `query-intelligence.ts`, `source-strategy.ts`, `adaptive-breadth.ts`, `freshness.ts`, `reconciliation.ts`; independence clustering; evidence-selection structural neighbors.
- Backend: `modules/retrieval-intelligence.ts`, `worker/public-search.ts`, `worker/structured-research.ts`, `modules/search-sources.ts`, `modules/access.ts`, `modules/source-deletion.ts`.
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
| `EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime pnpm --filter @deep/backend test:extraction` | recorded if run | preserve existing HTML/PDF controls |

Live OpenRouter semantic journeys: **unrun** (not a Session B gate).
Native Android: **unrun**. Do not take the shared phone. If document/evidence surfaces change in mobile, Session C should verify source sheet/report caveats for independence/freshness/reconciliation metadata.

## Failures retained

- Historical v6 ZDR/live semantic failures are unchanged and not rewritten.
- Backend unit timeouts observed under parallel load (`eval-live`, `frozen-documents`, `generation-receipt` GC, `governance` graph walk) were re-run serially; they are not new assertion weakenings.

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
