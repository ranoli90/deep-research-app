# Closure ledger — grok-v8/research-beta-integration

Product SHA this pass: `71a14a39d0b30174835f9875a8019ee0ed234f15`. `main` `8a7b1a9`. Historical PG/verify at `f627b2b` is not this SHA. Native `95432e9` APK is not this SHA.

Gate at this SHA (porcelain 0): `pnpm verify` EXIT 0 (core 314 / backend unit 245 / mobile 316 / governance 6 / boundaries ok). Isolated PG **541/541** twice (`deep_resume_pg1` EXIT 0, `deep_resume_pg2` EXIT 0). Wave 5 file 3/3. Wireless ADB `10.0.0.167:43417` connection refused.

| ID | Severity | Evidence class | Status | Root cause | Repair | Remaining |
|---|---|---|---|---|---|---|
| CL-01 | P0 | serializer + PG 541/541 | closed for API/mobile contract | Mobile `{answers}`-only continue | `ContinueRunRequestSchema` + `continueRunRequest()` | Native Continue |
| CL-02 | P0 | serializer + PG 541/541 | closed for contract | Missing `expectedBriefRevision`; child not adopted | `AssumptionsRequestSchema` + child `selectRun` | Native replace |
| CL-03 | P0 | unit + PG 541/541 | closed deepen/explain; constraint delta keeps original question | deepen fell into verification; replace_question dropped the goal | Shared `routeFollowUp`; deepen handler; `revisedQuestionForConstraintDelta` | Device journeys |
| CL-04 | P1 | unit | partial | no idempotency; child refresh without select | `mutatingFollowUpKey` + `selectRun` before refresh | Full admission journal |
| CL-05 | P0 | unit canaries | closed for in-memory/persist | unbound React state | `followUpExplain` on UiState; `visibleFollowUpExplain`; persist parse | Conversation history UX |
| CL-06 | P0 | unit | partial | first claim in block | `claimIdForReportBlock` + sheet `onFollowUp(claimId)` | Multi-claim choice UI |
| CL-07 | P0 | executed `canonicalSectionContexts` + PG 541/541 | closed for plan/write/restore match | flattened `[a1,a1,a2]`; leftover job-level `scopeComparison` on singleton sections | Deduped keys; `sectionScopeComparison` omits/reprojects; write/restore share `canonicalSectionContexts` | Durable composition table; live J11 |
| CL-08 | P1 | unit + Wave 5 PG 3/3 inside 541/541 | closed string-presence as proof; sectioned comparison write on shipped path | hierarchy test read source strings; Zod `claimKeys` min-2 on one-claim sections | `research-writer-hierarchy.unit.test.ts` calls shipped plan/context; Wave 5 independent-challenge PASS | Live J11 |
| ENG-032 | P1 | mapped CL-07 | implemented on shipped writer | | | Live J11 |
| ENG-033 | P1 | mapped CL-03 | implemented | | | |
| ENG-041 / RB-PERF-01 | P1 | helper + not device | PARTIAL | | 100-block vitest | Device gfxinfo |
| Native HEAD APK | P0 | ADB | blocked | Wireless debugging down | `10.0.0.167:43417` connection refused (host pings) | User enables Wireless debugging |
| J8/J11 live | P0 | grant | blocked | remaining-cap / MC-D01 hold | | Explicit grant |
| Hosted GHA | — | owner-declined | blocked | | | |
| iOS | — | environment | blocked | | | |
