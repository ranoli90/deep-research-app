# Closure ledger — grok-v8/research-beta-integration

## 2026-09-20 continuation (this tree, pre-full-gate)

Parent requirements from the independent review of `75dee72` are **not** closed by helper-only tests. Mapping of production repairs vs remaining gates:

| ID | Implemented now | Evidence class | Remaining |
|---|---|---|---|
| R-01 / CL-03 budget | Typed change on follow-up; original question kept | HTTP follow-up + intent/candidates unit | Full PG; native current-SHA APK; live correction usefulness |
| R-02 / CL-07 sections | `sectionWrite` in context/manifest; persist each section; restore recorded fallback policy without relabeling primary; prefix replay cannot shrink | Production `createResearchDraft` / `restoreWriterDraft` / DB 4/4 | Live J11 |
| R-03 / CL-04 journal | SHA-256 key; no overwrite; explain does not clear mutation; require runId | Mobile unit + App wiring | Component callback failure matrix; device double-tap |
| R-04 / CL-01 continue | Extra/conflict/mixed-field 400; null field reissue | HTTP continue 12/12 | Concurrent answer/cancel; declared multi-field pause |
| R-05 / CL-03 deepen | Investigation `desiredOutcome`; not command assumption | HTTP deepen + desiredOutcome | Deepen planning/evidence difference; synthetic J8/J11 production; live grant |
| R-06–07 / CL-05–06 | Claim wording on GET + picker; citation unavailable state | HTTP claims + SourceSheet unit | Device multi-claim; 100-block gfxinfo |
| Native HEAD APK | 75dee72 installed; unlocked recapture | Screenshots of that APK | New EAS/local APK of this SHA |
| Hosted GHA | OWNER_DECLINED | — | Owner reversal |
| iOS | unavailable | — | Device |
| Live J8/J11 | not rerun | — | Verified remaining grant vs MC-D01 hold |

Historical 544/544 PG is product code immediately before `75dee72`, not this tree. Log hashes are not a Git SHA.

## 75dee72 snapshot (historical)

Product SHA `75dee72a1ba77717262a0ca683a6b5a52c965d97` on `ab337c6` plus this repair. `main` stays `8a7b1a9`. Historical PG/verify at `f627b2b` / `71a14a3` are not this SHA. Native `95432e9` APK is not this SHA.

`pnpm verify` EXIT 0: research-core **314**, backend unit **246**, mobile **321**, governance **6/6**, boundaries ok. Fresh migrate **50** including `051_closure_identities`. Upgrade `001`–`050` (49 rows, no `032`) then `051` → **50**. Extraction **55/55**. Isolated PG **544/544** twice (`deep_closure_pg1` 1092s EXIT 0, `deep_closure_pg2` 935s EXIT 0). Focused brief-continue **10/10**, followup-explain **6/6**. ADB `10.0.0.167:41299` attached; current-HEAD APK not rebuilt.

| ID | Severity | Evidence class | Status | Root cause | Repair | Remaining |
|---|---|---|---|---|---|---|
| CL-01 | P0 | serializer + HTTP continue | closed for typed pending field | GET omitted `field`; fixture worker stored English prompts; mobile inferred geography from copy | Persist `runs.pending_input_field`; GET prefers column; `continueRunRequest` requires server field; wrong-field continue 400 | Native Continue |
| CL-02 | P0 | HTTP assumptions | closed for revision-bound confirm/replace | Confirm ignored `expectedBriefRevision` | Confirm/replace 409 on revision mismatch; replace still admits child | Native replace |
| CL-03 | P0 | HTTP follow-up + composer | closed explain/deepen/verify-message fallthrough | `verify_challenge` message fell into fixture diagnostic child; composer gated on paid correction | Exhaustive follow-up kinds; verify message 409; `composerContinues = finishedReport` | Device journeys |
| CL-04 | P1 | persist-before-POST unit | closed mutating follow-up journal | Key computed at POST time; draft cleared after response | `preparePendingFollowUp` + `submitPendingFollowUp`; draft cleared only if unchanged | Device double-tap |
| CL-05 | P0 | unit canaries | closed conversation + citations | Single overwrite slot | `followUpExplains[]`; citation chips; logout/switch/invalidation clear | Native conversation |
| CL-06 | P0 | unit + App wiring | closed unique-claim targeting | `claimIds[0]` on multi-claim blocks and report Verify | Unique claim only; picker for multi-claim; report Verify uses unique answer or selected citation; challenge keeps `flagClaimId` | Native multi-claim |
| CL-07 | P0 | composition parser + writer/restore | closed exact section restore | Sibling scan `ORDER BY intent_id` | `research_drafts.composition`; restore recorded intent ids; null composition stays one-shot | Live J11 |
| CL-08 | P1 | unit + HTTP | closed presence-only for these repairs | Hierarchy/follow-up tests grepped source | Continue field 400; verify-message 409; composition parse; unique-claim unit | Live J11 |
| ENG-032 | P1 | mapped CL-07 | implemented on shipped writer | | | Live J11 |
| ENG-033 | P1 | mapped CL-03 | implemented | | | |
| ENG-038 | P0 | exact-SHA PG | closed for this tree | | `deep_closure_pg1` / `pg2` 544/544 | Docs SHA if committed after |
| ENG-039 / Native HEAD APK | P0 | ADB + EAS | installed; unlocked recapture of that APK | Lockscreen cleared | EAS `16412bce` sha256 `c888095a…` on `10.0.0.167:41299` | APK is 75dee72, not later repairs |
| ENG-041 / RB-PERF-01 | P1 | helper + not device | PARTIAL | | 100-block vitest | Device gfxinfo |
| J8/J11 live | P0 | grant | blocked | remaining-cap / MC-D01 hold | Deterministic J11 pipeline not live | Explicit grant |
| Hosted GHA | — | owner-declined | blocked | | | |
| iOS | — | environment | blocked | | | |
