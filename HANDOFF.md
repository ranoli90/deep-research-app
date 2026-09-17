# Builder handoff

## Active V6 checkpoint
W01–W09 implementation is unfinished on base `03fab6b9d6a04ce9fdaeb48636383757213f7242`. Read the current STATUS introduction and `verification/v6/RESULTS.json` before relying on historical passes below. Staged input: `/tmp/deep-v6-staging`. User ZIPs are preserved untracked.

The safety/extraction checkpoint is recorded in STATUS and `verification/v6/RESULTS.json`. Focused PostgreSQL/transport tests: 23/23; new ingestion storage test: 1/1; real isolated parser tests: 3/3; `pnpm verify`: pass. Latest broad integration remains **62 failed / 69 passed (131 total)**, including extraction storage additions. The stricter publication gate rejects unmapped legacy composer blocks. Repair real claim/derivation bindings and lease recovery paths; do not exempt fixtures or weaken assertions.

Next executable task: implement authoritative persisted claim revisions/support results and safe report composition, starting with extra unmapped assertions inside a block that has one valid claim. Then restore the complete API/worker regressions, complete scoped budgets/deletion/identity, actual binary documents, general gateway and typed actions, corrections/reuse and mobile/evaluation. The current extraction runtime is locally installed at `/tmp/deep-extraction-experiment/venv`; use the committed hash lock for a durable installation. Public saved bytes are temporary at `/tmp/deep-extraction-experiment/corpus`; only hashes, limited references and measurements are committed. No current paid allowance has been established. W10 remains separately gated.

Working tree: `codex/v6-evidence-milestone`, based on the Phase 2 adaptive-controller commit. P0 is **not** fully verified: iOS P0-N is blocked.

The legacy review-package validator also fails on `implemented_application_command` registry statuses (18 errors); this is recorded separately from the passing application checks. Its schema reconciliation is still open.

## Working behavior
- `sudo docker compose up -d --wait` — Postgres 16.10 on **55432**.
- `pnpm db:migrate && pnpm test:integration && pnpm verify && pnpm dev:demo`
- Fixture research: consent → idempotent create → worker persists passages → cited report.
- Attachments are ingested as `attachment://` evidence and are not copied into public search queries (JOB-2, V2-13).
- Off-coverage bait from retrieved pages is declined without skipping remaining fetches (R10 + R14).
- Paywalled fetches persist `access_level=blocked` even when snippet bytes match (R07). Reports use the latest source version (V2-19).
- P1: compatibility questions escalate from review summaries to a vendor matrix (V2-01/V2-02). V2-03 gold-evidence diagnostic: without the matrix passage the report does not use the limitation; with the injected matrix it does (`bottleneck=retrieval`). Not a competitor A/B.
- P2: relaxing a 50 EUR cap to 120 EUR discovers Vendor C (V2-04). A known candidate-space reopen is **not** a full rerun (`fullRerun=false`); unknown-dependency completeness still forces `fullRerun=true`. A scratch run of the corrected 120 EUR task also finds Vendor C.
- Close/reopen restores token, draft, and last run via `persistSession`/`hydrateOnLaunch`. Library opens a saved run on Research immediately. Cancel during writing is asserted by `pnpm p0:launch`.
- Native Android attach: run `99391a32` ingested `attachment://700ba177` (`note.txtt`); source sheet showed FULL-TEXT `INTERNAL-PROPOSAL`. Attach fields collapse while a report is open.
- Native Share Markdown opened the Android share sheet with the report markdown. Native 120 EUR correction `cbc04309` (parent `99391a32`, brief revision 2) discovered Vendor C; UI shows `budget=120 EUR` and `Eligible: Vendor A, Vendor C` with the previous version retained. Concise view now keeps constraints and eligibility.
- `publishReport` re-reads `accounts.deleted_at` so a late worker cannot pass `deleted: false` and resurrect private text. Native Flag stored challenge `9806c317` (`claim-primary`, "Flagged from the app") without rewriting the report.
- TalkBack on Xiaomi: composer, progress (`writing` + Cancel), report, source sheet (FULL-TEXT + Close), library Open/Share, and settings (including Delete) all exposed content-descriptions. TalkBack was disabled after capture. iOS VoiceOver was not exercised.
- M02 enlarged text: `font_scale=1.3` on Xiaomi. Composer+Send, report, source sheet, library titles, and Settings including Delete remain readable. Scale restored to 1.0.
- M05: with the API down, Send shows “Network request failed” and “Offline. Draft and last report stay on this device.” The draft and last fixture report remain; no new run was published. API was restarted afterward.
- M08: Verify this claim published a child report with change summary “Targeted follow-up verified the named claim without reopening candidate discovery.” Previous version remains on screen with Share previous Markdown.
- R02: a filing-deadline question without geography showed Need one detail / jurisdiction on the Xiaomi. Continue with Germany produced a report with `geography=germany` and no second clarify. New runs now clear the previous report and attachments so the clarification card is visible.
- S12: Log out keeps the composer draft, hides the report, and Library says sign in. Polling stops so a late snapshot cannot resurrect the previous account’s report. Signed in again afterward.
- M09: Settings “Open web deletion page” launched Chrome at `http://127.0.0.1:8787/account/deletion` with a session-token form. GET is public HTML; POST with a valid token deletes. The form was not submitted on the phone.
- S02: `safeFetch` uses `redirect: manual` and re-runs `assertSafeUrl` on Location. Unit tests mock a 302 from `http://1.1.1.1/public` onto metadata/loopback/private hosts and assert those targets are never fetched.
- V2-14: an `outcome-unknown` OpenRouter intent of 4 USD micros counts against the live cap; a further 1.2 USD estimated call is refused. Treating unknown as zero would have allowed it.
- P0-N Android this session: consent granted; fixture report Vendor A 40 EUR; `am force-stop` + reopen restored report, sources, and draft; source sheet FULL-TEXT `3fc2e7b9`. `pnpm p0:launch` `cancelOutcome=cancelled` `cancelReportId=null`. 120 EUR correction: Eligible Vendor A + Vendor C; table row Vendor C germany 70 EUR; change summary reopened discovery.
- E09: `/v1/reports/:id/export` is Markdown only (PDF is not advertised). `blocksToMarkdown` emits tables, fenced code, and `[8-char]` citations. Integration asserts every export citation prefix is an owned passage for that run.
- V2-12: `restoreReadingPosition` scrolls the conversation to the persisted `readingAnchor` after hydrate and after closing the source sheet.
- Native PDF attach: filename `scan.pdf` (mime application/pdf); report caveat “Unread pages or scanned tables are not treated as fully read.” Share Markdown opened `ChooserActivity` with the report markdown preview. The sheet was dismissed without sending.
- Compact layout: composer is research-only so Settings/Library are not covered; attach chrome hides while the keyboard is open; Start research stays on screen.
- M04 on Xiaomi: fixture reports emit a wide `comparison-table` and `candidate-listing` code block. Nested horizontal ScrollViews show extra columns/locators without widening the screen. Citations wrap. Source sheet and library titles wrap. Unicode long-token breaking is unit-tested (`café`, `漢字`).
- G01/G02 local suite (`verification/g01-g02.json`): cross-user deny, private canary omitted from search, missing/declined/revoked consent cannot process (including revoke-during-writing), deletion blocks late resurrection, unknown citations cannot publish, accepted runs remain in library/GET, replayed completion debits once, stale brief/evidence/lease cannot publish, cancel-during-writing leaves no report. Hosted RLS/auth is not this suite.
- P4 recovery drill (`verification/p4-recovery.json`): crash after fetch keeps passages; a live lease cannot be stolen; an expired lease is recovered by another worker; crash before publish plus failover still yields one report and one settlement. `pnpm --filter @deep/backend typecheck` now exits 0.
- G06 local (`verification/g06-cost.json`): `GET /v1/routes/capabilities` pins fixture tariffs and refuses internal-search visibility; `GET /v1/runs/:id/cost` reconciles fixture spent_micro to intents. Settings shows processor disclosures from `GET /v1/settings`. Not a live OpenRouter invoice probe.
- G03 Android (`verification/g03-android.json`): create, source FULL-TEXT, share chooser, library open, 120 EUR correction (Vendor C eligible), close/reopen, deletion page. Conversation is hidden while the source sheet is open. iOS still blocked — G03 is not both-platform.
- G07/M10 local (`verification/g07-output.json`): in-app generated-output report with category, explanation, excerpt permission; privacy data flows; restore purchases gated 403. Not store review or M11 sandbox.
- E10 (`verification/e10-critical-claim.json`): worker/fixture withdraws an asserted 42% conclusion when the inspected table is 24%; remaining evidence keeps 24%. Not G04 quality.
- JOB-1 (`verification/job1-eligibility.json`, `verification/job1-linux-correction.json`, `verification/job1-linux-drop.json`): adding Linux excludes NoteKeep; dropping Linux re-includes it. EVAL-01 is still draft_not_validated.
- P0-N Android recapture (`verification/p0n-android-recapture.json`): persist/hydrate after force-stop, library open, FULL-TEXT source, cancel-during-writing `3e0f50a5` cancelled with no report. iOS still blocked.
- R02 (`verification/r02-continue.json`, `verification/r02-geo-search.json`): empty continue is 400; confirmed geography is appended to the search query so France does not reuse the Germany default note.
- Controller admission: every fixture/live/model proposal passes `admitProposedAction` (schema, allowlist, capability flags, consent/cancel/delete, revision, dedupe, private query, spend, unsafe URL, untried blocking-gap synthesize). **Live default is `selectAdaptiveAction` (`research-controller.v1`)**. `nextLiveAction()` / `selectBaselineAction` remain the bounded comparison arm (`LIVE_CONTROLLER_KIND=baseline`). Live provider cost is gated by `liveSpendUsedMicro` / `LIVE_SPEND_CAP_MICRO`, not the fixture run-budget reserve (`LIVE_CALL_RESERVE_MICRO` 200_000 vs `DEFAULT_RUN_BUDGET_MICRO` 100_000). Intents are inserted as `issued` before HTTP; `failed`/`outcome-unknown` keep the reservation. Gaps persist `payload`; contradictions/disconfirmations persist via events + `005_controller_intelligence.sql`. Fixture baseline vs adaptive (12 families): `verification/benchmark-fixture.json` (Nimbus gold matrix recalled only on the adaptive arm; ablations show gap detection and source pivot are what retrieve it). Live adaptive smoke `1ceed974` / report `1a5a089d`. Not a competitor win.

## Commands (this session)
| Command | Exit | Notes |
|---|---|---|
| `pnpm test:integration` | 0, twice | 107 tests including live-search issued-before-fetch |
| `pnpm --filter @deep/research-core test` | 0 | 48 tests including adaptive closed loop |
| `pnpm --filter @deep/backend typecheck` | 0 | |
| `pnpm --filter @deep/backend test:unit` | 0 | 22 tests including 12-family fixture benchmark |
| `pnpm verify` | 0 | typecheck, unit, AST boundaries; nonbillable |
| `pnpm --filter @deep/mobile test` | 0 | 32 tests |
| `pnpm p0:launch` | 0, twice | citations=10; `cancelOutcome=cancelled`; `cancelReportId=null`; `latePublicationRejected=true` |
| `pnpm eval:fixture` | 0 | 12 families; Nimbus/primary gold only on adaptive; ablations |
| `tsx scripts/p2-live-adaptive-check.ts` | 0 then timeout | completed `1ceed974` / `1a5a089d`; second `4cb9599d` cancelled after extra live searches. **$2.80 of $5 reserved** |
| `tsx scripts/p0-live-check.ts` | 0 (earlier) | run `1351c267` / correction `5f8a7af2`; historical bounded |
| `pnpm test:e2e:ios` | 2 | no Xcode |
| `pnpm test:e2e:android` | 2 | no device online; prior Android evidence not re-run |

## Blockers
- **P0-N iOS:** Xcode / iOS runtime. TestFlight deferred by user.
- Hosted Supabase/Render/auth/RLS/storage/pooler unverified.
- Purchases and live push gated, not simulated as successful.
- GitHub HTTPS push was blocked earlier (`gh` token mismatch); do not force-push.

## Unresolved
- iOS VoiceOver not exercised. Purchase sandbox not connected.
- J14 proves application outbox dedupe, not OS push delivery.
- P1/P2/P3 fixture tests and the 12-family fixture benchmark are not a competitor win. Remaining OpenRouter cap ~$2.20 of $5. Do not spend more unless a new live need justifies it.

## Next
iOS P0-N / G03 iOS at the end (Xcode). Hosted auth/storage/pooler when those credentials exist. Do not mark iOS, both-platform G03, hosted auth, M11 purchases, G04, G05, or full G07 store review as passed.
