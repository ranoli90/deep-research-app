# SESSION_HANDOFF — Session A Research Intelligence + Model Governor

- lane: Session A (intelligence/planning/model-governance)
- branch: `grok-v7/intelligence-governor`
- worktree: `/home/oranolio/Desktop/deep-v7-intelligence`
- base SHA: `66df5455de86129db0305f3c96dc3dbf1a13b7e3`
- final SHA: `e4b474f`
- not merged to `main`

## Acceptance map

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

## Files / migrations / dependencies

- Added: research-core intent compiler/clarification; contracts `research-intent.ts`; `apps/backend/src/model-governor/**`; `evaluation/portfolio-eval.ts`; `evaluation/live-semantic.ts`; `modules/model-portfolio.ts`; `migrations/043_model_portfolio.sql`; tests and `specs/features/intelligence-governor/README.md`
- Modified: `brief.ts` (compact-k budget + clarification-value), `run-admission.ts`, `model-gateway.ts`, `openrouter.ts`, `ports/model.ts`, canonical docs
- Dependencies: none
- Did not edit: `apps/mobile/**`, retrieval/extraction adapters, `structured-research.ts`

## Deterministic tests

Recorded in implementer scratch after the lane checkpoint.
- `pnpm --filter @deep/research-core test` — 18 files, 180 tests, exit 0
- `pnpm --filter @deep/backend test:unit` (maxWorkers=1) — 25 files, 185 tests, exit 0
- focused `TEST_DATABASE_URL=.../deep_research_session_a_governor pnpm --filter @deep/backend test:integration test/model-policy.integration.test.ts` — 6 tests, exit 0
- `python3 scripts/validate_review.py` — ok, exit 0
- `pnpm eval:live` without grant — fail-closed, exit 2, zero paid calls

## Live / provider / native

- Live semantic protocol: Verified live provider on bounded briefs (`verification/v7/live-semantic/RESULTS.json`). Fix run: five Azure v2 briefs succeeded (2382µ) after span/criterion repair. Prior `invalid_exact_span` / `criterion_without_question` receipts and the freshness `outcome_unknown` hold are retained without retry. Not a full source-backed report journey and not product-quality verified.
- Native: Unverified (Session C)
- Failed attempts retained: Docker daemon socket permission denied when starting compose; used already-listening Postgres with new DB `deep_research_session_a_governor`

## Interface assumptions for other lanes

- Session B: consume `compileResearchIntent` / `neededClarifications`; do not rewrite `structured-research.ts` here
- Session C: original question remains `brief.originalQuestion`; clarification prompts are the consequential list only; do not merge this branch to main from Session A

## Rollback

Disable new portfolio admissions and intent compilation at `admitRun`. Keep `modelPolicy()` readers, migration 041/043 rows, unknown holds, deletion and publication gates. Optional cache receipt fields remain readable as null on old rows.

## External to this lane

Full source-backed report journeys (Session B) and Research Beta mobile (Session C) are other worktrees. No superiority claim.
