# Builder handoff

Working tree: `main` at `5122a3cbf14264fbb0c2927bb4ade9f9756e2125`. P0 is **not** fully verified: iOS P0-N is blocked.

## Working behavior
- `sudo docker compose up -d --wait` — Postgres 16.10 on **55432**.
- `pnpm db:migrate && pnpm test:integration && pnpm verify && pnpm dev:demo`
- Fixture research: consent → idempotent create → worker persists passages → cited report.
- Attachments are ingested as `attachment://` evidence and are not copied into public search queries (JOB-2, V2-13).
- Off-coverage bait from retrieved pages is declined without skipping remaining fetches (R10 + R14).
- Paywalled fetches persist `access_level=blocked` even when snippet bytes match (R07). Reports use the latest source version (V2-19).
- P1: compatibility questions escalate from review summaries to a vendor matrix (V2-01/V2-02).
- P2: relaxing a 50 EUR cap to 120 EUR discovers Vendor C (V2-04).
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
- Compact layout: composer is research-only so Settings/Library are not covered; attach chrome hides while the keyboard is open; Start research stays on screen.
- M04 on Xiaomi: fixture reports emit a wide `comparison-table` and `candidate-listing` code block. Nested horizontal ScrollViews show extra columns/locators without widening the screen. Citations wrap. Source sheet and library titles wrap. Unicode long-token breaking is unit-tested (`café`, `漢字`).

## Commands (this session)
| Command | Exit | Notes |
|---|---|---|
| `pnpm test:integration` | 0 | 76 tests including R19 follow-up change_summary |
| `pnpm verify` | 0 | typecheck, unit, AST boundaries; nonbillable |
| `pnpm --filter @deep/mobile test` | 0 | 32 tests including S12 logoutLocal |
| `pnpm --filter @deep/research-core test` | 0 | 23 tests including follow-up changeSummary |
| `pnpm p0:launch` | 0, twice | citations resolve; `cancelOutcome=cancelled`; `cancelReportId=null` |
| `tsx scripts/p0-live-check.ts` | 0 (earlier) | run `1351c267` / correction `5f8a7af2`; $0.096 of $5 |
| `pnpm test:e2e:ios` | 2 | no Xcode |

## Blockers
- **P0-N iOS:** Xcode / iOS runtime. TestFlight deferred by user.
- Hosted Supabase/Render/auth/RLS/storage/pooler unverified.
- Purchases and live push gated, not simulated as successful.
- GitHub HTTPS push was blocked earlier (`gh` token mismatch); do not force-push.

## Unresolved
- iOS VoiceOver not exercised. Purchase sandbox not connected.
- J14 proves application outbox dedupe, not OS push delivery.
- P1/P2/P3 fixture tests are not a competitor win. Do not spend more OpenRouter unless remaining cap and a new live need justify it.

## Next
iOS P0-N at the end (Xcode). Hosted auth/storage/pooler when those credentials exist. Do not mark iOS or hosted auth as passed.
