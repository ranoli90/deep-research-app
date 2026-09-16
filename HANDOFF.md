# Builder handoff

Working tree: `main` at `d1f6862937bf1888d00aa4def0c25732fd51eeb7`. P0 is **not** fully verified: iOS P0-N is blocked.

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

## Commands (this session)
| Command | Exit | Notes |
|---|---|---|
| `pnpm test:integration` | 0, twice | 73 tests |
| `pnpm verify` | 0 | typecheck, unit, AST boundaries; nonbillable |
| `pnpm --filter @deep/mobile test` | 0 | 22 tests including persist/hydrate round-trip |
| `pnpm p0:launch` | 0, twice | citations resolve; `cancelOutcome=cancelled`; `cancelReportId=null` |
| `tsx scripts/p0-live-check.ts` | 0 (earlier) | run `1351c267` / correction `5f8a7af2`; $0.096 of $5 |
| `pnpm test:e2e:ios` | 2 | no Xcode |

## Blockers
- **P0-N iOS:** Xcode / iOS runtime. TestFlight deferred by user.
- Hosted Supabase/Render/auth/RLS/storage/pooler unverified.
- Purchases and live push gated, not simulated as successful.
- GitHub HTTPS push was blocked earlier (`gh` token mismatch); do not force-push.

## Unresolved
- TalkBack/VoiceOver and purchase sandbox not exercised on hardware.
- J14 proves application outbox dedupe, not OS push delivery.
- Compact Android layout: keyboard + attach fields crowd the report (Send remains visible).
- P1/P2/P3 fixture tests are not a competitor win. Do not spend more OpenRouter unless remaining cap and a new live need justify it.

## Next
Keep Android work: restart the 8787 worker so native attach uses `ingestAttachments`. iOS at the end. Hosted credentials when provided.
