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
