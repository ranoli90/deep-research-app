# Phase A Wave D retrieval (ENG-011–021)

Lane: `codex/phase-a-retrieval`. Isolated Postgres `127.0.0.1:55432` database `deep_phase_a_retrieval_waved`. No live spend. Not merged to `main`. Not pushed.

## ENG status

| ID | Status | Behavior |
|---|---|---|
| ENG-011 | applied | `research_iteration_actions` binds task/evidence/passage/discovery identity; replay keeps ordinal; fifth distinct pass fails closed. Worker admits before each pass. |
| ENG-012 | applied | `loadRunFinancialRemaining` uses confirmed `spent_micro` plus issued/outcome-unknown reserves before discovery continuation. Failed-null receipts are not holds. |
| ENG-013 | applied | Adapter source-read errors settle per source; `Promise.allSettled` rethrows lease/cancel/ownership failures. |
| ENG-014 | applied | Replacement worker marks issued reads with a mismatched/null fence `unknown` and does not resend. Same-fence concurrency stays pending. v1 identities restore first. |
| ENG-015 | applied | `canonicalSourceUrl` strips fragments, default ports, trailing slashes, and known tracking params; semantic params/order remain. Final locators and adoption aliases use that identity. |
| ENG-016 | applied | Source policy is re-checked on the requested URL, final redirect, and saved-read replay. Excluded redirect bytes are not stored. User URL exceptions are exact. |
| ENG-017 | applied | `prefer_primary` ranks primary and admits secondary. `primary_only` excludes unofficial classes/hosts. “Only use official sources” is only. |
| ENG-018 | applied | Curated vendor/standards/project host-entity bindings can be primary. Hostname suffix attacks and unrelated questions do not grant authority. |
| ENG-019 | applied | Required unknown date/version stays unmet, including empty evidence and retrieval timestamps. Compatibility with a version is not date-gated. |
| ENG-020 | applied | `source_versions.effective_date`, `applicable_version`, and `retrieved_at` persist labeled metadata and propagate through stored sources, passages, and the source API. Deletion scrubs them. |
| ENG-021 | applied | `loadRunStoredSources` restores the best authorized version’s access/coverage/metadata, including inherited evidence, instead of flattening to snippet. |

## Files

- `apps/backend/migrations/049_retrieval_recovery.sql`
- `apps/backend/src/modules/{access,billing,evidence,publication-coverage,research-controller,retrieval-intelligence,search-sources,source-deletion}.ts`
- `apps/backend/src/worker/{structured-research,source-reading,research-writer}.ts`
- `apps/backend/src/api/app.ts`
- `apps/backend/test/{direct-url,retrieval-evidence}.integration.test.ts`
- `packages/research-core/src/{source-policy,source-strategy,freshness,adaptive-breadth,types}.ts`
- `packages/research-core/test/{phase-a-retrieval,source-strategy,independence-freshness,research-beta-intelligence}.test.ts`
- `specs/ENGINE_CONTRACTS.md`, `specs/features/retrieval-evidence/README.md`, `docs/adr/DECISIONS.md` (ADR073)

Rollback: disable new source-read.v2 scheduling and iteration admission; keep historical v1/v2 readers, source versions, exclusion gates, deletion, and financial holds.

## Commands

```
pnpm --filter @deep/research-core exec vitest run --config vitest.config.ts \
  test/source-strategy.test.ts test/independence-freshness.test.ts \
  test/research-beta-intelligence.test.ts test/phase-a-retrieval.test.ts
```
exit 0, 37 passed / 37.

```
TEST_DATABASE_URL=postgres://deep:***@127.0.0.1:55432/deep_phase_a_retrieval_waved \
  pnpm --filter @deep/backend exec vitest run --config vitest.integration.config.ts \
  test/direct-url.integration.test.ts test/retrieval-evidence.integration.test.ts
```
exit 0, 18 passed / 18.
