# Phase A follow-up grounded explanation

Requirements: ENG-033, FP-094.
Base: 73d55263ef6006bf06c525d02e44330934dfeee7. Branch: grok-v8/phase-a-followup.

Impact review: no migration, dependency, service, prompt or model route. Additive `POST /v1/runs/:id/follow-up` explain fields (`answer`, `citationPassageIds`, `evidenceComplete`, optional `needsTargetedResearch`). Original question and brief identities are unchanged. Retrieved injection cannot grant tools, budget, consent or public-query permission. Explain does not admit a child run or issue a paid model call. Central error handler now preserves HTTP 400–599 instead of collapsing 5xx to 500.

Transport: `routeFollowUp` kind `explain` loads the latest owned report, published claims and `authorized_run_passages` exact texts, then `explainFromExistingEvidence` (`explain-from-existing-evidence.v1`). A passage is cited only when `passageSupportsClaim` or a unique owned lexical quote supports the selected report text. Missing owned support returns the honest incomplete answer and `needsTargetedResearch: true` without starting targeted verification. Steer/add_source keep Wave A revision identity; deleted accounts stay 401.

Regression ownership: research-core units cover supported Dell explanation, missing evidence, unowned citations, unsupported mention, lexical quotes, and injection text that cannot change permissions. Backend integration publishes an owned report, POSTs `Why not Dell?`, asserts a grounded answer with owned passage ids and `mutatesBrief: false`, incomplete evidence without a child run, stale steer / wrong pending input 409, and deleted-token 401.

Executed (isolated, no live spend):
- `pnpm --filter @deep/research-core exec tsc -p tsconfig.json --noEmit` exit 0
- `pnpm --filter @deep/backend exec tsc -p tsconfig.json --noEmit` exit 0
- `pnpm --filter @deep/research-core exec vitest run --config vitest.config.ts test/explain-from-evidence.test.ts test/research-beta-intelligence.test.ts` exit 0, 28/28
- `TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_phase_a_followup` `pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts test/followup-explain.integration.test.ts` exit 0, 4/4

Rollback: disable the explain answer body and return classification-only if necessary; retain publication fences, authorized passage ownership, steer/add_source revision checks, deletion rejection and unknown holds. Do not invent citations or auto-admit research from an explanation.

Parent session owns canonical STATUS, handoff, acceptance matrix and final exact-SHA verification.
