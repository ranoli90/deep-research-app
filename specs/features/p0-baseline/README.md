# Feature packet: P0 baseline

- Goal: consented question → durable worker → accessed evidence in PostgreSQL → bounded cited report → cancel/delete/correction fences.
- Non-goals: live push, store purchases, hosted Supabase parity, competitive superiority claims.
- Contract IDs: R01, R04, R05, R09, R13, E01, E02, J01, J03, J05, S01, S09, V2-07, V2-08, V2-09.
- Privacy/spend: development auth only; fixture route labeled; live route refuses to start without keys; deletion redacts passages and reports.
- Tests: `pnpm test:integration`, `pnpm p0:launch`, `pnpm verify`.
- Rollback: disable live route; keep fixture + deletion/cancel fences.
