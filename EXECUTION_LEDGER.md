# Execution ledger

## 2026-09-16 — first application implementation session

- Workspace started with kit ZIP + review copies only; no git, no app source.
- Kit extracted to `/tmp/grok-goal-b8c7f7a26b21/implementer/kit-staging` then rsync `--ignore-existing` into this tree.
- Stack: Node 20.20.2, pnpm 9.15.9, Docker Compose Postgres 16.10.10 on 55432, pg-boss 10.0.4, Fastify 5, Expo 54, TypeScript 5.8.
- `pnpm install` produced a committed-capable lockfile.
- `pnpm db:migrate` applied `apps/backend/migrations/001_init.sql` to `deep_research` and `deep_research_test`.
- `pnpm --filter @deep/research-core test`: 7 passed.
- `pnpm --filter @deep/backend test:unit`: 3 passed.
- `pnpm --filter @deep/mobile test`: 4 passed.
- `pnpm test:integration`: 15 passed, run twice, exit 0. Cases: R01 R04 R05 R09 R13 E01 E02 J01 J03 J05 S01 S09 plus cancel-during-writing, stale-lease, deletion, idempotent create, correction reopen.
- `pnpm p0:launch`: twice, exit 0; report citations resolved to stored passages.
- `pnpm verify`: exit 0; `scripts/check-boundaries.mjs` `boundaries=ok`.
- P0-L: no provider keys in environment.
- P0-N: `adb devices` empty; `emulator -list-avds` empty; no Xcode.
- Hosted Supabase/Render not provisioned; not claimed.

No live paid calls were made.

- Git: `25dad63` initial commit (160 files). `.env` and attachment blobs not committed.

## 2026-09-16 — P1/P2 + remaining launch-scope fixture tests

- Added research-core gap detection, candidate feasibility, calculations, source-type escalation, safer budget parse, markup stripping.
- Fixture catalog: Vendor C (budget-gated), NimbusDB summaries vs matrix, paywall, contradiction, hostile markup.
- `pnpm test:integration` 33/33 twice, exit 0. New IDs: R02 R03 R07 R11 R14 R22 V2-01 V2-02 V2-04 V2-05 V2-06 V2-18 E07 S04 S11 J09 plus challenge/export.
- `pnpm verify` exit 0.
- P0-L and P0-N still blocked by the same named inputs. No live paid calls. P1/P2 not claimed as a competitor win.

## 2026-09-16 — P3 native journeys + remaining fixture/Postgres IDs

- Native: attachments, clarification continue, flag, share Markdown, previous report version, Android back, persist/reopen, logout cache wipe, gated purchases/push, selectable report text.
- Engine: writing reserve includes finishing cost (J10); live lease not stolen, expired lease reclaimed (J07); freshness vs founding year (R20); German original labeled translation (R21); follow-up without reopening discovery (R19); completion outbox + fanout payload without query text (J14); unsigned purchase webhook/client payload rejected (S08); gold-evidence diagnostic (V2-03); context compaction keeps passage IDs (R18).
- Migration `002_launch_scope.sql` (provider confirmed_micro, notification_fanout, entitlements, billing_webhook_receipts).
- `pnpm test:integration` 69/69 twice, exit 0. `pnpm verify` exit 0. `pnpm --filter @deep/mobile test` 17. No live paid calls.
- P0-L and P0-N remain blocked. Purchases and live push stay gated, not simulated as successful.

## 2026-09-16 — skeptic fixes: persist/hydrate, library open, cancel-during-writing

- `persistSession` / `hydrateOnLaunch` now persist token+draft+run+report; App calls them on send/refresh/draft/auth and on launch. Tests round-trip a real store (empty store stays empty).
- Library tap uses `openLibraryItem` to switch to Research and bind the run, then refresh once and poll.
- Worker persists `writing`, yields `writingCancelWindowMs` (default 150), re-reads cancel, and `publishReport` locks the run row. `pnpm p0:launch` twice: `cancelOutcome=cancelled`, `cancelReportId=null`, `latePublicationRejected=true`.
- `pnpm test:integration` 69/69, `pnpm verify` 0, mobile 20 tests. P0-L/N still blocked.

## 2026-09-16 — attachment ingest, R07/R14/V2-19, library on device

- Worker `ingestAttachments` stores `attachment://` passages. Coverage stays investigating until a non-attachment source is inspected, so JOB-2 still searches public evidence without leaking private text.
- Fetch persists a new source version when `access_level` changes even if the snippet hash matches (R07 paywall stays `blocked`).
- `loadEvidence` returns only the latest source-version passages so reports do not answer from superseded snippets (V2-19).
- Off-coverage gossip is declined, then `selectNextAction` continues fetching (R14 budget-limited report is not marked comprehensive).
- Integration tests now delete leftover `pgboss.job` rows on shutdown so `pnpm p0:launch` is not starved by 1000+ created jobs.
- `pnpm test:integration` 73/73 twice; `pnpm verify` 0; `pnpm p0:launch` twice `cancelOutcome=cancelled` `cancelReportId=null`.
- Android `a3fa7852`: persist restored fixture report+draft; Library lists COMPLETED; opening the item shows FIXTURE REPORT.
- P0-N iOS remains blocked. `p0_fully_verified` stays false. No additional OpenRouter spend.

## 2026-09-16 — native attach + source inspection on Xiaomi

- Restarted API+worker on 8787 with current `ingestAttachments`.
- Device attach of `note.txtt` containing `INTERNAL-PROPOSAL…`; run `99391a32` stored `attachment://700ba177` as full-text plus public vendor sources.
- Native report cites the attachment; source sheet shows title `note.txtt`, `FULL-TEXT`, exact attachment text.
- Compact layout: attach fields collapse when a report is showing so citations remain tappable. `persistSession` no longer wipes a stored token when a later persist passes `token: null`.
- `pnpm --filter @deep/mobile test` 23/23. iOS still blocked. No extra OpenRouter spend.

## 2026-09-16 — native share + 120 EUR correction on Xiaomi

- Share Markdown opened the system share sheet with markdown preview `INTERNAL-PROPOSAL…` (screenshot `p0-n-android-share.png`).
- Correction `cbc04309` parent `99391a32`, brief revision 2, budget constraint 120 EUR. Worker searched then fetched including `fixture://vendor-c/pricing-de`. Report `6bb62a2f` Eligible Vendor A, Vendor C; discovery reopened. Native UI showed budget=120 EUR and Vendor C; previous version card kept.
- Concise view now includes constraints and eligibility so a correction is visible without hunting Detailed. Mobile tests 24/24.
- iOS and hosted auth remain blocked. No extra OpenRouter spend.

## 2026-09-16 — late-worker deletion fence, challenge, P2 reuse

- `publishReport` now re-reads `accounts.deleted_at`. A late worker that passes `deleted: false` after account deletion is rejected; `PRIVATE-LATE-WORKER` does not reappear in reports (V2-09).
- Challenge stores `claim_id` and note, does not mutate report blocks, and is denied to another account.
- P2: a non-budget correction on the Germany 50 EUR task does not reopen candidate discovery or add Vendor C.
- Native Flag on Xiaomi: UI "Flag submitted"; Postgres challenge `9806c317` on report `6bb62a2f`.
- `pnpm test:integration` 75/75; `pnpm verify` 0. iOS and hosted auth remain unpassed.

## 2026-09-16 — TalkBack M02 + compact keyboard on Xiaomi

- Enabled TalkBack (`TalkBackService`, `touchExplorationEnabled=true`) on `a3fa7852`. Captured content-descriptions for composer (`Research question`/`Start research`), progress (`Research progress`/`In progress`/`Cancel research` during `writing`), report, source sheet (`Source sheet`/`Close source sheet`, FULL-TEXT), library Open/Share, and settings (sign-in through Delete).
- Disabled TalkBack after capture (`accessibility_enabled=0`, bound services empty) so the phone is not left in screen-reader mode.
- Compact: composer renders only on the Research tab; attach chrome hides while the keyboard is open. Device check: Settings shows Delete on-screen; keyboard-open dump has `Start research` and no attachment fields.
- `pnpm --filter @deep/mobile test` 25/25 including an App.tsx label scan. iOS VoiceOver and enlarged text remain unpassed. `p0_fully_verified` stays false. No extra OpenRouter spend.

## 2026-09-16 — M04 long-content overflow on Xiaomi

- Fixture `composeReport` now emits `comparison-table` (kind table) and `candidate-listing` (kind code) from extracted vendors. Calculation blocks use kind `code`.
- Mobile renderer: nested `horizontal` ScrollViews for table/code; wrapping citation row; `breakLongTokens` on report/source/library text; source sheet body maxHeight 280.
- Device: table h-scroll revealed Status/Evidence without whole-screen overflow; code h-scroll revealed `fixture://gossip/swift` and `fixture://vendor-b/pricing-de`; source title wraps; library titles wrap.
- Tests: mobile 29/29, research-core 22/22, integration 76/76. iOS and hosted auth remain unpassed. No extra OpenRouter spend.

## 2026-09-16 — M02 enlarged text on Xiaomi

- `settings put system font_scale 1.30` remounts Expo Go blank until `exp://127.0.0.1:8081` is relaunched. After reload: library titles wrap; composer+Send stay on screen; source sheet Close readable; Settings Delete reachable after scroll.
- Code: `allowFontScaling` + `maxFontSizeMultiplier={2}` on inputs; composer maxHeight 180; wrapping header/tabs. Mobile tests still 29/29. Font restored to 1.0. iOS VoiceOver remains blocked.

## 2026-09-16 — M05 offline on Xiaomi

- `isOfflineError` is ApiError status 0 (timeout/fetch fail). App sets `offline`, persists the session, keeps draft+report, and `canSubmit` blocks a new send. AppState `active` pings `/health` to clear the flag.
- Device: stopped API 8787, tapped Send, waited for abort. UI: “Network request failed” + offline banner. Draft and Source `84d58a3a` report kept. API restarted. Mobile tests 30/30. iOS/hosted auth unpassed.

## 2026-09-16 — M08 versioned follow-up on Xiaomi

- Follow-up reports now persist `changeSummary.notes` when the brief contains `Follow-up: verify only`. The reader renders it and keeps Share previous Markdown.
- Device: tapped Verify this claim; UI showed the change summary and previous INTERNAL-PROPOSAL version. Mobile 31/31, research-core 23/23, integration 76/76. iOS/hosted auth unpassed.

## 2026-09-16 — R02 native clarification on Xiaomi

- Starting a new run now clears `report` and `attachments` so `awaiting_input` is not hidden under the previous answer. Clarify event summary is the question string, not `JSON.stringify(questions)`.
- Device: Need one detail / jurisdiction; Continue research; report constraints `geography=germany` with no second clarify. Mobile 31/31, integration 76/76. iOS/hosted auth unpassed.

## 2026-09-16 — S12 logout keeps draft, stops poll resurrection

- `logoutLocal` keeps `deep.draft` and drops token+snapshot. `onLogout` calls `stopPolling`; `refreshRun` no-ops when `signedIn` is false so a late GET cannot restore the previous report.
- Device: after Log out, welcome empty state + filing-deadline draft; Library “Sign in from Profile…”. Signed in and granted consent again. Mobile 32/32. iOS/hosted auth unpassed.

## 2026-09-16 — M09 web deletion path

- GET `/account/deletion` returns HTML with a token form (no secrets). POST with a session token deletes the account; empty token is 401. Settings opens the page via `Linking.openURL`.
- Device: ChromeTabbedActivity loaded `127.0.0.1:8787/account/deletion`. Form was not submitted on device. Integration 77/77. iOS/hosted auth unpassed.

## 2026-09-16 — S02 redirect SSRF + V2-14 unknown spend

- `safeFetch` does not follow 302 Location onto 169.254.169.254, 127.0.0.1, 10.x, or localhost; those URLs are never passed to fetch. `assertSafeUrl` also blocks `[::1]`.
- `liveSpendUsedMicro` counts `outcome-unknown` as `reserved_max_micro`. With 4_000_000 unknown used and a 5_000_000 cap, a 1_200_000 estimate is refused. Backend unit 14/14; integration 78/78. iOS/hosted auth unpassed.

## 2026-09-16 — P0-N Android lifecycle recapture

- Consent: Settings Signed in + Consent granted. Report: Vendor A 40 EUR. Force-stop Expo Go then `exp://127.0.0.1:8081` restored Research report, outline, table, sources, draft. Source 3fc2e7b9 FULL-TEXT.
- `restoreAfterReopen` now sets `status=completed` when a report is persisted so Correction is not hidden. Correction card/previous version shown; 120 EUR submit this capture interrupted by USB drop.
- `pnpm p0:launch` `{ ok: true, cancelRunId: 37f14e03, cancelOutcome: cancelled, cancelReportId: null, latePublicationRejected: true }`. iOS/hosted auth unpassed.

## 2026-09-16 — 120 EUR correction shows Vendor C on Xiaomi

- Clipboard paste did not update React `correction` state, so Submit no-op'd. Typed with `adb input text` so `onChangeText` fired. `onCorrect` now binds `child.runId` and polls it.
- On device: budget=120 EUR; Eligible Vendor A, Vendor C; table Vendor C germany 70 EUR; “Newly feasible: Vendor A, Vendor C.” Mobile 32/32. iOS/hosted auth unpassed.

## 2026-09-16 — E09 export citations resolve to owned passages

- `blocksToMarkdown` in research-core: tables as GitHub tables, code fenced, citations `[id.slice(0,8)]`, unsafe markup stripped. API export uses that helper and returns `format: markdown` only.
- Integration: Germany comparison export contains `| Vendor |`; every `[xxxxxxxx]` matches `passages.id` for that account/run. research-core 24/24; integration 78/78. iOS/hosted auth unpassed.

## 2026-09-16 — V2-12 reading restore + PDF attach + share sheet

- App hydrates `readingAnchor` and `scrollTo`s the laid-out block; Close source sheet restores the same offset. persistSession round-trip keeps `blockId=eligibility`.
- Device: attached `scan.pdf` extract; report showed unread-pages caveat; Share Markdown opened Android Chooser with “Vendor A managed Postgres…”. Mobile 32/32. iOS/hosted auth unpassed.

## 2026-09-16 — P2 selective vs full rerun

- `shouldFullRerun` is only true when `dependencyCompleteness === "unknown"`. Reopening candidate discovery no longer sets completeness to unknown.
- Integration: 50→120 EUR correction `fullRerun=false` and finds Vendor C; unknown-dependency correction `fullRerun=true`; scratch 120 EUR run also finds Vendor C. research-core 25/25; integration 79/79. iOS/hosted auth unpassed.

## 2026-09-16 — V2-03 gold-evidence diagnostic

- `goldEvidenceDiagnostic` composes the same compatibility question with only review summaries vs with an injected vendor-matrix passage. Without gold: blocking `vendor-matrix` gap, limitation unused. With gold: gap cleared, “not compatible” used. `bottleneck=retrieval`. research-core 26/26. Not a live competitor comparison. iOS/hosted auth unpassed.

## 2026-09-16 — G01/G02 local suite

- Dedicated `apps/backend/test/g01-g02.integration.test.ts` drives shipped API/worker/Postgres: cross-user deny, private canary, missing/declined/revoked consent, deletion resurrection, unknown citation, recoverable accepted run, single debit, stale brief/evidence/lease, cancel-during-writing.
- Revoking consent now bumps in-flight `runs.consent_epoch`; `publishReport` re-reads `currentConsent`; the worker stops on revoked consent during search and writing.
- `pnpm test:integration` 88/88; backend unit 14/14. Artifact `verification/g01-g02.json`. G03–G07, iOS, hosted auth, and purchases remain unpassed. No OpenRouter spend.

## 2026-09-16 — backend typecheck + P4 recovery drill

- Fixed `apps/backend` typecheck: clarify events use `public_summary`; M04 blocks are typed; export citation match ids are narrowed; S02 fetch mock uses `Parameters<typeof fetch>[0]`. `pnpm --filter @deep/backend typecheck` exit 0.
- P4 drill `apps/backend/test/p4-recovery.integration.test.ts`: crash after fetch keeps evidence, live lease is not stolen, expired lease recovered by another worker with one report and one settlement; crash before publish then failover also one report/one debit. Integration 90/90. Artifact `verification/p4-recovery.json`. iOS/G03–G07/hosted auth unpassed. No OpenRouter spend.

## 2026-09-16 — G06 local capability pin and measured fixture C_run

- `GET /v1/routes/capabilities` pins fixture search/fetch/synthesize tariffs (5000/3000/8000) and marks provider-internal search visibility and hosted-baseline unsupported. Live search is unsupported when the route is off. `paidProbe=false`; no OpenRouter completion.
- Fixture synthesize now records a `fixture:synthesize` intent. `GET /v1/runs/:id/cost` reconciles `spent_micro` to intents; allowance `settled_micro` matches spent. Cross-account cost is 404.
- Settings loads processor disclosures from `GET /v1/settings`. Integration 92/92; backend unit 16/16; mobile 32/32. Artifact `verification/g06-cost.json`. G03/G04/G05/G07 and live G06 remain unpassed.

## 2026-09-16 — G03 Android recapture and source-sheet layout

- Source inspection was covered by the conversation ScrollView. Conversation now renders only when `tab === "research" && !state.source`; sheet uses flex 1; conversation paddingBottom is 200 so citations clear attach/composer.
- Xiaomi 25098RA98G Expo Go: create (new source ids), FULL-TEXT source sheet, Share ChooserActivity, library open, correction budget=120 EUR Eligible Vendor A+C, force-stop reopen restored 120 EUR, Settings processors, Chrome `/account/deletion` (form not submitted). Screenshots in `verification/g03-android/`. iOS/G04/G05/G07/hosted auth unpassed. No OpenRouter spend.

## 2026-09-16 — G07/M10 in-app output reporting and privacy disclosure

- Flag form: category (harmful/inaccurate/legal/privacy/other), optional explanation, include-excerpt permission, submitted/error states. Server stores owned answer excerpt only when includeExcerpt is true; client-forged excerpt is ignored.
- Settings shows privacy data flows and deletion-vs-subscription. Restore purchases POSTs `/v1/purchases/restore` and stays 403 with zero entitlements.
- Integration 95/95; mobile 32/32. Artifact `verification/g07-output.json`. Store review, M11 sandbox, iOS, hosted auth unpassed.

## 2026-09-16 — E10 critical-claim removal on the worker path

- First test failed: `Confirm the 42% completion figure from the 2024 table` published the 24% table as the answer.
- composeReport now drafts the asserted percent, verification withdraws it when passages lack that percent, remaining-evidence still shows 24%. E04 still asks the table and never mentions 42%.
- Integration 96/96; research-core 27/27. Artifact `verification/e10-critical-claim.json`. G04/G05/iOS unpassed.

## 2026-09-16 — JOB-1 eligibility-aware comparison

- First test failed: note-taking comparison returned generic DEFAULT_SRC Option A/B.
- Fixture matrices for NoteKeep/NoteDroid/NoteAll; platform/feature constraints; NoteDroid ineligible (iPhone not supported). EVAL-01 remains draft_not_validated.
- Integration 97/97; research-core 28/28. Artifact `verification/job1-eligibility.json`. iOS/hosted auth/M11 unpassed.

## 2026-09-16 — R02 continue does not invent Germany

- First test failed: POST `/v1/runs/:id/continue` with `{}` returned 200.
- Continue now requires a jurisdiction (400 otherwise); run stays awaiting_input. France is recorded as geography=france. Mobile no longer defaults empty clarification to Germany.
- Integration 99/99; mobile 32/32. Artifact `verification/r02-continue.json`. iOS/hosted/M11/G04 unpassed.

## 2026-09-16 — R02 confirmed geography is used in discovery

- First test failed: after France continue the answer was still DEFAULT_SRC “50 EUR Germany constraint”.
- Search queries now include confirmed geography; France employment-tax fixture is used instead of the generic Germany note.
- Integration 100/100; research-core 29/29. Artifact `verification/r02-geo-search.json`. iOS/hosted/M11/G04 unpassed.

## 2026-09-16 — JOB-1 Linux correction excludes NoteKeep

- First test failed: after “Linux is also required” Eligible still included NoteKeep.
- parseCorrection/applyCorrectionToConstraints add platform=linux. Child eligibility: NoteAll eligible, NoteKeep ineligible (linux). Answer uses the eligible NoteAll passage.
- Integration 101/101; research-core 30/30. Artifact `verification/job1-linux-correction.json`. iOS/hosted/M11/G04 unpassed.

## 2026-09-16 — Android P0-N recapture of persist, library, source, cancel-during-writing

- Device a3fa7852: force-stop Expo Go then `exp://127.0.0.1:8081` restored budget=120 EUR. Library Open returned to Research with Vendor A+C. Source a77f6087 FULL-TEXT. Live API cancel at writing: run `3e0f50a5`, outcome=cancelled, reportId=null.
- Artifact `verification/p0n-android-recapture.json`. iOS still blocked.

## 2026-09-17 — JOB-1 dropping Linux re-includes NoteKeep

- First test failed: “Linux is no longer required” left NoteKeep ineligible (platform=linux).
- parseCorrection drops platform=linux and marks discovery reopened. Child Eligible includes NoteKeep.
- Integration 102/102; research-core 31/31. Artifact `verification/job1-linux-drop.json`. iOS/hosted/M11/G04 unpassed.

## 2026-09-17 — foundation audit + controller admission (V4)

- Audited V4 vs source. Confirmed live worker used `nextLiveAction()` and skipped `authorizeAction`; OpenRouter planner unused; live intent recorded after HTTP.
- Added `admitProposedAction` as the single gate; fixture, live baseline, and model proposals go through it. `extract_table`/`inspect_visual` fail closed. Hostile privileged fields rejected.
- Live spend: insert `issued` before `liveWebSearch`; `failed` and `outcome-unknown` count against the cap.
- Gaps gained dependent conclusion / resolving evidence / attempts / remaining uncertainty; `004_gap_payload.sql`. Worker emits `source_pivot` and `stop_policy`. Geography correction intent (“Actually, Germany is required”).
- Fixture baseline vs adaptive comparison recorded (`verification/benchmark-fixture.json`). Adaptive Nimbus arm pivots and fetches the vendor matrix; baseline does not. Not live quality. OpenRouter not spent.
- `pnpm test:unit` exit 0; `pnpm test:integration` 106/106; `pnpm verify` exit 0; `pnpm p0:launch` twice ok (citations 10, cancel during writing, no report). `pnpm test:e2e:ios` exit 2 (no Xcode). Android device absent; prior Android evidence not re-run. iOS/hosted/M11/G04/G05/live invoice/competitor unpassed.

## 2026-09-17 — live search must not use the fixture run-budget reserve

- Bug: `estimatedMaxCostMicro=LIVE_CALL_RESERVE_MICRO` (200_000) was admitted against `DEFAULT_RUN_BUDGET_MICRO` (100_000), so every live search became `stop/allowance_exhausted` and never called OpenRouter.
- Fix: `admitProposedAction({ liveSpend })` checks `liveSpendUsedMicro`/`LIVE_SPEND_CAP_MICRO`; run-budget still uses fixture tariffs. Worker records `issued` before `liveWebSearch`.
- Tests: research-core + backend unit drive a well-formed live search (reserve > run budget, cap remaining) to `type==='search'`. Integration `processRun` asserts a provider fetch occurs and an `issued` openrouter intent already exists at that moment.
- `pnpm test:integration` 107/107; `pnpm verify` exit 0; `pnpm p0:launch` twice ok. iOS/hosted/StoreKit/OS-push remain blocked, not passed.

## 2026-09-17 — Phase 2 research intelligence (adaptive controller)

- Typed `research-controller.v1` projection, provenance-tagged constraints, research questions, first-class gaps/contradictions/calculations/disconfirmations, evidence-adaptive `selectAdaptiveAction`, bounded `selectBaselineAction` kept as comparison arm.
- Live `controlled-research` default is adaptive (`LIVE_CONTROLLER_KIND=baseline` restores the chooser). Admission still the only gate.
- Migration `005_controller_intelligence.sql`.
- Fixture 12-family benchmark: Nimbus/primary gold matrix recalled only on adaptive; ablations show gap detection and source pivot are the retrieval cause. `verification/benchmark-fixture.json` remains `evidenceClass: fixture`.
- Adaptive closed-loop unit test: weak summaries → blocking gap → source-type pivot → contradiction → verify/challenge → evidence-aware stop.
- Live smoke `1ceed974` / report `1a5a089d`: search → fetch → source_pivot → verify → challenge → published HTTP passages.
- Post-fix live attempt `4cb9599d`: search → fetch → disconfirm_search → challenge (evaluated after ingest), then extra uncovered searches because live pages never filled `q-eligibility`. Cancelled. Selector now skips generic search after opened public pages when no blocking gap remains.
- OpenRouter ledger **$2.80 of $5 reserved**. Remaining ~$2.20.
- `pnpm test:integration` 107/107 twice; `pnpm verify` 0; `pnpm p0:launch` twice ok. iOS/Android this session not re-run (no device / no Xcode).













# V6 checkpoint — 2026-09-17, W01/W02 in progress

Base commit `03fab6b9d6a04ce9fdaeb48636383757213f7242`, Node 20.20.2, pnpm 9.15.9, Linux, local PostgreSQL test database at port 55432. Exact commands, exit codes, evidence classes and artifact hashes: `verification/v6/RESULTS.json`. Baseline verify passed; sandbox integration failed before tests (EPERM), approved local integration passed 107/107. New core regressions failed 8/11 before fixes (six supplied negative probes + two ownership/version probes); three controls passed. Intermediate core suite passed 63/63. Intermediate full integration failed 62/118 after stricter publication rejection. Focused PostgreSQL publication suite subsequently passed 11/11, including the repaired paraphrase control. The legacy composer still needs correct material bindings; broad suite is not declared passed. No paid calls or native/hosted tests executed. Standalone supplied Node-22 probe runner failed to load on Node 20; source hashes match and production modules were tested using installed Vitest instead.


## 2026-09-17 15:10 UTC — V6 safety and isolated HTML extraction checkpoint

Base remains `03fab6b9d6a04ce9fdaeb48636383757213f7242` plus recorded implementation diff. Added atomic run admission/dispatch, scoped provider attempt reservation and actual cost parsing, unique lease attempts/heartbeat/fenced writes, pinned safe HTTP transport, publication ownership/version guards and isolated Trafilatura extraction with original byte receipts. Additive migrations 006–008 were exercised only in local PostgreSQL. Exact commands/exits/log hashes/environment are in `verification/v6/RESULTS.json`.

Results: focused safety integration 23/23; ingestion storage/deletion 1/1; parser initially 1 failed/2 passed (detached table footnote), repaired and 3/3 passed; `pnpm verify` exit 0. Full integration remains failed, 62 failed/68 passed at the earlier tree. All failures remain recorded. No regression assertions were removed; no production fixture exemption was introduced.

Extraction experiment: Readability/structured DOM versus Trafilatura over identical synthetic and real bytes; selected Trafilatura after it retained a caveat omitted by Readability. Actual production adapter preserves 11/11 selected real-document spans; another download exceeded the transport bound and failed. Agent reference review only, no human adjudication. Dependency/license-file hashes and limited artifacts are committed; full third-party source pages remain temporary. No new paid provider cost, native execution or deployment. Milestone incomplete. Rollback disables issuance/reading and retains reservations, outboxes, privacy and publication gates; never restore unsafe fallback paths.

Checkpoint broad rerun at 15:14 UTC: `pnpm test:integration` exit 1, 62 failed / 69 passed / 131 total. `python3 scripts/validate_review.py` exit 1, 18 unknown application command-status errors in the legacy review schema. Both failures retained in RESULTS and raw logs.

## 2026-09-17 16:00 UTC — checked reports and arbitrary literal candidates

On code checkpoint `0e9fc9b` / evidence commit `500ce1e`, reproduced two additional mapping failures, four overlap-based false entailments and three type-label bypasses. Added literal/scope abstention (`literal-scope-v3`), atomic persisted claim revisions and support keys (migration 009), and deterministic report derivation receipts (010). Publication recomputes inputs from owned records. Unsupported draft sections become explicit localized abstentions before independent publication validation; genuine direct controls remain accepted. Removed fixture-name candidate regexes; unseen names are extracted by a bounded literal grammar, and missing platform/currency/date evidence stays unknown. This is not a general model parser/checker.

Restored report metadata, tables, calculations, language/population/date qualifications with explicit deterministic derivations. Three recovery tests now represent real attempt identity: same-name fresh processes must not steal a lease; recovery follows expiry; the active-lease case uses an injected pre-publication crash rather than a gracefully returned pause. Existing final-state/settlement assertions remain; extra denial/fence assertions were added. No assertion was deleted or broadened to accept an error.

Exact commands/log hashes in RESULTS: intermediate full integration 61 failed/78 passed, then 13 failed/126 passed; final `pnpm test:integration` exit 0, 139/139. `pnpm verify` exit 0 (core 81/backend 52/mobile 32/governance 4). Two intermediate verification failures (test type inference and conservative cost-estimate handling) were fixed; raw logs retained. Legacy review validator status reconciliation still open. W03 privacy/identity/account generations, binary uploads/PDF, W05 general gateway/criteria, typed action execution, immutable correction reuse, essential mobile changes and held-out evaluation remain. No paid live claims, native evidence or deployment.

## 2026-09-17 16:20 UTC — W03 deletion repair on 8b05f70

Reproduced 12 retained-data/raw-file assertions in the new production API regression (`deletion-before.log`, exit 1). Added migration 011, account-serialized full current-store purge, transaction-owned attachment bytes, durable restricted legacy-file cleanup outside transactions, prior-tombstone replay and late-write locks for corrections/follow-ups/clarifications/challenges. No paid calls or native/hosted changes. Full `pnpm test:integration` passed 148/148; `pnpm verify` passed. Focused race checks and final other-account/raw-byte controls are recorded in `verification/v6/RESULTS.json`. A transient test TypeScript annotation failed typecheck (Promise versus Fastify overload); corrected without weakening runtime assertions before the full verify. Rollback preserves purge/fences/outbox; disable writes rather than restore file-before-row upload. Backup expiry/restore and mobile cache deletion still require separate evidence.

## 2026-09-17 16:24 UTC — command/evidence registry reconciliation on 999533b

Review validator now checks implemented application paths, globs and package scripts without running them; unknown statuses and missing implementations still fail. Sixteen mutation tests pass. Test fixture copies exclude secrets/dependencies and arbitrary runtime logs. Builder validator initially reported five P0/native overstatement errors; P0 schema v2 now retains historical observations separately, hashes the actual current local logs, and leaves live/native gates not revalidated. Twelve builder mutation tests pass, including fake live/native pass, altered log hash, missing evidence and false overall completion. No application behavior changed and no live/native check was inferred. Registry uses the installed python3 command; historical failures remain recorded.

## 2026-09-17 16:35 UTC — W03 identity and claim ownership on fcbc163

Added configured Supabase Auth user verification, bounded no-redirect transport, zero-allowance identity bootstrap, issuer/subject digest mapping under real PostgreSQL contention, deletion denial mapping and `/v1/session`. No new dependency or hosted service. Local transport-double tests are explicitly not real Supabase cryptographic/hosted verification. Development credentials cannot authenticate production. Fourteen adapter/config cases and three PostgreSQL identity cases pass. Full integration initially 150 passed/1 failed because an old positive challenge test supplied a block alias instead of a persisted claim; its positive input and binding assertion now use the actual stored claim ID. Negative controls explicitly reject aliases/foreign/unpublished/missing IDs. Full integration then 151/151; `pnpm verify` and mobile typecheck pass. Mobile fallback no longer invents a claim ID. No device attached, no paid/native/hosted test. Production login/refresh and provider-side identity deletion still gate activation. Rollback disables production auth, never re-enables local-token fallback.
