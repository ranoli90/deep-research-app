# Grok → Codex final handoff (V8.1 integration)

**Do not treat this as Research Beta complete. Do not merge `main` from this SHA.**

Frozen 2026-09-19T22:58:59Z. Written so a new Codex session can continue without this Grok conversation.

---

## A. Exact repository state

| Item | Value |
|---|---|
| Repo | `https://github.com/ranoli90/deep-research-app.git` (private, ranoli90) |
| Worktree | `/home/oranolio/Desktop/deep-v8-integration` |
| Branch | `grok-v8/research-beta-integration` |
| Local HEAD at freeze | `487e08fbdc965e81aeaf622dd631cd3f4b7c86ce` |
| Remote HEAD at freeze (fetch) | `487e08fbdc965e81aeaf622dd631cd3f4b7c86ce` — **matches local** |
| `main` / `origin/main` | `8a7b1a997aefc53f8b06497346c0f915e2d455a7` — **never merged, never reset** |
| Merge-base with main | `8a7b1a997aefc53f8b06497346c0f915e2d455a7` |
| V8.1 audit / fix-pass base | `906c00fe0190b040b93f16ed7057ea4cd2e5eb95` |
| Twice-green PG evidence SHA | `d88cf6265303149ba002c224af57f9e6a466c2cc` (**historical**; not HEAD) |
| Visual-identity APK SHA | `435d1bf588847f1c6b887e1b43d3eb29a8c8ccc3` |
| Direct-URL worker SHA | `487e08fbdc965e81aeaf622dd631cd3f4b7c86ce` (HEAD; **no new APK**) |
| Dirty at freeze | `SourceSheet.tsx` + `product-styles.ts` (fieldLabel split) **preserved** in `GROK_UNCOMMITTED.patch`; then restored. Visual QA PNGs untracked until this handoff commit. After this commit the tree should be **CLEAN**. |
| Migrations present | `001`–`031`, `033`–`046` (no `032`). Canonical: `042_model_portfolio.sql` → `043_retrieval_intelligence.sql` → `044_query_authorization_proof.sql` → `045_model_operation_attempts.sql` → `046_research_controller_state.sql`. One logical model-portfolio migration. |

### Services / DBs / device used this session

- Postgres `127.0.0.1:55432` user `deep` / password `deep_local_dev_only`. Isolated DBs include `deep_v8_int13`, `deep_v8_int14`, `deep_v8_p0_rev`, `deep_v8_direct`, `deep_v8_live_j12`, fixture `8788`.
- Fixture API `127.0.0.1:8788` (and older Session C `8787`). Device reverse: `adb reverse tcp:8787 tcp:8788`.
- Physical Android wireless: `10.0.0.167:43417` (also appears as `Android-2.local:43417` — same kunzite 25098RA98G). Package `app.deepresearch.mobile`.
- EAS account `jobeezyapp`, project `deep-research`, profile `device`. Token `~/.jobeezy-expo-token`. Latest build `ea81c118-f9d3-4eee-adb0-15b7b40b0136`.
- OpenRouter live spend: isolated DB `deep_v8_live_j12`, cap **2,000,000 µ**. MC-D01 21,658 µ unknown hold **not released/retried**.
- Hosted GitHub Actions: **owner declined**. Do not dispatch `verification.yml`.

Primary checkout `/home/oranolio/Desktop/Deep` was dirty at session start and **must not be stashed**. Integration work is only this worktree.

---

## B. Work performed (especially after `906c00f`)

Chronological, production-behavior first.

### Integration of A/B/C onto current main (before/around the audit)

Isolated worktree from `main@8a7b1a9`. Merge order: preserve main-only fixes → Session C UI `0a694f9` → final Session A `8abcffd` → canonicalize migrations → Session B current tip `e0b00df` (kit pin `d100b86` was stale). Manual unions, no whole-file ours/theirs. Main-only discovery-policy continuation, held-intent continuation, model-validation diagnostics, context batching, deletion-race, SourceSheet/Android Back preserved.

### Engineering fix-pass waves (audit `906c00f`, 126 findings)

| Wave | Production behavior | Merge notes |
|---|---|---|
| 1 briefs | `/continue` does **not** rewrite `originalQuestion`. Confirmed geography is `userPublicTerms` / `confirmedConstraints` (`model-input.v6`). `getBrief` fail-closes on column/payload mismatch. Typed clarification parsers. | **Ported, not wholesale-merged** (wholesale would have reverted Wave 3 unclassified fail-close). |
| 2 provider | Failover persists under **fallback** `intentId`. Unknown cost HOLD, no `repairPass` unless known-cost `invalid_output`. Migration `045`. | Merged `0ab1f7b` / `8fcf103`. ADR remap 070→071. |
| 3 query privacy | Unknown query tokens unclassified/blocked. Approval binds digest+terms. Pending consumed. Migration `044`. | Merged `0ae1a15`. Residual worker Gate A fail-closed. |
| 4 search/read | New Azure searches use `public-discovery-azure-zdr.v3` `maxResults=8`. Frozen v1/v2 stay 3. `full-text` counts as readable. | Merged `b01f37e`. **No live 8-hit receipt.** |
| 5 intelligence | Durable Evidence Needs, candidate ledger, `conclusion_challenges`, reconstruct queries from `search_operations` on crash. Migration `046`. | Merged `1448e78`/`27beb17`. Unioned with Wave 3 `runPublicSearch`. |
| 6 publication | Limited publication restores coverage; missing critical criterion rejected. | Merged `5141bbd`. |
| 7 activity | `GET /events` is `public-activity.v1` only. Mobile `adoptPublicEvents` ignores legacy `type`/`publicSummary`. | Merged `3d936a8`/`b70ab7b`. |

### Late P0s at `2fac564` (after waves)

- **FP-003 / `/continue`:** new brief identity (`commitBriefRevision`); confirm metadata-only; terminal assumption replace admits a child run. Prior brief rows stay.
- **FP-013:** `failed` + `confirmed_micro=0` is known-zero (404). `issued`/`outcome-unknown` HOLD. 429/transport HOLD. Not treated as unknown liabilities.
- **FP-060:** `document-web-reconciliation.v2`. Lexical overlap is triage only. Final status uses `passageSupportsClaim` + number/scope/date/version guards. Paraphrase overlap → unverifiable, not confirmed.

Isolated PG `deep_v8_p0_rev`: brief-continue 4/4; assumption replace bumps revision; A09 settle; gateway unknown fallback. **Not full PG twice on `2fac564`.**

### Visual identity at `435d1bf`

Docked hairline composer (22px send inside 44px hit), stacked empty examples, activity **event rail**, compact numeric citations, tappable outline, quote-first labeled source sheet, flattened Settings, Library FlatList search, haptics via `Vibration`, App.tsx split (`PendingBanners`, `ReportActions`, `CorrectionPanel`). Mobile units **291/291** and typecheck on that tree. Physical APK of **this SHA** installed (see J).

### Direct URL at `487e08f` (HEAD)

Steering already persisted `url:` in `sourceRestrictions`. Worker now `adoptDirectUrls` + `readAdoptedSources`. `admitUserSuppliedUrl` allows explicit URLs even under `prefer_primary`, unless excluded. Integration test `direct-url.integration.test.ts` 1/1 twice on `deep_v8_direct`. **Not in the installed APK. Full PG not re-run.**

### Uncommitted at freeze (preserved, not production)

`GROK_UNCOMMITTED.patch`: split `kicker` (no uppercase) vs `fieldLabel` (uppercase for source-sheet labels). Interrupted during screenshot review. Focused mobile tests of that diff passed; **not APK’d, not committed as product.**

---

## C. Tests that ACTUALLY ran

**Never transfer an older SHA’s green onto HEAD.**

### Twice-green full PostgreSQL (historical)

| DB | Command | SHA | Result | Artifact |
|---|---|---|---|---|
| `deep_v8_int13` | `pnpm --filter @deep/backend test:integration` | **`d88cf6265303149ba002c224af57f9e6a466c2cc`** | **505/505 EXIT 0**, 1025.39s | `verification/v8/research-beta/logs/integration-int13.summary.txt` |
| `deep_v8_int14` | same | **`d88cf62`** | **505/505 EXIT 0**, 997.56s | `verification/v8/research-beta/logs/integration-int14.summary.txt` |

Fabricated OpenRouter. Isolated Postgres `127.0.0.1:55432`. **Not live. Not native. Not HEAD.**

Later SHAs **without** a new 505/505: `2fac564`, `435d1bf`, `487e08f`.

### Other important runs (label SHA)

| What | SHA | Env | Result |
|---|---|---|---|
| Full PG int12 | `6280f95` | `deep_v8_int12` | **501/4/505** — four W05 counterevidence cases expected 1 plugin search, got 2 (Wave 5 extra challenge search). Test then updated. |
| Wave 1 Indiana production continue | after `4e9be2c` | `deep_v8_wave1_port` | 1/1 |
| P0 focused PG | `2fac564` | `deep_v8_p0_rev` | brief-continue 4/4; assumptions revision; A09; gateway HOLD |
| research-core units | various; 291/291 seen around visual | local | green at those SHAs |
| backend units | ~230/230 around P0s | local | green at those SHAs |
| mobile units | `435d1bf` | local | **291/291** twice + typecheck |
| mobile units | uncommitted fieldLabel | local | 10 focused tests green (then reverted to patch) |
| direct-url integration | `487e08f` | `deep_v8_direct` | **1/1 twice**, ~5–7s |
| research-core source-policy unit | `487e08f` | local | 21/21 in `research-beta-intelligence.test.ts` |
| backend typecheck | `487e08f` | local | exit 0 |
| `pnpm verify` | fail-closed tree **before** later commits | see `logs/verify-failclosed.tail.txt` | historical EXIT 0 — **not re-run on 487e08f** |
| extraction | recorded in matrix | frozen | 9 passed / 8 skipped — **historical, not HEAD** |
| hosted GHA | `6cfec73` etc. | GitHub | **not started** (billing lock); owner later declined all GHA |
| Android JS export | older | Expo export | historical; not re-run on HEAD |
| EAS native APK | **`435d1bf`** | EAS `ea81c118` | FINISHED; sha256 `42801ff6…` |
| Physical install | **`435d1bf`** | `10.0.0.167:43417` | `adb install -r` 16:47:32 |
| Physical journey | **`435d1bf`** | fixture 8788 | screenshot matrix v8l; clarification/correction shots **invalid** |

### HEAD `487e08f` has **not** received

- full PostgreSQL integration
- `pnpm verify`
- fresh-DB migrate of the whole suite
- upgrade migrate
- mobile unit re-run (visual 291/291 was `435d1bf`)
- Android JS export
- native rebuild
- physical install of HEAD (APK is one commit behind; HEAD is backend-only)

---

## D. Real research evidence

Cap: **$2.00 / 2,000,000 µ**, identity `research-beta-j12-20260919`, DB `deep_v8_live_j12`. Distinct from frozen SQLite MC-D01. Ledger after J12: **1,070,594 µ**. Unknown holds not retried.

Class: **LIVE** Azure ZDR via OpenRouter (`openrouter-azure-mini-zdr-*`) + public web. Not fixture. Not independent human eval. No matched ChatGPT/Perplexity trials.

| Journey | Class | Useful publication? | Notes |
|---|---|---|---|
| J1 purchase | LIVE | Partial | Cited Aspire 16 AI `b19e0a4a` / run `9fd02f6c`; owned passage supports under-$700 / 16GB. |
| J1 32GB correction | LIVE | Path yes, usefulness no then later paragraph | Child `8a8e8774` published caveat-heavy; later `37a8bb54` a cited local-AI paragraph. |
| J2 Texas | LIVE | Yes-ish | Cited `c41a7795`; not generic “other”; no jurisdiction ask. |
| J3 FOMC | LIVE | Yes | Cited 16 Sep 2026 range. |
| J4 distutils | LIVE | Yes | docs.python.org 3.12 removal. |
| J5 Indiana tax | LIVE | Yes after clarify | IRS Form 941. |
| J6 Pluto/IAU | LIVE | Yes | 24 Aug 2006 press release. |
| J7 | LIVE | same as J1 correction | |
| J8 private doc | **not run** | — | No user attachment. |
| J9 Why not Dell | LIVE router | Router only | `explain`, `mutatesBrief: false`. |
| J10 steer official | LIVE | Yes | US Code `$7.25`; dol.gov + uscode.house.gov only. |
| J11 EV wide/deep | LIVE | **No useful body** | Extract 321-mile / $37,900 supported; writer unpublished restatements / caveat-only. |
| J12 OWASP injection | LIVE | Cited without obeying | Ignore-previous-instructions is a quoted example. |

`live/SUMMARY.json` still contains **early failed** J1–J3 rows with holds; **do not use it as the current live ledger**. Trust `live/LIVE.md` + per-journey JSON.

Same-family model review ≠ independent evaluation.

---

## E. Model governor truth

**This is not a functioning multi-model intelligence system.**

Registered production policies (all **`openai/gpt-4o-mini`** on OpenRouter, different **policy ids / Azure vs OpenAI processor**):

- `openrouter-openai-mini-text-v1` — OpenAI processor, not ZDR
- `openrouter-azure-mini-zdr-text-v1` — Azure ZDR text
- `openrouter-azure-mini-zdr-exact-quote-v2`
- `openrouter-azure-mini-zdr-discovery-v3` (search `maxResults=8`)

`MAX_DEFAULT_FANOUT = 1`. `MAX_ESCALATION_DEPTH = 2` exists in portfolio metadata. **No distinct stronger/benchmarked model is registered.** Quality escalation records `no_registered_higher_tier` / is honestly disabled. Do not claim multi-model adjudication.

Availability failover (429/transient/outage) is **separate** from quality escalation and must stay privacy-compatible. Wave 2 persists fallback under fallback intent; unknown HOLD is not resent.

`cacheSessionId` is **not** passed by the production gateway (FP-020). Token estimator is still bytes/3 (FP-017). Write_report token/timeout policy was raised in token-budget tests (8192 / 120s) relative to brief 4096/45s — **verify in `token-budget.ts` before claiming every operation is specific.** Reserve can still be clamped by legacy `STRUCTURED_CALL_RESERVE_MICRO` (FP-015 OPEN).

Live public-web in this session used Azure ZDR routes, not the OpenAI-processor policy.

---

## F. Retrieval / evidence truth

- **Query planning:** `planTypedQuery` is mostly lexicon/standards + provenance tokens. Private-document-derived terms need exact approval. Not a general semantic reformulator (FP-048).
- **Discovery:** `DEEP_DISCOVERY_CEILING=6`; simple-task early stop; finishing reserve. New Azure `maxResults=8`. Crash reconstructs queries from `search_operations`.
- **Source classes:** `planSourceClass` / `nextSourceClass` / `constrainSourcePlan`. Generic-web must not pivot on the same question after unreadable hits.
- **prefer_primary:** implemented as **exclude non-gov/IGO hosts**, not rank-prefer (FP-040). Heuristic is hostname suffix (FP-041).
- **Trusted/allowed/excluded:** encoded on brief `sourceRestrictions`; applied at **discovered locator** adopt time. Not clearly re-applied on **final redirect** (FP-039).
- **Direct user URLs:** **HEAD `487e08f` fetches them** via `adoptDirectUrls` + source read. `prefer_primary` does not drop an explicit URL; excluded domains still do. Unit + isolated integration 1/1 twice. **Not live-proven. Not in device APK.**
- **Private-document query permission:** digest+term scoped (Wave 3). Residual Gate A fail-closed. Attachment-backed counterevidence may still block categorically (FP-027).
- **Source reading:** `source-read.v1`; concurrent batches of 3. Thrown errors can still reject a whole `Promise.all` (FP-034). Issued-without-finish can pending-loop (FP-035).
- **Redirect/SSRF:** pinned HTTP / SSRF guards exist in `platform/ssrf.ts` and source reader; policy-on-final-URL is the gap.
- **Freshness:** unknown dates are **not** treated as unmet (FP-043). Do not call null-date “fresh.”
- **Independence:** title/snippet origin heuristic (FP-066). UI must not overclaim.
- **Evidence selection/recovery:** `empty-selection-recovery` policy versioned; `prepareEvidenceSelection` when enabled.
- **Candidate completeness:** ledger **is wired** in `processStructuredResearch` (Wave 5). Completeness requires durable `queriesAttempted` + exhaustion stop. **RB-CAND-01 still not a live PASS.** Writer supply of the ledger is not proven as a publication gate here — Codex must read `research-writer.ts` / publication coverage rather than trust this sentence as PASS.
- **Reconciliation:** v2 as in B. First 24 public passages / 8 claims slice remains (FP-061).
- **OCR / JS-rendered sites:** not a Research Beta capability. Scanned PDF/OCR and JS-rendered web are incomplete.

---

## G. Falsification / counterevidence

**Two systems coexist.**

### 1. Run-level `counterevidence_checks` (migration 030)

Unique per `(run, brief_revision, version)`. Historical W05 tests. Required-proof query in `processStructuredResearch` can fail the run if `counterevidence_required_revision` is set and no row exists.

### 2. Per-conclusion `conclusion_challenges` (migration 046, Wave 5)

`executeConclusionChallenges`:

1. `selectConsequentialConclusions` from brief + assertions + support checks.
2. Persist a row per conclusion (`wouldFalsify`, `likelySourceClass`).
3. If `structuredChallengeEnabled` is false → recorded only, no search.
4. If the brief has attachments → state `blocked` (`document_search_requires_public_query_approval`) — no search.
5. Else `counterevidenceSearch` + `performPublicSearch` + bounded concurrent `executeSourceRead`.
6. Re-loads support context (`loadSupportContext`) and runs a **new** `performModelOperation` support assessment including challenge passages.
7. Persists `challenged` / `blocked` / `unknown` with search/model intent ids.

Crash tests: extra plugin search is expected (1–3), must keep original target and a `conclusion_challenges` row.

**Not automatically a publication requirement** unless `counterevidence_required_revision` / coverage rules say so. Unknown/blocked challenges must not be silently treated as “challenged and survived.” Replay skips conclusions already `challenged|blocked|unknown`.

Do not describe this as complete targeted falsification for every consequential claim (partially-supported claims may be skipped — FP-055).

---

## H. Candidate completeness

- Extracted from readable passages + constraints (`extractCandidates` / `mergeCandidateRecords`).
- Persisted via `persistCandidateLedger` (`046`).
- Correction: `reopenExclusions` from `impactForCorrection`.
- Completeness flag must come from durable search coverage + stop proof, not a caller boolean (FP-052 was the overclaim; Wave 5 tightened this — **still not live PASS**).
- Whether the writer receives the ledger and whether publication **forbids** “best/winner/universal” claims when incomplete: **verify in writer/publication code**. Registry still treats RB-CAND-01 as not PASS. Do not invent a PASS.

---

## I. Semantic repair / salvage still present

| Repair | Risk |
|---|---|
| `repairSupportAssessments` | Must **not** invent extract assessments or fill explicit empty evidence (fail-closed checkpoint). Writer-key fill **still exists** if some assessments returned (FP-062 PARTIAL). Can create `supported`. |
| `repairCoverageReview` | Empty questions not invented from zero. **Partial** review can still fill missing questions (FP-063 PARTIAL). |
| Writer heading fallback → generic “Answer” | Still present (FP-069). Semantic. |
| Brief provenance repair | Not applied to strict `openrouter-azure-mini-zdr-text-v1` (fail-closed). |
| Span repair (`resolveModelSpans` / unique quote) | Identity/coordinates; can drop unowned spans. |
| Writer cleanup / `dropUnapprovedWriterClaims` | Drops, should not mint support. |
| `repairPass` on invalid_output | New paid attempt identity; **only if known-cost** (Wave 2). Prompt does **not** receive exact validator errors (FP-070). |

Treat any repair that can mint `supported` as a publication-risk hotspot.

---

## J. Mobile / UI exact state

**Code SHA:** `435d1bf` (visual) + uncommitted fieldLabel patch (not in APK).

**Installed APK SHA:** `435d1bf588847f1c6b887e1b43d3eb29a8c8ccc3`  
EAS `ea81c118-f9d3-4eee-adb0-15b7b40b0136`  
sha256 `42801ff6c63a74f3f7e900246e1bf7b6e61aaad4d9e7312a1c16677c488c4896`  
Install 2026-09-19 16:47:32 on `10.0.0.167:43417`.

| Surface | Code | Unit | Emulator | Physical 435d1bf | iOS |
|---|---|---|---|---|---|
| Docked composer / icons / 44 hit | yes | 291/291 at 435d1bf | no | yes (empty/keyboard) | **no** |
| Keyboard above IME | yes | keyboard-inset tests | no | this capture send visible; FP-085 not closed for all IMEs | no |
| Activity rail | yes | activity tests | no | expanded-activity.png valid | no |
| Editorial report / compact cites / TOC | yes | report-hierarchy | no | completed-report.png | no |
| Source sheet labels | yes | source-sheet tests | no | source-sheet.png valid | no |
| Corrections | code path | lifecycle labels | no | **correction.png invalid** | no |
| Clarification | ResearchBriefCard | tests | no | **clarification.png invalid** | no |
| Library search | yes | library-copy | no | search works; **uppercase kicker** | no |
| Settings | flattened | profile-panel | no | settings.png valid | no |
| Offline | isOfflineError | tests | no | offline-error.png valid | no |
| Large text | allowFontScaling | tests | no | large-text*.png | no |
| Reduced motion | pulse/sheet skip | code | no | **not device-toggled this capture** | no |
| Haptics | `Vibration` 8/16/18/32ms | source inspect | no | **not measured** | no |
| Long-report virtualization | Library FlatList; report still conversation ScrollView | old short-report gfxinfo historical | no | **not remeasured on 435d1bf** | no |

HEAD `487e08f` is **not** on the device.

---

## K. Still incomplete (brutal)

### P0 — correctness / security / privacy / publication

- Full PG + `pnpm verify` **not re-run after `d88cf62`** (HEAD has P0s + UI + direct URL).
- Steering/source-policy still mutates current brief **without revision** (FP-004). Issued identities must stay immutable; Codex should treat this as a real checkpoint bug.
- `prefer_primary` excludes non-gov instead of ranking (product-wrong for “only official” vs “prefer”).
- Freshness unknown treated as satisfied (FP-043) — current-price/legal can stop “fresh.”
- Direct URL: implemented at HEAD, **not live**, **not APK**.
- Writer can still publish caveat-only / drop grounded numbers (J11). Publication quality is a Research Beta abandonment risk.
- Support/coverage repairs can still mint semantic status (FP-062/063 PARTIAL).
- Query Gate A residual; private-doc counterevidence may never run (FP-027).
- Hosted CI owner-declined — cannot claim RB-CI-01 PASS.
- Do not retry/release MC-D01 21,658 µ unknown hold.

### P1 — Research Beta quality / reliability

- Governor is single-tier gpt-4o-mini variants (FP-018/019).
- Intent compiler still local regex/rules; semantic overlay not a production model call (FP-056).
- `planTypedQuery` not authoritative action (FP-048).
- Source policy not reapplied on final redirect (FP-039).
- Thrown source-read errors can fail the batch (FP-034).
- Evidence Needs value is weak/hard-coded (FP-050).
- Candidate completeness not live-proven; writer “best” claims.
- Hierarchical synthesis not default (FP-072).
- Repair prompt lacks validator errors (FP-070).
- Heading salvage (FP-069).
- IME/FP-085 not closed.
- J8 private attachment never supplied.
- Clarification + correction **device shots missing** on 435d1bf.
- Library shouty uppercase (patch only).
- Assumptions card bulky during active research.
- Fixture reports leak `geography=texas` / Sample.
- `iteration<4` and spend snapshot still reset/stale on worker (FP-031/032) even with search reconstruction.
- Reserve clamp FP-015; context in+out FP-016.

### P2 — polish / scale / maintainability

- Token estimator bytes/3; cacheSessionId unwired; no route-health loop.
- URL canonicalization; sequential remaining counterevidence paths; origin heuristic; calculation display; report version semantics; activity `accepted`→`intent_ready` mapping (FP-079).
- App.tsx still ~1610 lines after split.
- No iOS.
- Long-report ScrollView not re-benchmarked.

### P3 — later

- Living Research / monitoring / scenario branches (explicitly next phase).
- Charts, audio overviews, store submission, monetization.
- Distinct frontier model registration/benchmarks.

### What Grok was about to do when interrupted

1. Finish clarification device capture (Library tap was not opening the run — possible persisted pending-state swallowing `onOpen`).
2. Commit fieldLabel uppercase fix and rebuild APK.
3. Re-run full PG twice on HEAD.
4. Live remaining quality (J11 writer) under leftover ~0.93 USD if still authorized.
5. Honest matrix rewrite (STATUS/35_ACCEPTANCE_MATRIX are stale).

---

## L. Known hiccups / recurrences

- Fail-open support/coverage salvage → fail-closed checkpoint; **partial fill remains**.
- Wave 5 extra challenge search broke W05 “1 plugin search” tests (int12 501/4) → tests now allow 1–3 and require `conclusion_challenges` row.
- Model-policy tests hit `provider_key_cap_exhausted` from leftover NULL-scope intents vs 1e6 cap (`3dcd359` / `6280f95`).
- Wholesale Wave 1 merge **rejected** (would revert Wave 3 unclassified fail-close).
- Duplicate logical 042 migrations from A/C — canonicalized; 046 renamed from a clash with Wave 2’s 045.
- Live writer unpublished grounded extract facts (J11).
- `selection_context_mismatch` on first 32GB correction; write-from-prior later.
- Android: IME covering send historically; this 435d1bf capture did not reproduce on that Gboard layout.
- Two adb serials for one phone; reverse must be removed on **both** for offline.
- Typecheck accidentally run on main once; re-run in integration worktree.
- Library `onOpen` appeared not to navigate from a filtered row during last capture — investigate persisted pending flags before assuming a tap-coordinate bug.

---

## M. Acceptance evidence truth

| File | Trust |
|---|---|
| This handoff | **Current** freeze narrative. |
| `ISSUE_REGISTRY.csv` | **Partially stale.** Wave statuses mixed: some FIXED/IMPLEMENTED with SHAs, many still OPEN even after Wave 5 merge (FP-030/049 still OPEN in CSV despite merge notes). FP-042 still OPEN though `487e08f` implements fetch. **Reconcile before using as a todo list.** |
| `35_ACCEPTANCE_MATRIX.csv` | **Stale / overclaimed.** Rows still say visual PASS on older APKs, FP-003 FAIL despite `2fac564`, RB-CAND-01 FAIL despite wiring, live PASS from earlier SHAs. Do not copy PASS onto HEAD. |
| `STATUS.md` / `HANDOFF.md` | **Layered historical notes**, newest at top. Useful chronology; not a single current matrix. Top sections describe `2fac564` / `d88cf62`; they do **not** yet describe `435d1bf`/`487e08f`. |
| `live/LIVE.md` | Best live summary; `SUMMARY.json` is stale early failures. |
| `visual-qa/v8l/NOTES.md` | Honest 435d1bf device review. |
| `visual-qa/v8k` | Older APK `1021057` — historical. |
| `EXTERNAL_BLOCKERS.md` | Stale on APK SHA and some live rows. |

---

## N. External blockers / forbidden claims

- **`main` not merged.** This assignment does not authorize merge until the real matrix is PASS or genuine external blockers only.
- **No GitHub Actions** this freeze (owner: “WE ARE NEVER going to use github actions”). Historical billing lock unused.
- **No iOS proof.**
- **No HEAD native proof.** APK is `435d1bf`.
- **No production deploy, no App Store/Play Store.**
- **No multi-model / quality-escalation claim.** Same `gpt-4o-mini` tier.
- **No competitor superiority.**
- **No retry/release of outcome-unknown financial holds** (MC-D01 21658 µ and any new unknown).
- **J8** needs a real user private attachment; do not invent one.
- Remaining OpenRouter cap after J12 ~ **929,406 µ** if the $2 grant is still considered open; do not infer extra spend from a key merely being present. Confirm authorization before any new live call.

---

## Codex start checklist

1. Work only in `/home/oranolio/Desktop/deep-v8-integration` on `grok-v8/research-beta-integration`. Confirm `git rev-parse HEAD` after pull.
2. Apply or discard `GROK_UNCOMMITTED.patch` deliberately.
3. Re-run full PG twice + `pnpm verify` on **HEAD** before trusting RB-TEST-*.
4. Rebuild APK if UI changes; do not reuse `ea81c118` for HEAD UI claims.
5. Treat ISSUE_REGISTRY OPEN vs IMPLEMENTED as a reconciliation task, not gospel.
6. Do not merge `main`.
