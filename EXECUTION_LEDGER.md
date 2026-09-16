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

