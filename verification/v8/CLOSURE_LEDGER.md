# Closure ledger — grok-v8/research-beta-integration

Baseline independently checked: `38cf114`. `main` `8a7b1a9`. Historical PG/verify at `f627b2b` is not this product SHA.

| ID | Severity | Evidence class | Status | Root cause | Repair | Remaining |
|---|---|---|---|---|---|---|
| CL-01 | P0 | reproduced in source + serializer tests | implemented, unverified native | Mobile `/continue` sent `{answers}` without `pendingInputId`/`expectedBriefRevision` | Shared `ContinueRunRequestSchema`; GET `pendingInput.field`; `continueRunRequest()` | Native Continue against current APK |
| CL-02 | P0 | reproduced in source + serializer tests | implemented, unverified native | Replace assumptions omitted `expectedBriefRevision`; child run not adopted | `AssumptionsRequestSchema`; idempotency + child `selectRun` | Native replace/confirm |
| CL-03 | P0 | reproduced in source | implemented deepen handler | `deepen` fell into verification schema | Shared `routeFollowUp` in contracts; backend deepen child | Constraint-delta vs replace_question still uses correction for mutatesBrief |
| CL-04 | P1 | source | partial | explainFollowUp had no idempotency; child refresh without selectRun | Header + `selectRun` before refresh | Full durable admission journal for explain |
| CL-05 | P0 | source | partial | followUpExplain unbound to account/run/report | Bound render + citationPassageIds | Persisted conversation history |
| CL-06 | P0 | unit | partial | First-claim-in-block still used if block has many claims | Keep selected block claim; answer recheck uses answer block | Multi-claim choice UI |
| CL-07 | P0 | reproduced in unit | implemented canonicalize | Flattened keys duplicated shared-criteria assertions; restore used original basis | Deduped plan keys; write from original basis + section filter | Durable composition table; integration of multi-section publication |
| CL-08 | P1 | source | partial | Writer hierarchy test was string presence | Serializer tests + shared-criteria plan test remain; string test still exists as presence check | Full PG writer restore integration |
| ENG-032 | P1 | mapped | CL-07 | | | Live J11 |
| ENG-033 | P1 | mapped | CL-03 | | | |
| ENG-041 | P1 | mapped | PARTIAL | Helper test not device gfxinfo | Synthetic 100-block test | Device long-report |
| RB-PERF-01 | P1 | matrix | PARTIAL | | | Device measurement |
| Native 95432e9/38cf114 APK | P0 | launcher | blocked | Wireless ADB drop | APK `a7e10417` built for 95432e9; 38cf114 not built | Reconnect device, current APK |
| J8/J11 live | P0 | grant | blocked | Remaining-cap / MC-D01 hold | Deterministic paths only | Explicit live grant |
| Hosted GHA | — | owner-declined | blocked | | Local commands | |
| iOS | — | environment | blocked | | | |
