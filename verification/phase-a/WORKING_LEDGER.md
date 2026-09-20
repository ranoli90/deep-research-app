# Phase A working ledger

Base: `d0ddbb264b5b93ee123ee37760beb77db926a0dc` on `grok-v8/research-beta-integration`.
`GROK_UNCOMMITTED.patch` **rejected** for Phase A (mobile visual kicker/fieldLabel split; Phase B).
`main` remains `8a7b1a997aefc53f8b06497346c0f915e2d455a7`.

| ID | Sev | Lane | Status | Evidence |
|---|---|---|---|---|
| ENG-001 | P0 | state `73d5526` | implemented, unmerged | `commitBriefRevision` / `insertChildBriefRevision`; steering no longer mutates issued brief |
| ENG-002 | P1 | state | implemented, unmerged | `research-task.v2` + `planning_manifest_digest` |
| ENG-003 | P1 | state | implemented, unmerged | `pending_input_id/type/revision` + 409 on mismatch |
| ENG-004 | P1 | provider `40e2fc9` | implemented, unmerged | reserve max output + 25% margin, no clamp |
| ENG-005 | P1 | provider | implemented, unmerged | input+output+1024 overhead |
| ENG-006 | P1 | provider | implemented, unmerged | `model_operation_routes` before reserve |
| ENG-007 | P1 | provider | implemented, unmerged | Beta single-model; no quality-tier claim |
| ENG-008 | P2 | provider | implemented, unmerged | `explicit_cache_not_supported` |
| ENG-009 | P2 | provider | implemented, unmerged | `model_route_health` |
| ENG-010 | P1 | integration dirty | implemented (uncommitted) | challenge/counterevidence use exact approval; pause not permanent block; privacy 3/3 on `deep_phase_a_int_ef` |
| ENG-012 | P1 | integration dirty | implemented (uncommitted) | `runRemainingBudgetMicro` uses confirmed+holds, not lagging `spent_micro` |
| ENG-022 | P2 | integration dirty | implemented (uncommitted) | `criterionSignals` value |
| ENG-023 | P1 | integration dirty | implemented (uncommitted) | `candidateClaimsBounded`; universe never complete |
| ENG-024 | P1 | integration dirty | implemented (uncommitted) | partial support in selectors |
| ENG-025/026 | P1 | integration dirty | implemented (uncommitted) | `document-web-reconciliation.v3` |
| ENG-027/028 | P1 | integration dirty | implemented (uncommitted) | repair no longer mints supported |
| ENG-029 | P1 | integration dirty | implemented (uncommitted) | no heading→Answer salvage |
| ENG-030 | P1 | provider | implemented, unmerged | strict repair codes |
| ENG-031 | P0 | integration dirty | implemented (uncommitted) | unused approved claims retained as exact paragraphs |
| ENG-032 | P1 | integration | implemented | `createResearchDraft` section-writes when `outline.complex` then `stitchSectionDrafts`; restore stitches owned section drafts |
| ENG-033 | P1 | integration | implemented | Composer `routeFollowUp` + `api.explainFollowUp`; backend explain path 4/4 |
| ENG-034–036 | P1 | state | implemented, unmerged | deleted auth, Zod bodies, required idempotency |
| ENG-037 | P2 | api lane | in progress | `grok-v8/phase-a-api` |
| ENG-038–040 | P0 | Wave I | open | exact-SHA verify/PG/docs |
| ENG-041 | P1 | later | open | long-report device benchmark |
| ENG-042 | P1 | Wave H | open | J8 synthetic fixture |
| ENG-043 | P1 | integration + api | in progress | injection patterns expanded |
| ENG-044/045 | P2 | api lane | in progress | honest label; no new model |
| ENG-046 | P1 | Phase B native | open | current APK IME |

Research-core units at this dirty tree: **299/299 EXIT 0**. Backend typecheck EXIT 0. Not a Phase-A-final SHA.
