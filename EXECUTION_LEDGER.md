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


## 2026-09-17 — W03/F17 mobile isolation on ae2d074
SecureStore-only credentials, account/backend cache binding, serialized persistence, request generations and server identity confirmation now prevent old-account restoration and stale response updates. New deterministic controls cover ignored transport aborts, old 401s, run/source switches, delayed writes, keychain/cache failures and reinstall. `pnpm verify` exit 0 (81 core/66 backend/47 mobile/4 governance); mobile typecheck exit 0. Earlier intermediate typecheck failures retained. Android JavaScript/Hermes bundle exit 0, not a native build/device result. Native devices unavailable. Dependency audit exit 1 before and after adding exact SecureStore 15.0.8: same seven unresolved Expo-chain advisories, 3 moderate/4 high. License/integrity/runtime impact in mobile dependency-review artifact. No paid or hosted execution. Production login/refresh, both-platform keychain testing and held-out research milestone remain open. Rollback denies restoration/authenticated access rather than restoring plaintext credentials. Logout now clears private drafts, superseding historical draft-preserving behavior.


## 2026-09-17 17:30 UTC — W04 binary documents on b84fc8d
Two new API regressions failed before repair: pasted text accepted as PDF and no binary upload. Added migration 013, authenticated bounded raw upload/status, strict byte checks, isolated parsing before research, current-fence result persistence, owned page/block/geometry source inspection and complete deletion of extraction copies. Existing PDF positive test now transfers actual bytes; unread-content and negative protections remain. Intermediate flow test used wrong consent field; corrected input. Another run failed because concurrent broad tests truncated shared sessions; serial run passed. Failures retained.

Real public RFC9112 bytes exposed a material font/negation-order failure in pypdf text, PDFium text and Docling Native outputs. Selected Docling Parse 7.20.0 physical cell grouping retained the complete page18 prohibition; original mixed-font-order regression protects it. Pypdf remains metadata/encryption validation only. No OCR/layout/table models or assets, no full Docling runtime/service. Same-byte diagnostics and exact selected dependencies/licenses are recorded. 38-package Docling dependency closure (including overlap with HTML runtime) and pypdf have limited PyPI advisory lookup; zero entries reported is not an independent security audit. All PDF remains partial.

Final `pnpm verify` exit0 (81/66/47/4); full local integration153/153; separate clean-runtime actual extraction/API-worker/PostgreSQL suite10/10. Public production transport/extraction probe200,649012bytes,46pages,4714ms; decisive page18 retained. Earlier404 and startup/parser failures remain. No paid model calls, native build/device test, hosted deployment or general-quality benchmark. Native picker, broader document fidelity, general gateway/criteria/actions/correction reuse and held-out evaluation remain. Rollback disables binary processing and retains ownership, evidence digests, deletion and publication guards.

Document implementation committed as `7cabb91d1b6cdefd685336af2e34f757d6878eff`. Git whitespace checking initially treated the original PDF xref records as text and flagged their required trailing spaces. Scoped binary attributes now preserve those exact bytes and prevent newline conversion; no PDF content or test assertion was changed.


## 2026-09-17 17:41 UTC — W02/F15 strict action arguments on 8601aca
Nine negative argument cases failed before repair (81 passed); then 90/90 passed. Added a transformation regression and rechecked complete suites: `pnpm verify` exit0 (91/66/47/4), `pnpm test:integration` exit0 (153/153). Exact commands and raw log hashes in RESULTS. Strict executable schemas and challenge re-admission reject undeclared authority/code/result fields; valid actions retained. No dependencies, migrations, paid calls, native or hosted checks. Actual named-action work and scoped accounting remain open. Rollback disables actions, never bypasses argument admission.


## 2026-09-17 17:54 UTC — W02/F09 account/run accounting on 33269f9
Three new PostgreSQL regressions failed before repair (9 passed): run overcommit, missing account allowance and premature unknown-outcome settlement. Run/project/active allowance gates now serialize; controlled settlement retains unknown allowance and uses actual receipts, preserving overruns. Focused controls13/13. Initial typecheck caught three unchecked rows; explicit guards restored `pnpm verify`. Broad integration then156/157: original positive provider control had insufficient run allowance. It now has a correctly funded test-only allowance, with all positive assertions retained. A new default-denial test exposed swallowed search errors producing false searched/published events (18/19); worker now records blocked/unresolved termination, and19/19 pass. No runtime allowance increased.
Final `pnpm verify` exit0 (91/66/47/4); `pnpm test:integration` exit0,158/158. Local PostgreSQL/provider transport doubles only. Structural review/handoff pass. Exact commands, raw failures and hashes in RESULTS. Provider-key caps, automatic reconciliation, historical settlement repair and cost display still open. Default live reserve exceeds run allowance and fails closed. Rollback disables paid issuance/settlement, preserving unknown holds and strict action validation. No paid/native/hosted execution.


## 2026-09-17 18:01 UTC — W02 provider-key caps on 83ab9fe
Three PostgreSQL negatives reproduced: same-key overspend across accounts/project scopes, missing credential and zero key cap (13 passed). Migration014 stores a provider-namespaced credential digest and leaves legacy identities null; key reservations serialize before project reservations. Unattributed legacy costs count against every key. Different keys retain separate caps while sharing project limits; credential whitespace cannot change identity. Exact cap defaults zero; no real credential or runtime allowance changed.
Focused controls24/24; `pnpm verify` exit0 (91/66/47/4), then final normalized-key `pnpm test:integration` exit0,163/163. Local PostgreSQL and fabricated provider transport only; no paid/native/hosted execution. Exact failed/passing commands and log hashes in RESULTS. ADR012 and canonical security/engine/change packet synchronized. Rollback disables issuance while preserving identities/unknown holds. Automatic receipt reconciliation, historical ledger repair, cost-view separation, bounded gateway estimates and overall general-research milestone remain open.


## 2026-09-17 18:09 UTC — W02 late receipts and explicit costs on 30a98db
Two PostgreSQL regressions failed before repair (18 passed): terminal late receipts did not settle allowance and held estimates appeared as spend. Receipt application now owns an account/run-locked transaction, records immutable actual cost and settles terminal/deleted-account allowance only when all outcomes are known. Migration015 records new settlement amount/basis; historical unknown basis is preserved and not retroactively charged. Conflicting receipts reject; repeated concurrent receipts settle once; deletion stays deleted. Cost snapshots distinguish confirmed/held/simulated fields and separate ledger from allowance reconciliation. Removed fixture fetch/synthesis tariffs from controlled paths.
Focused controls28/28; final `pnpm verify` exit0 (91/66/47/4); `pnpm test:integration` exit0,167/167. Structural review/handoff pass. Actual local PostgreSQL/provider doubles only; no new paid/native/hosted execution. This reconciles supplied receipts, not automatic acquisition of missing receipts. Failed HTTP/transport receipts and existing-attempt replay still need explicit execution outcomes in the general gateway; do not enable live issuance prematurely. Overall W01-W09 incomplete. Rollback disables new issuance/receipt processing and keeps unknown holds plus settlement basis.

Final accounting implementation checkpoint: `bdc61a339f5cd123df6400ecbb85917ae8f9f975`. RESULTS records final tested code commits separately from metadata. Remaining ZIPs are preserved untracked; no deployment, push or paid test occurred.


## 2026-09-17 18:38 UTC — W05 structured gateway prerequisite on1654bbe
Replaced unused permissive model-proposal adapter with strict bounded transport; introduced six canonical output schemas, generated provider JSON Schema, pure exact-span/handle checks, backend model port, durable coordinator and migration016 result store with deletion. Logical identity includes operation/prompt/schema/policy plus brief/evidence revisions; duplicates reuse output or remain pending, never resend unknown outcomes. Current consent explicitly names downstream OpenAI. No model result grants budget or publication authority.
Initial gateway PostgreSQL9-case suite:1 failed (corrupt cached receipt)/8 passed, then9/9 after repair. Expanded11-case suite initially all failed because request schema duplicated an old consent version; replaced with canonical constant, then11/11. Transport14 controls and pure binding6 controls pass. Final `pnpm verify` exit0 (97/80/47/4); full `pnpm test:integration` exit0,178/178. Mobile typecheck/review/handoff pass. No assertions weakened.
One exact ISC dependency zod-to-json-schema3.25.1 with existing Zod peer; audit exit1 retains same seven existing Expo-chain IDs. Public unauthenticated OpenRouter endpoint metadata confirmed advertised selected capability/pricing; no paid request or semantic capability proof. Exact commands/log hashes in RESULTS and dependency/metadata details in gateway/. General workflow, support execution, synthesis/publication and correction/evaluation remain incomplete. Rollback disables structured activation while preserving privacy, reservations, immutable receipts and publication gates.

Structured gateway implementation committed as `25511fb523f1dbef5a19053e6313d27a42f46f52`. General-controller integration remains the next executable work; this checkpoint does not mark W05 or the overall goal complete.


V6 W02/W05 search outcome repair, 2026-09-17 18:49 UTC; base a454e53. Production-worker regressions reproduced HTTP503, timeout and missing-cost responses emitting searched (3 failed/28 passed). Receipt state and receipt body now persist atomically; failed/unknown receipts or prior attempts without durable output stop unresolved, with no evidence bump or search/publication event. Known costs survive replay; unknown holds persist. Positive successful-search control now supplies a genuine test receipt with cost0; previous missing-cost success expectation contradicted the required boundary. No negative assertions weakened. Initial repaired run failed only4 newly written enum expectations (active vs canonical reserved); fixed the test spelling,32/32. Extra known-cost replay case then passes33/33.
`pnpm verify` exit0:97core/80backend/47mobile/4governance. Full `pnpm test:integration` exit0:182/182 before the extra replay control; focused final33/33 includes it. Review/handoff validators exit0. Exact commands, environment, logs/hashes in RESULTS; all model transport fabricated locally, no paid/native/hosted evidence. No new dependency/schema/prompt/route. Rollback disables controlled search; preserve financial receipts/unknown holds and publication gates. Durable search-output recovery, bounded discovery, general criteria/support/writer integration, corrections/mobile/evaluation remain open. W01-W09 not complete.

Search outcome implementation/evidence committed as `5fdb122dba528a37315df50a2065d6c03b3f06aa`. Tests used that implementation; full integration preceded the extra test-only known-receipt replay case, which passed in the focused run.


V6 W05/F04 durable task identity, 2026-09-17 18:57 UTC; base2ba6b94. Added migration017, owned task domain and fenced worker preparation service. Criterion/question UUIDs are server-generated, stable across evidence arrival/restart and bound to a validated versioned gateway brief result. Concurrent adoption converges; invalid/unknown results never create a task or silently retry. Material ambiguity remains explicit. Deletion purges task content/digests. Ten new cases cover identity, crash recovery, ambiguity, failed output, revision/ownership, corruption, concurrent preparation, cross-account questions, canonical question mutation and purge.
Initial focused19/19 passed. Expanded21-case run failed one new mutation setup because it changed only the legacy question column; the canonical payload remained unchanged. Corrected setup changes both,21/21 passed. `pnpm verify` exit0 (97core/80backend/47mobile/4governance); full `pnpm test:integration` exit0,193/193. Same local Node20.20.2/pnpm9.15.9/PostgreSQL environment; provider responses fabricated in tests, no paid/native/hosted run. Exact artifacts/commands in RESULTS.
No dependency, processor, prompt, public API or spend-route change. Migration local only. Rollback disables structured preparation, retains deletion/financial/publication protections and additive table. ProcessRun integration, intent semantic evaluation, substantive support/coverage, typed corrections/mobile/evaluation remain open; W01-W09 is incomplete. Next executable work is evidence-bound arbitrary assertion extraction/support execution, followed by general loop/publication integration.

Durable task implementation/evidence committed as `5d4482757d268aff5cc2e47b2135a821f36cacd3`. General controller integration remains open;193 local integration passes are not semantic/native/live research evidence.


V6 W05/F02-F04 evidence-bound extraction, 2026-09-17 19:06 UTC; base0fae59e. New worker service builds input from the current owned task and explicit whole passages, executes extract_assertions through the durable gateway and returns unverified scoped proposals. No fixture-name routing. Migration018 persists exact selected evidence metadata beside each model result, including passages absent from output; cached reuse and brief adoption require the matching input manifest. Recompute source-text hashes before dispatch. Historical NULL manifests remain unknown; no silent backfill/resend.
Focused initial28/28 passed. Initial typecheck exit0; subsequent `pnpm verify` failed exit2 on an ambiguous optional failure reason after a typed failure-branch refinement. Added an explicit discriminant rather than weakening the type; verify then exit0 (97core/80backend/47mobile/4governance). Full integration exit0,200/200; final focused29/29 includes one additional actual foreign-passage test and the final discriminator code. Nonbillable transport controls prove selection, saved membership, replay, invalid bindings, stale output, hash mismatch and owner boundaries; they do not establish semantic model quality. Exact logs, commands/environment and failures preserved in RESULTS.
No dependency/service/processor/prompt/public API change. Selected snippets retain snippet access, whole passages do not imply full documents, and oversized inputs block without truncation. Assertions do not grant support/coverage/publication. General worker integration, substantive support and remaining W01-W09 remain open. Rollback disables structured operations, retaining manifest checks, deletion and budget holds. No paid/native/hosted evidence or deploy.

Assertion-extraction implementation/evidence committed as `ec8384859ba3c0639c19383eb4e7342c5d6919ab`. Full integration preceded the final result-discriminator refinement/extra test; focused29/29 proves the final service code. No general support or publication completion is claimed.


V6 W05/F01-F04 scoped support execution, 2026-09-17 19:19 UTC; base6473676. Added pure scoped-support.v1 guard execution and a fenced support coordinator over owned saved extraction results. Model semantic comparisons are checked against exact bindings, scope, readable access, numbers/units, qualifications and all selected in-scope passages, including uncited counterevidence. Stable server claim/revision IDs and typed support decisions/checks persist with evidence/scope digests, task/basis and linked model/checker versions. Claims remain unverified for final publication. Migration019 adds mappings/results; deletion purges both; model input receipt lookup also verifies intent run/request identity. Whole-passage context loading was factored by its evidence responsibility for extraction/support reuse.
Initial pure core104/104 and focused36/36 passed. Initial typecheck failed exit2 due an inferred empty-array union in numeric matching; explicit string[] return fixed it without weakening checks. Added wrong-entity and omitted-counterevidence controls plus a PostgreSQL changed-unit veto; focused37/37 passed. Final `pnpm verify` exit0:106core/80backend/47mobile/4governance. Full `pnpm test:integration` exit0:209/209, including previous production publication negatives/valid controls. Logs/commands/environment and failures are preserved in RESULTS. All semantic provider responses are fabricated; no paid model, native, hosted, deployment or independent human evidence.
No dependency/service/public API/model route/prompt change. The language checks remain conservative/incomplete; scope/unit aliases and semantic calibration need real held-out evidence. General processRun, criterion completion and generic writer/publication integration remain open. Rollback disables new structured support and retains privacy, unknown budget holds, canonical evidence and final publication safeguards. Next executable task: connect a generic writer and strict final report gate to these persisted assertion revisions/checks, then complete the general controller and correction/mobile/evaluation work. W01-W09 remains incomplete.

Scoped-support implementation/evidence committed as `a02515e9d30ff65b07217d69eacedf0536c163cf`; final verify and209-case integration exercised that code. General report/controller integration and W01-W09 remain incomplete.


V6 W01/W05 scoped publication integration, 2026-09-17 19:32 UTC; basedbba471. The real report gate now derives approval from persisted managed assertions, re-executes checks against current owned source manifests in read-only mode, and validates canonical text/passages/basis/policy/checker. A scoped positive can authorize a valid paraphrase; missing/partial/stale or corrupted managed checks cannot fall back to literal/derivation approval. Caller approval objects are ignored. Published claims retain canonical IDs/revisions and acquire direct-support status only after the gate; reports reopen through the existing owner-scoped API. No new assertion/check records can be minted during gate validation.
Shared unchanged route/prompt constants moved into the model-policy backend port; no dependency/service/schema/migration/processor/prompt/spend change. Initial typecheck exit0 and focused42/42 passed. Final `pnpm verify` exit0 (106core/80backend/47mobile/4governance); full PostgreSQL integration exit0,215/215. Final focused43/43 includes an extra derivation-label negative assertion after the full suite. Existing six supplied bad cases and valid controls remain. Model responses are fabricated; no real semantic, paid/native/hosted or deployment claim. Exact commands/environment/artifacts in RESULTS.
Rollback disables the structured strategy while preserving managed-claim rejection, data/deletion/financial protections and canonical report reads. Generic writer, criterion-driven completion/selection, correction-safe reuse, mobile and held-out evaluation remain unfinished; W01-W09 is not complete. Next executable work: generic writing over checked statements and support for any changed final wording, followed by general controller integration.

Scoped publication implementation/evidence committed as `09a2dae4ab6f2f81cd294d6524e5f795dcd3abe0`. Full integration215 and final focused43 preserve the negative publication controls and canonical paraphrase/reopen control. General writer/controller and W01-W09 remain unfinished.


V6 W05/F05 generic writer checkpoint; base0cee0b2. W05 generic writer: composed headings, paragraphs and limitations become distinct canonical assertions linked to checked premise revisions, then undergo exact final-wording support and publication checks. Unsupported surfaces become localized caveats; supported synthesis remains. Migration020 preserves draft lineage and checker versions; deletion purges it. Currency mismatch independently rejects. Reports conservatively remain incomplete until criterion coverage is implemented. Main processRun integration and real semantic evaluation remain open.
`pnpm verify` exit0 (107core/80backend/47mobile/4governance); full `pnpm test:integration` exit0,223/223. Initial focused50/50 preceded the final oversized-draft case, included in the full suite. Two typechecks passed. Eight new database cases cover revised prose, unsupported surfaces, replay, invented premises, excessive expansion, cyclic lineage, deletion and checker-version preservation. Provider responses are fabricated, including optimistic approvals deliberately vetoed by independent guards; this is not real-model semantic evidence. No paid/native/hosted run or deployment. Exact logs and hashes in RESULTS.
No dependency, processor, prompt, public schema or model-route change. Additive local migration020 includes support primary-key widening; hosted lock/volume rehearsal remains unexecuted. Rollback disables structured writing and retains ownership, versioned checks, unknown holds and deletion. Dependencies remain explicitly partial. Next executable work is criterion-linked coverage and main worker integration; corrections/mobile/held-out evaluation and W01-W09 remain incomplete.

Generic writer implementation/evidence committed as `fbd7fb3a15bb5280168b372c6045579e88c5806e`. Final verify and223-case local integration exercised this implementation. Main worker/criterion integration and W01-W09 remain incomplete.


V6 W05/F04 coverage execution; basea8a19ab. W05 criterion coverage: a structured review now produces persisted question outcomes tied to exact task/evidence/claim revisions and support checker versions. Deterministic guards veto unsupported assertions, missing criterion bindings, scope mismatch and model requirement waivers. Ambiguity and omitted original requirements prevent completion. Replay and deletion are covered locally; main-worker stopping and final-report coverage integration remain open. This is answer coverage, not candidate eligibility or real-model quality proof.
Initial `pnpm verify` exit0 (113core/80backend/47mobile/4governance); focused gateway integration56/56 exit0. First full integration exit1:15 suites failed setup,3 tests passed/225 skipped because migration021 lacked replay-safe table/index creation in this repository’s rerunning migration runner. Added IF NOT EXISTS; no test assertion changed or error hidden. Final full result recorded below. Local PostgreSQL, fabricated model transport only; no paid/native/hosted or deployment evidence. Additive migration021 owns resolved statuses and exact lineage, joined to account deletion. No dependency/public schema/prompt/processor/model route change. Rollback disables coverage execution while retaining private-data deletion, current support gates and unknown financial holds. Next: final-report completion and general controller integration; W01-W09 remains incomplete.

Final coverage integration rerun exit0:228/228,16 files. Review/handoff validators exit0. Migration replay failure remains preserved in RESULTS; no failed test was skipped to obtain the final pass.

Coverage implementation/evidence committed as `610bddcb30c027bcef9cb0e0a3a5353715d16369`. Final228-case integration exercised the replay repair; earlier verify/focused results preceded that SQL-only correction. Main worker/report coverage integration and W01-W09 remain incomplete.


V6 W05/F04 final-report completion; base3178a9b. W05 report completion now consumes an executed final-draft coverage review. The publication gate revalidates that review and exact compiled blocks/claim IDs; missing/corrupt coverage or omitted answer content cannot grant completion. Limited reports remain available. General worker stopping/retrieval integration and real semantic evaluation remain open.
Initial `pnpm verify` exit0 (113core/80backend/47mobile/4governance); focused58/58 exit0. Subsequent test-only extension exercises actual forged completion rejection and altered/corrupt/missing review controls; final full suite recorded below. No dependency, migration, schema, prompt or provider route change. Writer performs one extra budgeted structured review through existing gateway; invalid/unknown results cannot publish. Rollback disables structured writing while preserving the completion gate, private-data deletion and receipt holds. No paid/native/hosted run or deployment. W01-W09 remains incomplete.

Final completion integration exit0:231/231,16 files,119.68s; final typecheck and review/handoff validators exit0. All model judgments fabricated; no live semantic claim. Exact artifacts/hashes in RESULTS.

Final-report completion implementation/evidence committed as `62204b2e38828762f33ed6e83eacf72b53e73e3c`. Full231-case integration tested final code and negatives; general controller and W01-W09 remain incomplete.


V6 W05/F02-F05 worker integration; base0622101. W05 production worker integration: with structured activation enabled, processRun now prepares the versioned task, ingests owned attachments, extracts selected whole passages, executes assertion support and question coverage, and writes/rechecks/publishes a generic report. This path never invokes the fixture proposer or template composer. No readable evidence, invalid/unknown operations or no supported assertions end explicitly unresolved/failed. Discovery and larger evidence selection remain unfinished; the flag stays off by default. Existing historical routes remain separate. This is a first evidence-backed worker path, not the complete unfamiliar search/correction journey.
Initial focused62/62 and `pnpm verify` exit0 (113core/80backend/47mobile/4governance). Additional resume/cancel cases included in the final full integration below. Inputs in these worker tests are persisted source passages with random entity names; model outputs are fabricated transport responses, not real semantic quality or actual binary API extraction evidence. No paid/native/hosted/deployment execution. No schema/dependency/prompt/provider route change. Rollback disables structured activation; all safety/accounting/publication safeguards remain. Next executable task: safe bounded discovery/read/action scheduling plus full uploaded document API trace, followed by correction/mobile/evaluation; W01-W09 remains incomplete.

Final structured-worker integration exit0:236/236,16 files,124.84s; typecheck and review/handoff validators exit0. Resume reuses four saved operations; cancel before writing makes no additional model calls and produces no report. Logs/hashes in RESULTS.

Structured-worker implementation/evidence committed as `d55bab4472bba5d756fc7e3d0e5ea95f545411bf`. General discovery, complete binary API research journey, corrections/mobile/evaluation and W01-W09 remain open.


V6 W04/W05 document journey; basee77172b. Initial real extraction suite exit1:10 passed/1 failed, no report because coverage had no approved assertion. Stored checks showed qualification_preserved=false on an exact underwater prohibition due to another offline-only sentence in the page. Pure regression exit1:114 passed/1 failed reproduced it. Added sentence-relevant qualification filtering with retained anaphoric/direct negative controls; bumped scoped-support.v3/literal-scope-v4. No assertion deleted or acceptance expectation weakened. Initial document typecheck exit0; final checks recorded below. The new journey uses a renamed real PDF through API, isolated parser, production worker and report/source inspection/deletion, with fabricated model responses. No paid/native/hosted run. Rollback disables structured mode while preserving exact evidence, checker versioning, ownership, deletion and unknown holds. General discovery/correction/mobile/evaluation and W01-W09 remain incomplete.

Final checks: `pnpm verify` exit0 (115/80/47/4); actual extraction suite11/11 exit0; full PostgreSQL integration236/236 exit0; document validators exit0. Test PDF SHA2562e013c307af0568112e393c8c291aa86406f4bab2d8a4aaf786c0f9703a2b3a4, report38647d45-720d-41a0-bd67-625a9d31efcf: AKSURL does not support underwater recording, cited page1/block0, partial access with layout/OCR warning. Exact bytes and checks in verification/v6/document-journey. No paid semantic evidence; both failed reproductions retained.

Document journey and qualification implementation/evidence committed as `7a4e93a733ce065b1dcfeaf9d6d62fe4142b8061`. Final extraction/verify/integration exercised the versioned repair. General discovery, corrections/mobile/real evaluation and W01-W09 remain incomplete.


V6 W02/W05 search transport; basec1af7ab. Source inspection rechecked unbounded res.json(), redirect following and unchecked annotation assumptions. W02/W05 search transport now rejects redirects, enforces a 45-second total fetch/body deadline and 1MB strict-UTF8 response limit, validates bounded citation envelopes, rejects malformed/truncated output, and preserves parsed actual cost on invalid results. Titles no longer become invented snippets; citations deduplicate by URL and share an origin cluster. No engine/model/prompt/allowance change or paid call. Durable discovery output, explicit processor/policy selection and structured-worker discovery remain open.
Existing request payload/route stays unchanged. Public official OpenRouter plugin docs were read, not a paid probe: unspecified engine can select native or Exa; explicit processor/price policy still must be adopted before general discovery activation. No current monetary balance was inferred. Unit/regression and full database outcomes recorded below. Rollback disables live discovery and preserves receipts/unknown holds and final publication protections. W01-W09 remains incomplete.

Final search transport checks: `pnpm verify` exit0 (115core/88backend/47mobile/4governance); `pnpm test:integration` exit0,236/236; review/handoff validators exit0. Exact logs/hashes in RESULTS. Public documentation observation is in search-policy-observation.md; no paid call or current balance claim.

Search transport implementation/evidence committed as `04fa478800bc40e8b4cee3d02cbd1c95e3493271`. Final verify/integration exercised this code. Durable discovery/processor policy and W01-W09 remain incomplete.


V6 W02/W03/W05 durable public discovery; base5eccc91. W02/W03/W05 durable public discovery: default-off policy pins Exa auto plus the existing OpenAI model provider, requires consent2026-09-17.1 and stores immutable owned results with exact receipts. Concurrent/replayed queries issue once; unrelated evidence changes do not resend unknown outcomes. Known costs survive deletion while content is discarded. Mixed document searches require a future explicit public-query approval flow. Worker discovery/read scheduling and real paid quality evidence remain open.
Migration022 joins deletion; query body/policy/brief identity excludes unrelated evidence revision. Initial typecheck exit0; focused70/70 exit0; `pnpm verify` exit0 (115core/88backend/47mobile/4governance). Final added old-consent and mixed-document controls are included in full integration below. No dependency or hosted service added; public consent policy changes to disclose Exa, but no public mutation endpoint, activation or monetary allowance. Reservation28658 derives from full model ceiling21658 plus documented single Exa auto fee7000; external tariff enforcement/invoices are not proven. Local tests use fabricated receipts only. Rollback disables discovery while preserving consent, budget holds, actual receipt accounting and deletion. W01-W09 incomplete.

First full integration exit1:243 passed/1 failed because the new mixed-document setup referenced nonexistent briefs instead of research_briefs. Corrected only the setup table name; focused final72/72 exit0, including old consent and mixed-document denial. No assertions weakened. Full rerun recorded below.

Final durable discovery full integration exit0:244/244,16 files,103.98s. Focused72/72, verify115/88/47/4, final typecheck and document validators pass. Earlier243-pass/1-setup-failure run remains preserved. No paid/native/hosted evidence or deployment. Next: wire criterion-linked public search/read scheduling into structured processRun, retaining explicit limits and public-query privacy gates.

Durable discovery implementation/evidence committed as `3b808523e78e99cd17be749f5a75403dc74cde55`. Final244-case integration exercised the final source and test setup. Worker integration, public-query approval for document tasks and overall W01-W09 remain incomplete.


## W04/W05 durable reading and worker discovery — 2026-09-17
Base b890469; implementation revision recorded after commit. W04/W05 discovery-to-reading checkpoint: the structured worker now performs one bounded public discovery pass when readable evidence is absent, adopts only owned durable search results, and reads the returned sources through the existing safe fetch and isolated extractor. Migration023 stores read identity and exact version; replay does not repeat finished or unknown reads. Resume completes the prior discovery pass before synthesis. Snippets remain search-snippet evidence and never satisfy full reading. Criterion/support gates still decide publication. Adaptive further discovery, correction reuse and W01–W09 remain unfinished.
Initial focused integration:76 passed/3 failed due new read receipts outliving the test helper cleanup; fixed cleanup ordering without weakening assertions. Final focused79/79 exit0. An intermediate verify failed typecheck because the safe-fetch test double lacked its required body field; corrected the test double. Raw failures retained. Actual extraction and full-suite outcomes recorded below. Migration023 and deletion path included; no paid/provider/native/hosted execution. Rollback disables STRUCTURED_DISCOVERY_ENABLED and retains financial holds, privacy and publication guards.

Final durable-read checks: `pnpm verify` exit0 (115core/88backend/47mobile/4governance); focused79/79 exit0; `pnpm test:integration` exit0,251/251 across16files,151.08s; actual extraction12/12 exit0. Both document validators exit0. Exact saved-byte PDF trace under verification/v6/discovery-journey/ distinguishes actual parsing/API/worker/database from fabricated search/model/network responses. No corrected follow-up, live semantic benchmark, paid/native/hosted execution or release claim.

Durable-read implementation/evidence committed as `0b8e27e8e3aee7f50920416ca5172fb3e61be39a`. Full251-case integration and final verify exercised final code. Earlier extraction execution preceded the type-only completion of the saved-bytes test response body field; actual parser/source behavior is unchanged. Overall W01-W09 remains incomplete.


## W05 criterion-driven discovery loop — 2026-09-17
Base ccba73c; implementation revision recorded after commit. W05 criterion-driven discovery: unresolved executed coverage can now select a distinct query from the relevant criterion’s exact original-question span. New results are read and all selected evidence is extracted/supported/reviewed again before writing. criterion-discovery.v1 stops explicitly at three distinct queries or no available distinct public criterion wording. The query ceiling is checked atomically during provider admission and includes unknown attempts; replay remains allowed. This is a bounded refinement policy, not proof of general discovery or semantic quality.
Focused PostgreSQL81/81 exit0; new controls prove a second query/read changes executed coverage and survives writing-pause replay, and four concurrent distinct searches issue only3 requests. Initial verify exit2 caught unknown-typed response JSON in the new test helper; replaced it with a typed response constructor without weakening assertions. Final verify/full-suite outcomes follow. No paid/native/hosted execution. W01-W09 remains incomplete.

Final verify exit0 (117core/88backend/47mobile/4governance); full PostgreSQL253/253 exit0 across16files in147.39s. Both document validators exit0. Final focused run adds replay-at-ceiling assertion after the full suite; no production behavior changed. Rollback disables structured discovery; retain atomic caps, financial holds, privacy and support gates.

Final focused81/81 exit0,20.31s, including replay at the durable query ceiling. No hidden live calls or skipped assertions.

Criterion-loop implementation/evidence committed as `2ad2a905351e3b8f459861b0f653ff564734601c`. W01-W09 incomplete; next work is typed corrections and authorized immutable evidence reuse, with broader discovery/semantic evaluation still open.


## W06 typed replacement and immutable evidence membership — 2026-09-17
Base84491d4; implementation revision follows after commit. W06 typed replacement and evidence reuse: structured corrections accept an explicit replacement question plus reuse_snapshot or refresh policy. Admission atomically validates owner/consent/revision, creates the child/allowance/outbox, and snapshots exact authorized passage/version digests. All child claims and support are recomputed; dependency completeness is unknown, never inferred from user wording. Public discovery reopens conservatively. The real API/PDF/worker control changes the answer, preserves citation identity and matches a full-rerun control with fabricated model responses. Granular criterion patches, selective dependency traversal, source-level deletion, result-derived change summaries and native correction input remain open.
Initial verify exit2: TypeScript could not narrow nullable parent/consent through a const rejection arrow; changed to a declared never-returning function, without assertions/casts. Focused85/85 exit0; subsequent verify117/88/47/4 exit0. Added a corrupt cross-owner membership control for final integration. First actual extraction12/12 exit0 includes API corrected report and full-rerun comparison; a read-hook timing shift was identified in cancellation tests, so those tests now cancel after the actual extractor returns and explicitly assert parsed blocks. Final extraction rerun is required before claiming that cancellation scope. No paid/native/hosted execution or independent semantic adjudication.

Full PostgreSQL integration exit0:258/258 across16files,189.96s. Final source verify exit0:117core/88backend/47mobile/4governance. Account/source membership controls include a deliberately corrupt cross-account row that grants no passage visibility. Final attachment digest and parser-hook checks are exercised in the separate extraction suite.

Final actual extraction exit0:12/12,47.91s, including explicitly observed parsing before cancellation/deletion and corrected API/PDF report compared with a full-rerun control. Exact PDF/hash/source/support/correction trace is in verification/v6/correction-journey/. Search/model responses remain fabricated; no independent semantic benchmark, paid/native/hosted claim. A final focused migration/reuse run checks the view’s explicit column projection rather than SELECT-star before commit.

Final focused86/86 exit0,38.87s, reapplying migration024 with explicit view columns. All listed final checks passed; initial typecheck failure and intermediate extraction scope remain preserved. No paid/native/hosted execution.

Typed correction/membership implementation and evidence committed as `088b59942babc0c42d121f4fa9bf7186c128ec63`. Final document validators pass. Next: result-derived correction changes, granular patch/freshness handling and mobile adoption; W01-W09 remains incomplete.


## W06 result-derived report changes — 2026-09-17
Base262bb2e; implementation revision follows after commit. W06 result-derived comparisons: structured publication now computes change summaries from owned parent/child claim revisions, criterion definitions and cited source-version identities inside the publication transaction. Exact text/scope comparison distinguishes changed assertions from new citations and records actual snapshot reuse. Missing or ambiguous parent history yields no comparison; caller flags cannot manufacture one. This is an exact inventory comparison, not semantic equivalence or candidate-eligibility adjudication.
Initial verify passed; focused86/86 passed in38.72s with unchanged wording and exact snapshot reuse controls. Added production controls for forged root summaries, fresh versions with unchanged assertions and missing parent publication; final full verification follows. Mobile change-note control ensures recomputation is not described as carrying old conclusions forward. No provider calls, dependencies or migrations added. Rollback disables new comparison display/derivation while retaining privacy and publication gates.

Final verify exit0:117core/88backend/48mobile/4governance. Full PostgreSQL integration exit0:260/260 across16files,146.02s. Production gate ignores forged structured summary flags; a fresh cited version can change evidence without changing assertion wording; missing parent publication yields no comparison. Both document validators passed. Actual PDF comparison check follows separately.

Actual extraction exit0:12/12,36.56s. Corrected PDF API response records1 added/1 removed assertion revision with unchanged cited source version, agrees with the full-rerun fabricated-model control, and is deleted afterward. Exact new trace/bytes under verification/v6/report-change-journey/ preserve prior correction evidence separately. No paid/native/hosted or semantic superiority claim.

Result-derived comparison implementation/evidence committed as `6e0cce011f73cbf899930e0d765e4a363e741e85`. No comparison provider calls. Overall W01-W09 remains incomplete; next is mobile typed correction adoption, granular patch/freshness behavior and held-out evaluation.


## W06/W07 mobile typed corrections — 2026-09-17
Base88db719; implementation revision follows after commit. W06/W07 mobile correction adoption: controlled runs now expose server-gated replacement-question mode and the run allowance reservation. Mobile sends the strict typed patch with explicit snapshot/refresh policy, preserves the earlier report, rejects stale responses and guards duplicate submission. Unknown/disabled capability remains unavailable. Demo corrections now respect the disabled fixture-route gate. Metro’s shared-contract TS resolution was repaired after an actual Android JS bundle failure. No online Android device was found; native interaction remains unverified.
Mobile baseline and updated typechecks exit0. Android device launcher probe exit2: no online device detected; it is a presence probe, not an app test. Initial verify117/88/52/4 exit0. Initial Android export exit1 on unresolved shared-contract ./action-arguments.js; scoped Metro extension resolution fixed it and final export exit0 (2.04MB Hermes bundle). Full PostgreSQL260/260 exit0,149.78s; final added disabled-route/capability controls run in extraction/API suite. No paid/native/hosted execution.

Mobile correction final verification:117 core/88 backend/52 mobile/4 governance and mobile typecheck exit0;260 PostgreSQL tests exit0. Actual extraction log reports13/13, including server correction capability and disabled-route controls. Final Android Hermes export reports success; final asset hashes are recorded. Exit receipts for these last two processes were unavailable after context handoff and are recorded as null, not invented. Prior Android export exit0 is retained. No online device/native app execution, paid calls or hosted changes. Rollback disables typed correction UI/admission while retaining owner, privacy, allowance and publication gates. W01-W09 remains incomplete.

Mobile typed correction implementation/evidence committed as `0ac295d401efa187fe45195289c42ab802b89d69`. Next: isolate production worker from historical fixture/controller imports; native input, granular corrections and held-out evaluation remain open.

## W05 production fixture isolation — 2026-09-17
Basec00afe3. Rechecked source: executor statically imported fixture adapters and used the historical loop whenever structured processing was disabled. Separated diagnostic entrypoint while preserving historical tests and shared safety preflight. New import-graph and PostgreSQL failure controls pending. First post-move verify exit0 (117/88/52/4), before new graph/gating controls; later results will record final scope. No paid/native/hosted work.

Production isolation final verify exit0:117 core/92 backend/52 mobile/6 governance. Full PostgreSQL integration exit0:262/262. Initial focused run had89 passes/1 failure: queued-fixture control used a helper that had already acquired a lease and changed lifecycle to running. Setup now explicitly restores queued state; assertion unchanged, corrected control passes in the full suite. Added non-production diagnostic entrypoint tests reject both production environment and production identity before database access. Review/handoff validators pass. Real extraction/API admission suite pending.

Initial extraction exit1:13 passed/1 failed. The earlier fixture-route PDF test still called the newly restricted production executor, which correctly did no fixture work. Its import/call now explicitly targets the diagnostic worker, with all PDF/source/deletion assertions unchanged. Both structured upload/search/corrected PDF production journeys and new production admission rejection passed in the initial run. Final extraction rerun pending; this is test-runtime reclassification, not replacement of real extraction with a fixture parser.

Final production isolation extraction exit0:14/14,52.52s. Final typecheck exit0. Actual PDF source inspection, changed constraint and corrected publication remain exercised through production for structured cases; the older fixture-route PDF case is explicitly historical diagnostic. No paid/provider/native/hosted calls; model/search transport responses remain fabricated. W01-W09 incomplete. Next concrete task: remaining substantive typed action execution and same-pipeline held-out baseline/adaptive evaluation; mobile binary selection/persistence, granular correction/freshness and native identity remain open. Rollback disables structured admission/processing, never reconnects the historical fallback.

Production runtime isolation implementation/evidence committed as `4a84a95fa2bf3e1d54262c1c662f5d604e2013f2`. Final document validators passed. Mobile correction checkpoint is `0ac295d`. Full milestone remains active and incomplete; no paid/native/hosted evidence or release approval added.

## W05 substantive scope comparison — 2026-09-17
Base65f23ec. Added strict compare_scopes action/result, pure six-field comparison, migration025 bound to claim revisions/evidence/support versions, fenced persistence/replay/deletion and production-loop execution. Writer receives recomputed typed result; model-input.v2 carries its digest, while comparison-free contexts retain v1. No provider/prompt/allowance/dependency addition. Initial verify exit0; focused94/94 exit0,51.05s. Final concurrency, writer-manifest and quantity-unknown declarations are in full verification now. Matching scopes do not grant entailment/eligibility. No paid/native/hosted or semantic-quality claim.

Scope comparison intermediate full PostgreSQL267/267 exit0,137.50s; verify127 core/92 backend/52 mobile/6 governance exit0. New unknown-writer upgrade guard initially failed6 focused cases because it referenced nonexistent actual_micro instead of canonical confirmed_micro; failed artifact preserved. Corrected focused96/96 exit0,50.01s. Added explicit pre-admission capacity outcome for expanded comparison context; final full suite and verify running. No assertions weakened.

Final scope comparison full PostgreSQL exit0:269/269,16files,172.39s;97 structured-service cases include scope replay, real multi-connection duplicate execution, writer input digest, unknown writer hold and oversized context block. Final verify exit0:127 core/92 backend/52 mobile/6 governance. Android JS/Hermes export exit0 (2.04MB; hashes recorded), no native execution. Actual extraction rerun is pending. No paid calls or independent semantic benchmark.

Final real extraction/API exit0:14/14,56.71s; source inspection and changed-question PDF follow-up remain intact through the production worker. Both document validators passed. No paid/native/hosted work. Current source/support/corrected PDF trace remains in verification/v6/report-change-journey; this new action adds deterministic scope results, not independent semantic or benchmark proof. Next: compact comparison projection to avoid quadratic writer-context growth, then evidence-bound calculation and counterevidence actions. W01-W09 incomplete; W10 release gates remain separate.

Scope comparison implementation/evidence committed as `8d99098eafd3cb2ab30d488e61d93ea9924b68c1`. Checks:269 full PostgreSQL,14 actual extraction/API,127/92/52/6 verify and Android JS export. Initial SQL failure retained. Large comparison projection and remaining calculation/counterevidence/evaluation/mobile work remain open; no paid/native/hosted claim.

## W05 compact scope comparison projection — 2026-09-17
Basee2726b2. Previous turn was progress. Inspected current full-pair projection and reproduced its size failure in the real request builder:60 assertions/1770 pairs, comparison JSON1,042,010 bytes; full request rejected before any provider call. Initial compact representation14,528 bytes/request42,979 bytes retains every pair and scope relation. Added explicit pair/criterion encoding labels afterward; final measured values follow. Initial verify128core/93backend/52mobile/6governance exit0. Migration026 pins representation and legacy digest; no migration rewrites or new provider call. Focused compatibility/tamper checks and final verification pending.

Final projection size control: full1,042,010 bytes, compact14,626 bytes, entire request43,085 bytes,1770 pairs retained. Final verify exit0:128core/93backend/52mobile/6governance. Focused99/99 exit0,47.38s; after that pass, the legacy compatibility control was strengthened from a manually reserved unknown intent to the actual gateway unknown-outcome/replay path. Full regression underway; strengthened control will run afterward. No paid/provider/native evidence.

Projection full PostgreSQL exit0:271/271,122.74s. Strengthened final focused exit0:99/99,67.57s; old full context plus actual gateway unknown outcome is restored without a second provider request. Final typecheck and document validators passed. Actual extraction/API rerun pending. Serialization metrics are saved separately from research-quality evaluation in verification/v6/scope-projection-metrics.json. No new paid/native/hosted execution.

Final projection extraction/API exit0:14/14,32.10s. Source reopening and actual PDF correction stay intact. No paid/native/hosted checks. Next concrete task: implement evidence-bound calculation results and their publication-safe derivations, then counterevidence actions and matched held-out evaluation. W01-W09 remains incomplete; W10 remains a separate release gate. Rollback disables new processing while retaining both context readers, pins, deletion and accounting.

Compact projection implementation/evidence committed as `009fd62bff0cc5665d104a9ecb231f70acf012d8`. Full271 PostgreSQL, final focused99, actual extraction14 and128/93/52/6 verify passed. The60-assertion serialization control retains1770 pairs at14,626 comparison bytes; no semantic/model-quality or paid-cost claim. Calculation/counterevidence, evaluation and remaining mobile/privacy work remain open.


## W05 evidence-bound calculation handler
Base946e3ff40d079a5d16a563841939beeccc96e6de; implementation revision follows after commit. W05 calculation handler checkpoint: exact arithmetic now binds supported claim revisions to numeric source spans and persists typed computed/unknown outcomes under the worker fence. Real PostgreSQL controls cover replay, tampering, ownership, revision invalidation, deletion and concurrent execution. Calculation selection, writer integration and proof-aware publication remain unimplemented; no end-to-end calculated-report claim. W01-W09 remains incomplete.
Initial verify exit0:128/93/52/6; intermediate verify exit0:141/93/52/6. Final verify log reports142/93/52/6 and focused PostgreSQL log reports104/104, but their terminal exit receipts were lost across context handoff and are recorded as null. Full PostgreSQL and Android JS export are now running. No paid/provider/native/hosted execution. Existing publication and criterion gates are unchanged.

Full PostgreSQL exit0:276/276 across16 files,135.29s. Android JS/Hermes export exit0 (2.04MB), not native execution; both document validators exit0. During final review the new calculation test setup was corrected to leave the second independent entity unassociated with the first candidate; production code and every assertion stay unchanged. Final focused rerun will cover this valid-control adjustment after the extraction suite.

Actual extraction/API exit0:14/14,31.39s; source inspection and corrected PDF publication remain intact. Same production parser/worker/API, fabricated model/search transport; no paid/native/hosted evidence. Final focused valid-control rerun pending.

Final focused exit0:104/104,44.39s, including the corrected independent-entity control. Document validators passed after synchronization. Rollback retains migration027 and deletion/read validation while disabling invocation; no publication bypass was added. Next concrete task: production calculation selection plus exact proof-aware report derivation/revalidation and correction recomputation. Counterevidence, matched held-out evaluation and remaining mobile/privacy work follow. W01-W09 incomplete; W10 remains separate.

Calculation handler implementation/evidence committed as `5db808b9923606d38128c040fdb1015fb45e2cc1`. Full276 PostgreSQL, final104 focused,14 actual extraction and Android JS export passed. Final verify log reports142/93/52/6 with unavailable terminal receipt; earlier verify exits0 are separately scoped. Raw-log trailing blank lines are preserved; source/document whitespace check passed. No paid/native/hosted execution. Production calculation selection and proof-aware publication remain the next concrete task; overall W01-W09 remains active and incomplete.


## W05 proof-aware calculation publication
Basee2d1298; previous turn was concrete progress. W05 calculation publication checkpoint: report claims now bind to exact durable calculation proofs and input revisions. The publication transaction independently restores support/evidence, recomputes arithmetic and requires exact rendered wording, assumptions and operand citations. Computed prose is marked inference, never direct source wording; arithmetic alone cannot satisfy question coverage. Production action selection and writer adoption remain open; W01-W09 is incomplete.
Initial verify exit2 caught a test-only inferred candidateKey:string type after the previous checkpoint changed a control to null. Annotated the extraction output with its shared ResearchModelOutput type; no assertion weakened. Corrected verify exit0:142/93/52/6; initial focused PostgreSQL108/108 exit0,81.42s. Then added an explicit missing visible citation control, exact-fraction rendering regression and operand semantic scope for result-derived comparisons. Final verify/full PostgreSQL are pending. No paid/native/hosted calls.

Full PostgreSQL exit0:280/280 across16files,149.37s. Final verify exit0:143 core/93 backend/52 mobile/6 governance. Formula display labels subsequently became readable names (Annual cost, Difference, etc.); final focused/type checks cover that display-only change. No native export repeated because this change does not touch mobile/shared-contract runtime; native execution remains unverified. Actual extraction/API regression will run after focused tests.

Final focused PostgreSQL exit0:108/108,74.35s; final typecheck exit0. Visible operand citations, exact fraction/input/assumption rendering and proof-owned scope are covered. Actual extraction/API is running serially; no paid/native/hosted work. Production planning/writer adoption remains unimplemented.

Final actual extraction/API exit0:14/14,48.92s. Existing PDF source inspection and corrected report remain intact; this does not yet exercise automatic calculation selection. Both document validators passed. Rollback disables calculation preparation/publication while retaining proofs, deletion, consent, accounting and existing publication/coverage gates. Next: strict production calculation proposals and writer/final-coverage adoption with unknown-attempt identity preserved, then corrected arithmetic and matched held-out evaluation. W01-W09 remains incomplete; no paid/native/hosted execution.

Calculation publication implementation/evidence committed as `7ea64d995a26230739813681ac79e5d49f3abfb2`. Final280 full PostgreSQL,108 focused,14 actual extraction,143/93/52/6 verify and typecheck passed; initial test-annotation type failure retained. No paid/native/hosted checks. Strict production selection, writer adoption and final criterion review of derived answers are next; W01-W09 remains incomplete.


## W05 production calculation planning
Basedf4a3c3; previous turn made concrete progress. W05 production calculation selection checkpoint: supported source quantities now trigger one versioned plan_calculations operation per exact evidence context through the existing gateway. Strict reference-only plans are revalidated and executed by the arithmetic handler; results persist, replay and distinguish computed from unknown. Writer adoption and final derived-answer coverage remain open, so this is not yet a calculated-report journey. W01-W09 remains incomplete.
Initial verify exit0:143/93/52/6. First focused run exit1:113 passed/1 failed because the new test queried reserved_micro instead of provider_intents.reserved_max_micro. Verify after new tests exit2 due to a RequestInfo type unavailable in backend; changed to Parameters<typeof fetch>[0]. Neither fix weakens assertions. Final full PostgreSQL/verify and Android JS export are running. No paid/native/hosted execution; new planning responses in tests are fabricated.

Full PostgreSQL exit0:286/286 across16files,191.71s; final verify exit0:144 core/93 backend/52 mobile/6 governance. Android JS export exit0:2.05MB, no native execution. Subsequent code inspection identified missing explicit operation/schema/prompt/policy comparison on generic cached results; added fail-closed metadata comparison and a prompt-tamper control. Final focused/type checks now cover that change before extraction/API regression.

Final focused exit0:115/115,69.56s; final typecheck exit0. Cached prompt tampering blocks without a provider retry; all structured regressions pass. Actual extraction/API check is running serially. No new paid/native/hosted evidence or calculated-report completion claim.

Final actual extraction/API exit0:14/14,37.72s; existing source inspection and corrected PDF publication remain intact. Document validators passed. Rollback sets STRUCTURED_MODEL_ENABLED=false, retaining stored plan/proof readers, unknown financial holds, ownership, deletion and publication safeguards. Next: adopt selected calculations in the generic writer and final criterion review, prove a corrected arithmetic report, then complete counterevidence/evaluation/mobile work. No paid/native/hosted execution. W01-W09 remains incomplete.

Production calculation planning implementation/evidence committed as `b89df8424e18e5a69d81faf03198175ccfdb0a31`. Full286 PostgreSQL precedes the final cached-metadata guard, which passes final115 focused, typecheck and14 actual extraction; verify144/93/52/6 and Android JS export passed. Initial SQL/type test failures are retained. No paid/native/hosted execution. Writer/final-coverage adoption and corrected arithmetic are next; W01-W09 remains active and incomplete.


## W05/W06 calculated report integration — active verification
Base b0c80ac. New calculated writer/final review contracts, migration029 lineage and server-rendered arithmetic now connect production planning to published reports and typed corrections. Initial focused119:112 passed/7 failed (six missing cascade cleanup dependencies, one30s timeout). Added derived-provenance cascades in the uncommitted migration and removed a redundant publication validation pass. A targeted timing run with a120s diagnostic ceiling passed in28.223s; the normal30s rerun timed out. The two-run/reopen/correction test now has60s scheduling headroom, with every assertion retained. Final focused119/119 passed in170.05s, journey33.425s. Added a pure referential control afterward and retained missing-criterion coverage reporting. Full PostgreSQL and final verify are running.
Existing verify144/93/52/6 and typecheck passed; Android JS export passed (2.05MB). User authorized wireless Android debugging; ADB connected to their device (Android16). Expo Go development-bundle download failed; no native UI pass claimed. No paid provider calls, hosted migration, deployment or push. Real live balance remains unknown; local fabricated receipts are not spend.

Final calculated-report checks: full PostgreSQL291/291 exit0,260.12s; final verify145/93/52/6 exit0; actual extraction/API14/14 exit0,39.43s. Final arithmetic journey31.860s; exact source/revision/support/calculation/report/correction trace in verification/v6/calculated-report/journey.json. Unit binding controls reject invented/duplicate/unselected calculation keys while retaining source-approval requirements. Coverage reporting preserves criteria lacking a question and requires all final questions supported. Typechecks and2.05MB Android Hermes export passed.
Native evidence: authorized wireless ADB connected; Expo Go54.0.8 on Android16 loaded current Metro729-module bundle after an initial download failure. UI hierarchy/screenshots show keyboard-visible composer, exact draft retained after force-stop/relaunch (development URL retry required), signed-out Send redirect preserving draft, and Network request failed without backend. These are limited manual device observations, not authenticated research/source/correction/share or release-build proof. Cleared only the synthetic draft and stopped own Metro server. No paid calls, deployment, hosted migration or push.
Rollback: disable structured processing; retain new operation readers, provenance/deletion, unknown reservations and fail-closed publication. Next concrete work: account-safe native binary file selection/upload/source inspection, substantive counterevidence and matched same-pipeline evaluation. W01-W09 remains incomplete; W10 remains separately gated.

Device version clarification: the separately installed Deep Research APK remains the user’s older build and was not upgraded. Current-code native observations used Expo Go loading the workspace Metro bundle; these do not validate or update that installed APK.

Calculated report implementation and evidence committed as `e22598840b7d0df7da34549fdc6bb38b23111f6f`. Current installed APK remains unchanged; Expo Go observations are explicitly separate. Next: native binary upload/source inspection and remaining counterevidence/evaluation work. No claim of W01-W09 completion or production readiness.

## W04/W07 native binary input, export bibliography and W05 counterevidence — active checkpoint
Base1448c7d. Prior turn made concrete progress. User explicitly authorized parallel agents and wireless Android use, and clarified the installed standalone APK is old. Root implemented native binary input; independent export agent repaired bibliography; another agent implemented bounded counterevidence; a read-only canonical audit then reconciled current architecture/finding summaries. All remain uncommitted pending combined verification.
Native dependency install exit0: SDK-pinned picker14.0.8 and explicit filesystem19.0.24; only one new JS package. Initial mobile59/59, then60/60 after persistence control, final61/61 after binary late-account response control; typechecks pass. Actual system-picker PDF1211bytes reached the existing binary API with identical SHA-256. Before consent no upload. Fixture route disabled rejected run admission;0 runs/provider intents. Initial UI incorrectly called rejection a failed run; removed forced failed status. Explicit native delete confirmation revoked account and purged bytes/text/name/digest, retaining a redacted tombstone. Native local state cleared. Test PDF removed and own API/Metro stopped. Final progress presentation is unit/typechecked, not separately replayed as a full native journey. Standalone APK unchanged.
Audit exit1:3 moderate/4 high existing JS advisories; native graph is separate and unresolved. ADR024 records exact declared native dependencies, affected Commons IO XML reader advisory and limited inspected picker usage; no blanket clean-build claim. React best-practices skill applied to attachment component responsibility, event handling and accessibility; no framework redesign.
Export agent:6 unit,25 core and51 focused PostgreSQL pass. Initial50/51 failure was an incorrect HTTPS expectation on fixture locators, corrected without weakening ownership controls. Added wrong-account, foreign-run, reused membership/digest and unsafe metadata/URI controls. Both current and previous exports use owned bibliography; native share remains unverified.
Counterevidence agent dedicated tests pass. Tests exposed and fixed an unknown-receipt outcome label and a restart bug that mistook prior challenge search for ordinary discovery. Required proof marker survives absent derived rows. Original target persists across re-extraction omission. Full combined PostgreSQL and verify running; exact results pending. Root did not start a competing shared DB suite. No paid calls/deployment/hosted migration/push.


## User-requested session stop (2026-09-17)

The user requested a fresh-session prompt on the Desktop, then an immediate stop. No further implementation or extraction test was started. Resume prompt: `/home/oranolio/Desktop/Deep-Research-Next-Session-Goal.md`. Worktree remains uncommitted; HEAD remains `1448c7ded0d5302231aea9966f9104b0c2dfef3e`.

Terminal results supersede pending language above: combined `pnpm verify` exited 0 (148 core/99 backend/61 mobile/6 governance); full PostgreSQL integration exited 0 (305/305,16 files,289.00s); integrated Android JS export exited 0 (631 modules,2.09MB). Actual extraction rerun remains outstanding. Existing logs and counterevidence handoff were copied to `verification/v6/session-transition/` with SHA-256 manifest; registry integration/ADR025/final checkpoint commit remain next-session work. Agents were instructed to stop; no background continuation is promised.


## V6 resumed checkpoint review — 2026-09-17

Requirements W03/W04/W05/W06/W09. Base `1448c7ded0d5302231aea9966f9104b0c2dfef3e` plus preserved uncommitted native/export/counterevidence source. Command `EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime pnpm --filter @deep/backend test:extraction`: exit0,14/14 tests,3files,37.76s. Artifact `verification/v6/checkpoint-review/extraction.log`. Environment Linux, Node20.20.2/pnpm9.15.9/Python3.12, real local PostgreSQL127.0.0.1:55432 and isolated extraction runtime. Actual binary parsing/API/worker/source/correction; fabricated provider transports, zero paid calls. Source review identified limited-outcome counterevidence publication bypass; regression/repair pending here. Rollback disables new scheduling while retaining proof requirements, financial holds, ownership and deletion.

Checkpoint review final: limited publication now independently revalidates target proof/warnings, and missing required records reject every publication outcome. Crash recovery recognizes a saved challenge search before its pointer commits. Reproduced failures are retained;17 focused PostgreSQL controls pass (119 unrelated cases deselected), plus final backend types. Markdown export now retains escaped report limitations;7 units and1 focused E09 PostgreSQL case pass (50 unrelated cases deselected). These checks supplement preserved305 integration/combined verify and14 actual extraction passes; no whole-suite total is inferred for the final repair. Evidence: `verification/v6/checkpoint-review/`. No paid calls.

Source/doc staged diff check (excluding raw verification logs) passed. The unfiltered staged diff check flags trailing blank lines in preserved terminal logs; their exact bytes/hashes are intentionally retained rather than normalized. Document validators reran exit0 after canonical updates.

Reviewed implementation committed as `002e2d6f27e4bcf111cdc48f028a688f55c99713`; no push/deployment. Both user ZIPs remain untracked and intact. Follow-on code starts from this checkpoint.

## V6 follow-on local integration — 2026-09-17

W02/W03/W04/W06/W07/W08/W09, metadata baseea03632642d8aca1a215cb4e3f1fd02a7c7f66c6 plus uncommitted changes. Node20.20.2/pnpm9.15.9/Python3.12.3; real local PostgreSQL and isolated actual extraction; fabricated provider responses only, paid0. Focused provider recovery13/13 exit0 (2.07s), transport10/10 exit0, backend typecheck exit0. Preserved failed earlier integration7/8 was test-probe self-contention; original source-deletion/strategy failures also retained. Source-deletion6PGcontrols, strategy1PGcontrol, matched3actual-extraction controls and mobile67unit/type/export evidence are linked through verification/v6/RESULTS.json and per-directory FILES.json.

Source-inspected receipt review found undersized historical liability release and cross-account receipt/admission race; repaired with blocked insufficient holds and account/run→global(shared;exclusive for legacy unbound)→key→project locks. Actual DB barriers exercise three overlapping scopes; old semantic receipts remain unchanged. No production accounting repair or external metadata lookup executed.

Native current Expo Go actual PDF/API/worker report→source→reopen→correction→share preview (14fabricated model calls/0paid), existing old standalone unchanged. Required page/geometry and bibliography observed; process-restart reading-position check not passed. Harness SIGTERM cleanup deleted1created account; API/Metro stopped, synthetic file and reverse mappings removed. Agent usage limits interrupted remaining reviews; source saved.

Corpus frozen12tasks/13official documents before actual extraction. Acquisition first failed official redirect allowlist then corrected registered destination; source bytes reused by hash. Extraction retains1missing SQLite reference span. Neither narrow fidelity nor fabricated matched traces imply semantic superiority; B HTML latency slower than A1 remains evidence.

Integrated verify exit0:148core/114backend/67mobile/6governance; configured typechecks and boundaries passed. Removed pre-existing design typecheck `|| true`; subsequent `pnpm typecheck` exit0 includes unsuppressed design check. Full integration first exit1 (201pass/127fail/1unhandled rejection): prior focused synthetic NULL-key overrun correctly blocked all keys. Fixed test cleanup to restore its unique dummy key after proving legacy-global behavior; production guard unchanged. Inspected and isolated exact retained synthetic intent9f3586b0-1634-4e81-b187-349f3ae2a4cc in standard test DB without changing financial amounts; receipt log preserved. Full integration rerun is required and running.

Integrated PostgreSQL rerun terminal exit0:328/328,19files,313.52s; gateway136controls pass. Exact command pnpm test:integration, artifactverification/v6/follow-on/integration-final.log. Actual extraction starts afterward, serially. Preserved original matched document-controls.json as document-controls-pre-integrated.json before suite output replaces the current trace.

Actual extraction terminal exit0:17/17,4files,93.40s; EXTRACTION_RUNTIME=/tmp/deep-v6-extraction-runtime pnpm --filter @deep/backend test:extraction; artifactverification/v6/follow-on/extraction.log. Final backend types exit0 after test isolation cleanup. No native/signed-build or live semantic claim follows from these controls.

Reviewed follow-on committed as `5f10a8471b67b8a3ddd95245f2736fc794fba210`; no push/deploy. Both user ZIPs remain untracked and intact. Clean detached local clone `/tmp/deep-v6-clean-5f10a84` checks this exact commit with offline frozen install; independent hosted CI remains unexecuted.

W09 clean detached checkout5f10a8471b67b8a3ddd95245f2736fc794fba210: offline frozen install0downloads; verify148/114/67/6 exit0; fresh DBdeep_research_clean_v6_5f10a84 integration328/328 exit0,291.56s; actual extraction17/17 exit0,99.44s; combined mobile types/JSexport exit0,633modules2.1MB. Node20.20.2/pnpm9.15.9/Python3.12.3, reused explicit parser runtime; synthetic transports only. Evidence verification/v6/clean-checkout/RESULTS.json. Existing DBs were not dropped. Workflow configured, no hosted dispatch. Subsequent mobile content-cache work is a new uncommitted packet.

W03/W07 protected native content, uncommitted over5f10a84:78mobile tests and final mobile types pass; Android JS export634modules2.11MB exit0, not standalone build. Retained tests: initial75pass, coalescing76pass,77/78runs failed an old static Library-label ternary assertion after implementing the required two-tab/Profile navigation; same accessibility assertion was updated to require both labels and Profile, final78pass. No protection removed. Actual Expo Go Android16 migrated a synthetic report to2SecureStore chunks with ordinary snapshot absent; native logout removed them. Unpaced2640-character ADB injection yielded783/796/923visible/saved characters, retained as failed stress controls with cause unverified. Paced120-character batches/0.4s gaps delivered2640exact characters (59.89s), stored in2protected chunks, and survived cold process restart exactly; native two-tab labels and Profile→Settings were observed. Initial cold launches showing Expo home were retained before successful relaunch. Final UI logout/probe: no credential, report or plaintext snapshot/draft, guest length0; Metro stopped, reverse8081 and temporary XML removed. No API/model service was running in this cache probe; paid0. Own-project inspector emitted booleans/counts/synthetic text only.

Protected-content final pnpm verify terminal exit0:148core/114backend/78mobile/6governance, configured strict types/boundaries pass. Both canonical document validators exit0. This supplements the exact prior commit clean-checkout database/extraction proof; no backend source changed in this mobile packet.

Protected-cache reviewed implementation committed as `96ee11b727a4ed519c647cd24cfdb2892d72795d`. No push/deploy or paid research-provider call. Metadata update records the actual commit after source commit; both user archives remain untracked. Next local implementation is account/run/revision-bound correction-draft recovery; milestone remains incomplete.

### W06/W07 correction draft recovery — 2026-09-17

Base75c316e1e1b2dc9db82e0b156de5cd6491ce4fcb plus reviewed working-tree changes. Native protected snapshot retains correction text/policy/run/revision; stale drafts require explicit review. Mobile84/84 and typecheck exit0; AndroidJS export exit0 (not native build). Evidence: verification/v6/correction-draft/RESULTS.json and FILES.json. Android16/ExpoGo54.0.8, actual local API/worker/PDF, fabricated14model calls/paid0. Programmatic parent setup, native exact-text/nondefault-policy cold restart and correction submission; persisted refresh patch/reuse0; revised firmware4.2 report. Logout clears credential/report/correction/question; graceful harness shutdown deletes its created account. Initial psql query could not run (binary absent); same read-only query succeeded via installed pg adapter, recorded explicitly. Node20.20.2/pnpm9.15.9/local PostgreSQL; no hosted/native-build/live-quality upgrade. Rollback ADR030; next unblocked task admission retry identity.

Correction recovery implementation committed as `b5d494364d6e74d1658524e7aa318e882ba0cbb9`; subsequent metadata records the actual commit. No push/deploy.

### W02/W03/W07 admission retry — active checkpoint

Basec10109a, working-tree source. Server migrations034/035 are additive/idempotent, actual localPG focused24controls pass; unknown-key withdrawal shares admission/deletion account lock. Mobile protected journal holds payload identity before network, exact document digest, confirmed attachment IDs; adopted run snapshot precedes journal removal. Native response-loss/cold-restart reached original run with one attachment and fabricated7calls/paid0; a separate unadmitted request produced withdrawal/zero runs. Initial Android transparent retry was insufficient evidence, stronger held-reply test used. Read-only DB query initially failed missing outcome column; corrected terminal_outcome succeeded. UI layout regression reproduced/fixed; max8MiB syncdigest observation timed out10s, bounded asynchronous hashing was implemented, then replaced by SDK-native hashing after same-device performance evidence. Node receipt-GCdeadline loss reproduced and fixed with ownedtimer; before/after failures retained. See verification/v6/admission-retry receipts, canonical ADR031, final native hash adapter checks:97mobile/types/642module2.14MB JS pass; first8MiB1.681s/warm119ms, exactdigest, cancellationbeforecall.

### W02 lease-clock mutation audit — working tree overc10109a

Real local PG reproduced transaction-start-clock stale semantic/terminal writes, account/legacy/key/project-lock issuance, expired renewal revival and replacement leases alreadyexpired.11new controls plus execution/reconciliation/gateway/deletion affected suites passed188/188 on deep_research_lease_clock_v6; standardDB13financialcases initiallyfailed due retained unboundsyntheticliability (preserved). Source changes limited to fenced-session/live-spend/runs, no financialsettlement permission weakening. Initial self-blocking renewal harness terminated143 and corrected before reproducing actual2failures. Post-insert table-lock regression reproduced a further expired issuance; finalpostcheck rolls action/intent back and preserves allowance.12/12leasecontrols and types pass on finalsource;189distinct affected controls across retained suites, not one189test invocation. Bounded read-only audit found cancellation/event transaction candidate stillunverified. Exact evidence verification/v6/lease-clock; ADR032 rollback retains all current-time fences.

Final admission/lease checkpoint verification: pnpm verify exit0 (148core/116backend/97mobile/6governance), mobile typecheck exit0, Android JS export exit0 (642modules/2.14MB). Artifacts verification/v6/admission-retry/*integrated-final.log; basec10109a plus reviewed checkpoint source. Local Linux tools; no paid calls, native build or hosted CI claim.

Reviewed admission/lease implementation committed as `eb133e86ac9d8fc7a16be54088fc872c1c3fa63d`; no push/deploy. Follow-on cancellation audit and reading-position work remain separate uncommitted tasks.

Detached clean-checkout eb133e8 proof: offline frozen781package install (0downloads), verify148core/116backend/97mobile/6governance and642module2.14MB AndroidJS export exit0; checkout remains clean. Evidence verification/v6/clean-admission/RESULTS.json. Focused PostgreSQL evidence belongs to the implementation checkpoint; no new DB/native/hosted claim from these checks.

W02/W03 cancellation follow-on: three PostgreSQL defects reproduced and fixed with atomic owned cancellation/event writes;5new controls and81affected integration tests pass, backend types/boundaries pass. Artifacts verification/v6/cancellation-atomicity/RESULTS.json retain pre-fix failures. No new dependencies/migrations/live spend. Cancellation and reading-position implementation committed as 31539846f2ad1d31d75b5e6cb29edd0d6cb19e6c.

W03/W07 reading-position follow-on:11focused controls,108integrated mobile tests/types and AndroidJS export pass. Own ExpoGo cached-report control restored section6, then saved a real swipe to section7 offset124.08898162841797 and retained the exact anchor/visible section after cold process restart. Synthetic offline session, no API/model research; initial deep-link/inspector failures retained. Cache cleared, Expo/Metro/reverse stopped. Source internal position, rotation, accessibility, standalone/iOS remain separate. Evidence verification/v6/reading-position/RESULTS.json; ADR034 rollback preserves owned anchors.

Current reviewed cancellation/reading checkpoint: `31539846f2ad1d31d75b5e6cb29edd0d6cb19e6c`; source-deletion replay protection and requested-verification follow-ons are separate work in progress. No push/deploy or paid calls.

W02/W03 source-deletion replay: reproduced a delayed request creating a fresh run after deletion; existing035 opaque key-hash veto is now retained before scrubbing.11combined realPG tests/backend types pass. Artifacts verification/v6/source-deletion-replay/RESULTS.json; historical already-erased keys remain unrecoverable. Forward fix pending own checkpoint; no spend/deploy.

W03/W07 mobile source deletion: protected redaction-before-DELETE, source/version-bound confirmation, retained unknown-outcome retry, dependent cache and selected attachment clearing implemented;123mobile tests/types/JSexport pass within recorded scope. Native attempt created actual local synthetic PDF report (7fabricated calls,paid0), but keyguard blocked the UI controls. Server test account/content cleaned and API/Metro/reverses stopped. Protected synthetic device cache/session still needs clearing after unlock. No native source-delete pass claimed. Evidence verification/v6/mobile-source-deletion/RESULTS.json; ADR036.

Source-deletion UI implementation committed as `9d95ad50bfdd267a3d6b3b8d19246b9909927455`; source replay veto as `a86faf8`. Exact detached9d95ad5 checkout passed offline frozen install,123mobile tests,types and645module2.16MB AndroidJS export; clean afterward. Evidence verification/v6/clean-source-deletion/RESULTS.json. Native deletion remains unverified while device locked, with protected synthetic cache cleanup pending unlock. Requested-verification work is separate/uncommitted.

### W05 requested scoped verification — reviewed working tree over7ccfe802e9695a48fe01b15cf676c3d07cc60a41

Strict owned target/lineage, queued selected-source reassessment, required publication proof, negative evidence citations, deletion, bound recovery and protected mobile adoption implemented; ADR037. Local real PostgreSQL affected169/169, recovery28/28, requested/P3 combined73/73 and finalcitation4/4 pass across overlapping runs (do not sum). Agent packet retains type/mock/diagnostic/citation failures. Primary combined verify initially147/148core: old M08 expected regex-generated false verification. Reviewed test change now forbids that false claim and adds reportidentity/content checks; actual production verification has separate support/contradiction controls. Final verify148core/116backend/132mobile/6governance exit0; mobiletypes and647module2.17MB JSexport exit0; actualextraction17/17 in87.78s exit0. Node20.20.2/pnpm9.15.9/Python3.12.3/Linux/localisolatedPG; exactcommands/hashes in verification/v6/requested-verification-integrated/RESULTS.json. New matchedtrace copied into this packet, original priorcheckpoint artifact preserved. No paidcalls/nativebuild/humanadjudication. Private notes not assessed; malformed provenance mayretry but cannotpublish. Nativeflow/keyguardcleanup remainopen. Rollback disables scheduling, retains requiredproof/readers/deletion/settlement/unknownholds.

Requested scoped verification reviewed implementation committed as `f88091ac83fd57ba5ed6e28405ba7bfcca796289`; exact source includes primary regression reconciliation and final integrated evidence. No push/deploy. W01–W09 remains incomplete.

W09 exact f88091ac83fd57ba5ed6e28405ba7bfcca796289 detached checkout: offline frozen ignore-scripts install0downloads, verify148/116/132/6, mobiletypes,647module2.17MB JSexport exit0; finalstatus clean. No DB/networkprovider/paid/native execution. Artifacts verification/v6/clean-requested-verification/RESULTS.json. Canonical ENGINE prose reconciled against already-implemented worker/support/coverage/calculation/correction integration; historical pending-language superseded without upgrading semantic proof. Current design typecheck has no suppression since5f10a84; corrected new evidence caveat. Metadata-only rollback restores prior documents, not runtime gates. Native read-only lock-state recheck still mDreamingLockscreen=true; device cleanup remains pending.

W07 profile extraction over72145f2: same existing account/consent/restore/delete handlers, narrower display props, accessible callbacks and destructive confirmation; unavailable purchases/push wording corrected.136mobile tests/types and648module2.18MB AndroidJSexport pass, no native/DB/paid calls. Initial moved-label checks and classic-JSX React import failures retained; assertions relocated to component without removal, four rendered callback/confirmation controls added. Evidence verification/v6/profile-panel/RESULTS.json records exactcommands/revision/environment/hashes. No publicschema/dependency/migration/prompt change. Rollback inline presentation only; preserve account generations, deletion confirmation and privacy wording. React best-practices skill checklist applied, not independent human review.

Profile presentation implementation committed as `6490546f51bdbf0267abfba36aae9924e904f61b`; source/runtime authority boundaries unchanged. No push or deployment.

W06 rediscovery and exact-span corrections over6490546: reproduced disabled-discovery old-only report, one-line guard fixed; primary then reproduced unnecessary brief cost and moved capability check before preparation. Prior136gateway pass, final8span/rediscovery pass16.61s;7new corecontrols bring155core. Four prior gateway corrections preserve every meaningful assertion while explicitly admitting discovery and checking receipts/no-reread; fresh-version input now uses durable read. Corrected/full facts identical,1vs2reads,8attempts/10syntheticmicro each; no model-cost saving or independent semantics. Strict span API validates server SHA256, ownedrevision, exactUTF16quote/Unicode/resultbounds; no new dependency/migration/provider, no semanticcriterionUI. ADR039/040. All failures/commands/hashes preserved in question-patch and correction-rediscovery.

W09 PostCSS root integration: scopedoverride8.5.28, offline frozenignore-scripts install0downloads,136mobile/typecheck/648module2.18MB JSexport exit0; actualresolvedMetroconfig54.0.17→8.5.28. Audit exit1 remains3moderate/2high; isolatedVitest4experiment separate, not adopted. ADR038; verification/v6/dependency-postcss-integrated/RESULTS.json. No paid/provider/nativebuild proof.

Final correction/PostCSS integrated verify exit0:155core/116backend/136mobile/6governance and configuredtypes/boundaries. Evidence verification/v6/correction-checkpoint/RESULTS.json. Actual extraction on these final changes remains for the next coordinated dependency checkpoint; older17/17 receipt is f88091a.

W09 dependency checkpoint: Vitest4.1.11 adoption over5fbec3a: full real local PostgreSQL393/393 (26files,397.62s), actual extraction17/17 (79.03s), verify155core/116backend/136mobile/6governance, mobiletypes and offline frozen install all exit0. No assertion/source/config adaptations. Audit remains exit1 with1moderate/2high. Exact commands/environment/hashes: verification/v6/dependency-vitest-integrated/RESULTS.json. Synthetic data/fabricated providers, paid0; no live/native/hosted/clean-checkout claim.
