# Execution status — application implementation
## V6 implementation checkpoint — 2026-09-17
Code checkpoint: `0e9fc9b` on `codex/v6-evidence-milestone` (not a release).
Base HEAD matches review pin `03fab6b9d6a04ce9fdaeb48636383757213f7242`. W01–W09 are **in progress, not complete**. The v6 archive is staged at `/tmp/deep-v6-staging`; it has not been installed as application code. Historical evidence below retains its original scope.

Fresh baseline: `pnpm verify` passed; real local PostgreSQL integration passed 107/107 after sandbox TCP denial was resolved through approved execution. Reproduced six supplied citation failures plus two claim-only ownership/version failures; three controls passed. The supplied standalone runner could not execute on Node 20 (requires Node 22); actual production-module Vitest regressions reproduced them instead.

Current safety checkpoint: contradiction/qualification/missing bindings propagate; publication reloads owned stored evidence; admission and dispatch are atomic; project reservations and logical provider attempts are serialized; worker leases use unique attempt owners and fenced writes; safe fetching pins the validated destination and bounds streaming/deadlines. Focused publication/execution/transport tests pass 23/23. **The latest full integration run remains failed: 62 failed / 69 passed (131 total, checkpoint tree)**. Unmapped legacy composer output and recovery semantics remain unresolved; no fixture exemption is allowed.

W04 partial implementation: Trafilatura 2.2.0 in a network-disabled offline process replaces raw HTML prefixes in controlled fetching. Original bytes, transport/extraction receipts and block/table locators persist under account ownership; HTML remains partial. Real parser tests pass 3/3 after fixing a table footnote defect; storage provenance/deletion test passes 1/1. The actual adapter preserved 11/11 selected spans on saved real documentation; one further oversized fetch failed. These are small extraction checks with agent-inspected references, not human adjudication or research superiority. Binary PDF/upload and broader quality work remain open.

`pnpm verify` passes at this checkpoint (2026-09-17 15:10 UTC). No paid provider call, native build, deployment or release occurred. Current paid allowance is not established. The W01–W09 journey, W03 identity/deletion/mobile account work and W05–W09 generic intelligence/corrections/evaluation remain incomplete. See `verification/v6/RESULTS.json`, ADR-009 and the extraction runtime README. Historical claims below describe prior builds only and do not establish current release readiness.

As of 2026-09-16. Runnable TypeScript monorepo plus Revision 3 canonical documents.

The legacy review-package validator also fails on `implemented_application_command` registry statuses (18 errors); this is recorded separately from the passing application checks. Its schema reconciliation is still open.

## P0 gates
| Gate | Status | Evidence |
|---|---|---|
| P0-D local Postgres/queue + twelve smoke + fencing | implemented and verified | `pnpm test:integration` 107/107 including live-search admission; postgres:16.10-alpine on 55432; pg-boss 10.0.4 |
| P0-L live model/retrieval | implemented and verified (bounded baseline historically; adaptive smoke 2026-09-17) | Historical bounded run `1351c267`. Adaptive live smoke `1ceed974` published report `1a5a089d` from HTTP passages with search→fetch→source_pivot→verify→challenge→cited report. A second post-fix attempt `4cb9599d` showed search→fetch→disconfirm_search→challenge then extra uncovered searches; cancelled. Controller now skips generic search after opened public pages when no blocking gap remains. Model `openai/gpt-4o-mini` + web plugin. Ledger: **$2.80 of $5 reserved**. Remaining **~$2.20**. |
| P0-N iOS | blocked by a named external dependency | Linux host, no Xcode |
| P0-N Android | implemented and verified on device | Xiaomi `25098RA98G`; recapture `verification/p0n-android-recapture.json`: persist/hydrate 120 EUR after force-stop, library open shows report, FULL-TEXT source, cancel-during-writing run `3e0f50a5` outcome=cancelled reportId=null. iOS still blocked. |

P0 is **not** fully verified.

## P1 / P2 (fixture engine, not a competitive claim)
| Item | Status |
|---|---|
| P1 decision-blocking gap + source-type switch (V2-01, V2-02, R08) | implemented and verified on the labeled fixture route |
| P1 gold-evidence diagnostic (V2-03) | implemented and verified on composeReport: summaries-only miss the limitation; injecting the vendor-matrix passage surfaces it (`bottleneck=retrieval`). Not a live A/B vs competitors. |
| P2 relaxed-constraint candidate reopen (V2-04) | implemented and verified (Vendor C appears only after budget 50→120) |
| P2 numeric unit correction (V2-05) | implemented and verified |
| P2 unknown-dependency full rerun (V2-06) | implemented and verified |
| P2 selective budget reopen vs full rerun vs unknown-dependency | implemented and verified (120 EUR selective `fullRerun=false` and scratch 120 EUR both find Vendor C; unknown-dependency `fullRerun=true`) |
| P2 non-budget correction does not reopen Vendor C | implemented and verified |
| P1/P2 vs a live same-model baseline | not run — remaining OpenRouter cap ~$4.90 reserved |

These are fixture-route behavioral tests. They are not evidence of advantage over ChatGPT/Gemini/Claude/Perplexity/Grok.

## Additional launch-scope cases now executed against Postgres/fixture
R02 (continue requires a jurisdiction; confirmed geography is used in search so France does not reuse the Germany default note), R03, R06, R07, R10, R11, R12, R14, R15, R16, R17, R18, R19, R20, R21, R22, E03, E04, E05, E06, E07, E08, E09, E10 (worker/fixture: asserted 42% withdrawn against 24% table), J02, J04, J06, J07, J08, J09, J10, J11, J12, J13, J14 (application outbox, not OS delivery), S02 (safeFetch redirect revalidation), S03, S04, S05, S06, S07, S08 (unsigned reject; sandbox still gated), S10, S11, S12 (logout cache; live push gated), JOB-1 (note-taking eligibility; adding Linux excludes NoteKeep; dropping Linux re-includes NoteKeep; EVAL-01 still draft_not_validated), JOB-2, V2-03, V2-09, V2-10, V2-11, V2-13, V2-14, V2-15, V2-16, V2-17, V2-18, V2-19, V2-20, G01 (local fixture/Postgres), G02 (local fixture/Postgres), P4 recovery drill (crash after fetch + before-publish lease failover, one settlement), G06 local fixture capability pin + measured C_run (live OpenRouter tariff probe not run), G07/M10 in-app privacy disclosure and output reporting (purchases/store review still gated). Native structural: M03, M04, M05, M06, M07, M08, M09, M10, M12, V2-12. Native device: Library, persist, attach+source, Share Markdown, 120 EUR correction (Vendor C), Flag/challenge, TalkBack M02 labels, compact keyboard Send-usable, M04 table/code nested scroll, M02 enlarged text (font_scale 1.3), M05 offline (draft+report kept, no new run), M08 follow-up change summary + previous Markdown, R02 clarification (jurisdiction → Germany, no second ask), S12 logout keeps draft and drops cached reports, M09 web deletion page opened in Chrome, V2-12 reading-anchor restore wired, scan.pdf attach + unread-pages caveat + Android Chooser share sheet on Xiaomi.

## Foundation controller (research-controller.v1)
| Item | Status |
|---|---|
| Single `admitProposedAction` gate on fixture, live, and model proposals | implemented and verified on fixture + unit |
| Typed adaptive selector `selectAdaptiveAction` is the fixture and live default | implemented; bounded `selectBaselineAction` remains the comparison arm (`LIVE_CONTROLLER_KIND=baseline`) |
| Compact `projectControllerState` projection for model proposals (not a DB dump) | implemented |
| First-class gaps, questions, contradictions, disconfirmations, calculations | implemented; persisted in gaps payload + `005_controller_intelligence.sql` |
| Source-type pivot recorded with reason | fixture + live `source_pivot` events |
| Evidence-aware stop reasons recorded | `stop_policy` events |
| Live intent issued before provider HTTP; failed/unknown keep reservation | unit + integration + live smoke |
| Fixture baseline vs adaptive comparison (12 families) | `verification/benchmark-fixture.json` — fixture only, not a competitor comparison |
| Live adaptive causal smoke | run `1ceed974` — not a 12-family live A/B |

## Still open (not claimed done)
- **P0-N iOS** blocked: no Xcode on this Linux host; TestFlight deferred.
- iOS VoiceOver blocked. M11 purchase sandbox.
- J14 live push transport; S08 signed store webhooks; hosted Supabase/Render/auth/RLS/storage/pooler.
- Seed eval validation and competitor comparison. Do not spend more OpenRouter unless remaining cap and a new live need justify it (~$4.90 of $5 left).
- Live same-model 12-family A/B vs bounded chooser is not run (spend). `openRouterProposeAction` remains optional; the application-owned adaptive selector is the live default. Android was not re-run this session (no device).

P0 is **not** fully verified while iOS is blocked.

## Next executable task
1. Phase 3 product/UX (report design, source exploration, evidence visualization, mobile polish) — engine intelligence for this phase is in place on fixture + one live smoke.
2. macOS/Xcode for iOS P0-N (deferred by user until the end). G03 both-platform remains unpassed while iOS is blocked.
3. Hosted auth/storage/pooler only when those credentials exist. Do not mark iOS or hosted auth as passed.
4. M11 purchase sandbox when a store sandbox exists.
5. Remaining blocked: iOS G03, hosted auth, M11 purchase sandbox, G04/G05 experiments, live G06 invoice probe. Do not mark those as passed.
