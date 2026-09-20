# ENG-004–009, ENG-030 provider change evidence

Base: d0ddbb264b5b93ee123ee37760beb77db926a0dc. Lane: `codex/phase-a-provider`. Local deterministic transport and isolated PostgreSQL only; not live model or release acceptance.

Implemented:

- **ENG-004** `reserveMicroForOperation` never clamps to `STRUCTURED_CALL_RESERVE_MICRO`. Reserve is UTF-8 byte-bounded input (capped at context minus operation output max) plus configured output maximum plus 25% margin.
- **ENG-005** context admission is input + max output + 1024-token overhead against the policy window. Strict-v4 uses a UTF-8 byte upper bound (no tokenizer guess).
- **ENG-006** `persistOperationRoute` writes `model_operation_routes` before `reserveLiveAttempt`. Fresh spend requires that row inside the reserve transaction.
- **ENG-007** Beta production routes are one `openai/gpt-4o-mini` family at tier 1. Distinct processor/policy ids are not quality escalation; production `escalationEligible` is false and `nextAttemptDecision` stops at `no_registered_higher_tier`.
- **ENG-008** `cacheSessionPolicy` remains `explicit_cache_not_supported` (`sessionId: null`). Production gateway does not pass `sessionId`; observed cache receipt fields stay observations.
- **ENG-009** `model_route_health` is separate from immutable request identity. Missing/retired routes fail closed. `provider_route_mismatch` retires the route. Historical results and unknown holds still restore; run `model_policy_id` is not rewritten.
- **ENG-030** strict-v4 repair prompts receive validated structural issue paths/codes only. Historical prompt bytes omit validator feedback.

New child admissions take the parent's processor under current strict-v4 identity (`inherited_parent_policy`). The parent row stays on its historical policy and remains replayable. Explicit historical pins stay pinned. Production `loadConfig` still advances configured new API admissions to same-processor strict-v4.

Impact checklist: no dependencies/services/public API added. Migration 048 is server-only route-health and operation-admission records; immutable request and policy identities unchanged. Account/source deletion removes operation rows. Health rows contain no customer content. No source text grants route authority; no new processor, paid evaluation, deployment or spend grant. Strict repair feedback is versioned by strict policy identity and bound in request digest. Success-path test loads use `runModelVersions` rather than the historical `TASK_MODEL_VERSIONS` text-v1 fixture.

Rollback: disable new admission or retire affected routes; preserve migration tables, historical policy readers, immutable receipts, exact request identities and unknown holds. Never restore the old reserve clamp or unknown-outcome failover.

## Checks

Environment: isolated `deep_phase_a_provider_waveb` on `postgres://deep:deep_local_dev_only@127.0.0.1:55432`. No live spend. No GitHub Actions. One integration process.

| command | result |
|---|---|
| `pnpm --filter @deep/backend typecheck` | EXIT 0 (`verification/v8/phase-a/provider/typecheck.log`) |
| `pnpm exec vitest run --config vitest.unit.config.ts test/token-budget.unit.test.ts test/model-governor.unit.test.ts test/model-gateway.unit.test.ts test/openrouter.unit.test.ts` | 4 files, **59/59 EXIT 0** (`unit-focused.log`) |
| `TEST_DATABASE_URL=.../deep_phase_a_provider_waveb pnpm exec vitest run --config vitest.integration.config.ts test/model-policy.integration.test.ts test/model-gateway.integration.test.ts` | 2 files, **165/165 EXIT 0** (`pg-focused.log`) |

Requirement IDs: ENG-004, ENG-005, ENG-006, ENG-007, ENG-008, ENG-009, ENG-030. Parent integrates canonical STATUS/ENGINE_CONTRACTS/SECURITY_PRIVACY_COST/ledger/handoff. These component results do not pass a Phase-A gate by themselves.
