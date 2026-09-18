# Intelligence governor (Session A)

Goal: compile one-sentence questions into a structured research objective and route structured model operations through a versioned, cheap-first portfolio without weakening privacy, evidence, cost, or unknown-hold controls.

Non-goals: mobile UI; retrieval/extraction/`structured-research.ts` execution; 10-model fanout; claiming dynamic routing is better before live measurement.

Affected contracts: `research-intent-compiler.v1`, `research-portfolio.v1`, additive `ModelReceipt` cache token fields, migration `042_model_portfolio.sql`.

Privacy/spend: ZDR and structured-output capability are admission criteria. A cheaper incompatible route is unavailable, not a fallback. Unknown provider outcomes stay held and are not retried. Live semantic evaluation shares the existing explicit-authorization fail-closed runner.

Tests: `packages/research-core/test/intent-compiler.test.ts`, `apps/backend/test/model-governor.unit.test.ts`, `apps/backend/test/model-gateway.unit.test.ts`, `apps/backend/test/portfolio-eval.unit.test.ts`, `apps/backend/test/eval-live.unit.test.ts`, `apps/backend/test/model-policy.integration.test.ts`.

Rollback: disable new portfolio admissions; historical `model_policy_id` readers and request bytes remain. Dropping `042` is not required to fail closed. Cache receipt fields are optional so old rows still parse.

Unresolved: live semantic quality on the six task classes remains **Blocked external** until a current explicit grant, network, and budget exist. No superiority claim.
