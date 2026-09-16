# Execution status — application implementation
As of 2026-09-16. Runnable TypeScript monorepo plus Revision 3 canonical documents.

## P0 gates
| Gate | Status | Evidence |
|---|---|---|
| P0-D local Postgres/queue + twelve smoke + fencing | implemented and verified | `pnpm test:integration` 69/69 twice; postgres:16.10-alpine on 55432; pg-boss 10.0.4 |
| P0-L live model/retrieval | implemented and verified (bounded) | One consented `controlled-research` run `1351c267` published report `6cdf6f92` from HTTP passages (IONOS/SysEleven/ayedo full-text 20k chars) plus correction `5f8a7af2` report `cce6aadb`. Model `openai/gpt-4o-mini` + web plugin. OpenRouter usage **$0.096 of $5**. |
| P0-N iOS | blocked by a named external dependency | Linux host, no Xcode |
| P0-N Android | partial — physical device + Expo Go + installed preview APK | Xiaomi `25098RA98G` `a3fa7852`; Expo Go SDK 54 ran a fixture report; EAS preview APK `d7e7b407` installed as `app.deepresearch.mobile` |

P0 is **not** fully verified.

## P1 / P2 (fixture engine, not a competitive claim)
| Item | Status |
|---|---|
| P1 decision-blocking gap + source-type switch (V2-01, V2-02, R08) | implemented and verified on the labeled fixture route |
| P2 relaxed-constraint candidate reopen (V2-04) | implemented and verified (Vendor C appears only after budget 50→120) |
| P2 numeric unit correction (V2-05) | implemented and verified |
| P2 unknown-dependency full rerun (V2-06) | implemented and verified |
| P1/P2 vs a live same-model baseline | blocked — needs P0-L credentials |

These are fixture-route behavioral tests. They are not evidence of advantage over ChatGPT/Gemini/Claude/Perplexity/Grok.

## Additional launch-scope cases now executed against Postgres/fixture
R02, R03, R06, R07, R10, R11, R12, R14, R15, R16, R17, R18, R19, R20, R21, R22, E03, E04, E05, E06, E07, E08, E09, E10 (unit), J02, J04, J06, J07, J08, J09, J10, J11, J12, J13, J14 (application outbox, not OS delivery), S03, S04, S06, S07, S08 (unsigned reject; sandbox still gated), S10, S11, S12 (logout cache; live push gated), V2-03, V2-09, V2-10, V2-11, V2-15, V2-16, V2-17, V2-18, V2-19, V2-20. Native structural: M03, M05, M06, M07, M08, M09, M10, M12, V2-12.

## Still open (not claimed done)
- **P0-L / P0-N device evidence** remain blocked.
- M01/M02/M03/M04/M11 **on device**: VoiceOver/TalkBack, iOS/Android lifecycle, purchase sandbox.
- J14 live push transport; S08 signed store webhooks; hosted Supabase/Render/auth/RLS/storage/pooler.
- Seed eval validation and competitor comparison.

Native structural close/reopen now round-trips token/draft/run through `persistSession`/`hydrateOnLaunch` (not in-memory only). Library open binds the run on Research before polling. `pnpm p0:launch` cancels during `writing` and asserts no published report.

## Next executable task
1. `OPENROUTER_API_KEY` + `LIVE_SPEND_CAP_MICRO>0` for P0-L and a matched P1 live ablation.
2. Android emulator/device for P0-N; macOS/Xcode for iOS.
