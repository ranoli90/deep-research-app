# Execution status — application implementation
As of 2026-09-16. Runnable TypeScript monorepo plus Revision 3 canonical documents.

## P0 gates
| Gate | Status | Evidence |
|---|---|---|
| P0-D local Postgres/queue + twelve smoke + fencing | implemented and verified | `pnpm test:integration` 75/75; postgres:16.10-alpine on 55432; pg-boss 10.0.4 |
| P0-L live model/retrieval | implemented and verified (bounded) | One consented `controlled-research` run `1351c267` published report `6cdf6f92` from HTTP passages (IONOS/SysEleven/ayedo full-text 20k chars) plus correction `5f8a7af2` report `cce6aadb`. Model `openai/gpt-4o-mini` + web plugin. OpenRouter usage **$0.096 of $5**. |
| P0-N iOS | blocked by a named external dependency | Linux host, no Xcode |
| P0-N Android | implemented and verified on device (cancel-during-writing via API launch-check) | Xiaomi `25098RA98G`; attach, share, 120 EUR Vendor C, Flag submitted `9806c317` on report `6bb62a2f` |

P0 is **not** fully verified.

## P1 / P2 (fixture engine, not a competitive claim)
| Item | Status |
|---|---|
| P1 decision-blocking gap + source-type switch (V2-01, V2-02, R08) | implemented and verified on the labeled fixture route |
| P2 relaxed-constraint candidate reopen (V2-04) | implemented and verified (Vendor C appears only after budget 50→120) |
| P2 numeric unit correction (V2-05) | implemented and verified |
| P2 unknown-dependency full rerun (V2-06) | implemented and verified |
| P2 non-budget correction does not reopen Vendor C | implemented and verified |
| P1/P2 vs a live same-model baseline | not run — remaining OpenRouter cap ~$4.90 reserved |

These are fixture-route behavioral tests. They are not evidence of advantage over ChatGPT/Gemini/Claude/Perplexity/Grok.

## Additional launch-scope cases now executed against Postgres/fixture
R02, R03, R06, R07, R10, R11, R12, R14, R15, R16, R17, R18, R19, R20, R21, R22, E03, E04, E05, E06, E07, E08, E09, E10 (unit), J02, J04, J06, J07, J08, J09, J10, J11, J12, J13, J14 (application outbox, not OS delivery), S03, S04, S05, S06, S07, S08 (unsigned reject; sandbox still gated), S10, S11, S12 (logout cache; live push gated), JOB-2, V2-03, V2-09, V2-10, V2-11, V2-13, V2-15, V2-16, V2-17, V2-18, V2-19, V2-20. Native structural: M03, M05, M06, M07, M08, M09, M10, M12, V2-12. Native device: Library, persist, attach+source, Share Markdown, 120 EUR correction (Vendor C), Flag/challenge on Xiaomi.

## Still open (not claimed done)
- **P0-N iOS** blocked: no Xcode on this Linux host; TestFlight deferred.
- M01/M02/M04/M11 **on device**: TalkBack/VoiceOver, purchase sandbox, long-content overflow with keyboard+attach+report on compact screens.
- J14 live push transport; S08 signed store webhooks; hosted Supabase/Render/auth/RLS/storage/pooler.
- Seed eval validation and competitor comparison. Do not spend more OpenRouter unless remaining cap and a new live need justify it (~$4.90 of $5 left).

P0 is **not** fully verified while iOS is blocked.

## Next executable task
1. macOS/Xcode for iOS P0-N (deferred by user until the end).
2. TalkBack on the Xiaomi when available.
3. Hosted auth/storage/pooler only when those credentials exist. Do not mark iOS or hosted auth as passed.
