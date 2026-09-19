## Wave 5 intelligence — 2026-09-19

Branch `grok-v8/fix-wave5-intelligence`. Base `b30073e`. **Do not merge `main` or integration.** Migration is `046_research_controller_state.sql`.

Confirmed and implemented on the production structured worker:

- FP-030 P1 / FP-049 P1: reconstruct `queries`/`classesAttempted` from durable `search_operations` (query + source_class); persist Evidence Need lifecycle and update one need when coverage changes.
- FP-051 P0 / FP-052 completeness: wire `extractCandidates` + ledger into extraction/discovery/correction; persist on `candidates` + `candidate_ledgers`; completeness from durable `queriesAttempted` + exhaustion stop proof. `remainingDistinctStrategy`/`boundedComplete` cannot stamp `universeComplete`. Relaxed budget reopens exclusions. **RB-CAND-01 remains FAIL** (not claimed PASS).
- FP-053 P0: `conclusion_challenges` keyed by `(run, brief, conclusion_key)`; two consequential conclusions keep independent state. Existing `counterevidence_checks UNIQUE(run,brief,version)` untouched.

Exact tests after FP-052 completeness revision:

- `pnpm --filter @deep/research-core test` — 280/280, exit 0
- `pnpm --filter @deep/backend typecheck` — exit 0
- `vitest run --config vitest.integration.config.ts test/wave5-intelligence.integration.test.ts` — 3/3, exit 0, 46.50s

Rollback: ADR067. No merge to `main`. Full PG twice and live semantic remain separate.

## Fail-closed WIP checkpoint — 2026-09-19

Branch `grok-v8/research-beta-integration`. **Do not merge `main`.** Research Beta is **not** complete.

PostgreSQL on `deep_v8_int9`: **473/7/480**. Units/typecheck green on the repair tree. Remaining worker/search/arithmetic/counterevidence-unknown failures are real. Next: finish those six/seven integration cases, re-run full PG twice, then only merge if the matrix is honest PASS or genuine external blocker (`RB-CI-01`).

## Native APK 1021057 — 2026-09-19

Installed EAS `5f4cd0e7` on `10.0.0.167:43417`. Shots in `verification/v8/research-beta/visual-qa/v8k/`. Do not merge `main`.

## J11/J12 live — 2026-09-19

J12 cited OWASP prompt-injection page without following the attack string. J11 needs a writer that does not add unquoted 300-mile / $45k arithmetic. Caveat-citation unit tests 76 core / 224 backend. Do not merge `main`.

## J10 official-source cited wage report — 2026-09-19

Live J10-e published cited 29 U.S.C. §206 `$7.25 an hour` after official-source steering. Audit `verification/v8/research-beta/live/J10-e-audit.json`. Do not merge `main`. Remaining: GHA owner-declined; Android lockscreen; J8 private attachment.

## Live public-web attempt — 2026-09-19

User authorized the OpenRouter key ($2 public-web). Isolated live DB spent **72,555 µ**. Azure ZDR search found sources and some pages extracted; **no published report**. Hosted Actions still billing-locked; local `verification.yml` steps ran. Do not merge `main`. See `verification/v8/research-beta/live/LIVE.md`.

## Research Beta matrix fill — 2026-09-19

Filled `verification/v8/research-beta/35_ACCEPTANCE_MATRIX.csv` with PASS+artifact or exact external-blocker rows. 2eb385b visual matrix is in `verification/v8/research-beta/visual-qa/`. **Do not merge to `main`.** Research Beta is not declared.

User must:

1. Unlock **GitHub billing** so `verification.yml` can start (latest dispatch `35437540425` on `6cfec73` still billing-locked, 0 steps).
2. Authorize a **new** live public-web OpenRouter cap **≥ $1.20** (recommended **$2.00**) for J1–J12, distinct from $0.40 MC-D01 sqlite-only, **and** release the **21,658 µ** unknown hold.

Then resume live journeys + hosted CI and merge only if those gates PASS.

## Consumer brief card APK 2eb385b — 2026-09-19

EAS `7e4b02c8` installed. Source-sheet cited-in now ellipsizes. Do not merge to `main`. Live J1–J12 and hosted `verification.yml` remain the two user-side blockers.

## Native APK 4a4948e — 2026-09-19

EAS `d2a06da7` installed on `10.0.0.167:43417`. Visual matrix `visual-qa/v8i/`. Do not merge to `main`. Live J1–J12 and hosted `verification.yml` remain the two user-side blockers.

## Hybrid intent compiler v2 — 2026-09-19

Branch `grok-v8/research-beta-integration`. ADR066. `compileResearchIntent` is hybrid (deterministic + structured semantic overlay with exact quote provenance). Do not merge to `main`. Live J1–J12 and hosted `verification.yml` remain the two user-side blockers (new ≥ $1.20 public-web grant + 21,658 µ hold release; GitHub billing unlock).

## Research Beta integration checkpoint — 2026-09-18

Branch `grok-v8/research-beta-integration` HEAD `9c80076`. Full PG 475/475 twice. Device APK `30ceccbe` (`5c3be97`) on `10.0.0.167:43417`. **Do not merge to `main`.**

User must:
1. Authorize a **new** live public-web OpenRouter cap **≥ $1.20** (recommended **$2.00**) for J1–J12 full path, distinct from $0.40 MC-D01 sqlite-only, **and** release the **21,658 µ** unknown hold.
2. Unlock **GitHub billing** so `verification.yml` can start (run `35421735059` still billing-locked).

Then resume live journeys + hosted CI and merge only if those gates PASS.

## Integration merge B — 2026-09-18

Merged current Session B tip `e0b00df` (includes source-date/opening-class continuation beyond kit pin `d100b86`). Main versioned discovery-v3 policy is preserved; B query authorization, freshness persistence, and origin clustering are added. Worker-local ADR062 retrieval is canonicalized as ADR065.

## Integration merge A — 2026-09-18

Merged final Session A tip `8abcffd` onto the C-integrated branch. Cheap-first admission, live leftover, owned grounding, and AGENTS contract from A are in. Main ADR061/062 numbering remains; A/C worker-local ADR061/062 stay ADR063/064.

## Integration merge C — 2026-09-18

Branch `grok-v8/research-beta-integration` starts at current `main` `8a7b1a9` and merges Session C `0a694f9`. Main-only held-intent continuation, discovery-v3, model diagnostics, deletion-race, and source-focus/Android Back remain. Worker-local ADR numbers on C (intent/portfolio as ADR061, Library chrome as ADR062) are canonicalized here as ADR063 and ADR064 so they do not collide with main ADR061/062.

## Subagent implementation checkpoint — 2026-09-18

GitHub main already contains66df545 and all previously outstanding commits. User-authorized subagents completed bounded database authorization batching, exact deletion-race synchronization, mobile source focus/Android Back repairs, redacted schema diagnostics, and immutable Azure discovery-v3 routing. Root added explicit registered continuation for a distinct task while the earlier timeout remains held (ADR061/062). Consent2026-09-18.2 clarifies discovery generation and requires renewal. No new paid call has occurred yet.

Intermediate combined verify passes173core/192backend/216mobile plus configured types/boundaries. Focused actual PostgreSQL:13append/context,3held-intent,6discovery/span/diagnostic cases pass; selected25-passage journey passes unchanged. Prior frozen f12c2fc suite finished456pass/2fail with one unhandled rejection; failures and repairs are preserved. Final frozen combined PostgreSQL and renewed-source verification remain next, not yet passed.

The $0.40 aggregate OpenRouter cap still includes539micro accounted confirmed cost and21658micro retained unknown reserve. Next registered task is MC-D03 using public Python documentation, same account/key/scope, distinct from the timed-out SQLite question. Any new unknown stops the run. Useful real-model report/correction and broader heldout quality remain unproved; W10 native/hosted/release gates stay separate. Rollback disables new continuation/v3 admission while retaining all historical policy readers, privacy/publication checks, receipts and holds.

## Session C visual overhaul — 2026-09-18

Worker branch `grok-v7/product-integration`. No bottom tabs; Library/New research/Settings in the header; searching stream; quiet/send/stop composer; Add sources sheet; empty-home chips; flush-left answer with `[n]` citations. Mobile 259 tests + typecheck. Native rebuild of this SHA is the EAS device APK. Session B not merged.

## Session C continue-thread composer — 2026-09-18

Worker branch `grok-v7/product-integration`. Post-report composer: `Ask anything` + send icon (not Update), New chat pencil (not text link); corrections still via composer. Mobile 259 tests + typecheck pass. Native rebuild separate. Session B not merged.

## Session C follow-up chips — questions above composer — 2026-09-18

Worker branch `grok-v7/product-integration`. Suggested next asks: max 3 above the composer (not under the answer), question copy from unresolved/caveats/limitations, ≤42 label / ≤160 prompt, keyboard-visible, no multi-kilobyte draft dumps. Spec `MOBILE_SCREEN_STATES.md` §8; module `apps/mobile/src/follow-ups.ts`; focused Vitest pass. Session B not merged.

## Session C calm Profile + ADR062 chrome — 2026-09-18

Worker branch `grok-v7/product-integration`. Implemented: no bottom tabs; Menu + Profile → Library full-screen; calm Profile (avatar/account, appearance, privacy, quiet demo switch, sign out). Mobile typecheck + Vitest pass on this tree. Native rebuild not claimed. Wide drawer / swipe polish remain open. Canonical: `specs/MOBILE_SCREEN_STATES.md`, ADR062. Session B not merged.

## Session C Library navigation spec (ADR062) — 2026-09-18

Worker branch `grok-v7/product-integration`. Specified Library without a bottom tab: Menu + Profile → Library; phone full-screen / wide left drawer; row title/status/version/time; search/share/swipe; dark/light tokens; New research vs resume. Chrome landed in the calm-Profile pass above. Canonical: `specs/MOBILE_SCREEN_STATES.md`, `docs/adr/DECISIONS.md` ADR062. Session B not merged.

## Session C engineer review cycle — 2026-09-18

Worker branch `grok-v7/product-integration`. Independent Microsoft-style reviews (correctness, RN, SDET, security, privacy, a11y, Android, state, contracts, reliability, perf, product, adversarial, integration, quality) were applied. Session B remains uncommitted and is not merged. Mobile tests/typecheck pass. Native rebuild of this pass is separate. See `SESSION_HANDOFF.md`.

## Session C design-review craft pass — 2026-09-18

Worker branch `grok-v7/product-integration` (not `main`). Independent design critiques (HIG, motion, type, competitive, density, thinking states, empty state, skeptical user, power shopper, anti-slop, dopamine, follow-ups, a11y, Android QA, brand) were turned into product: continue-composer, numbered citations, collapsed activity, quote-first sources, follow-up chips from the report only. Mobile 236 tests + typecheck pass. This pass is not device-reverified. Session B is not merged. See `SESSION_HANDOFF.md`.

## Session C product integration — 2026-09-18

Worker branch `grok-v7/product-integration` (not `main`). Session A including bounded live-semantic receipts is merged here; Session B is not. Native evidence is an EAS-installed APK against the labeled fixture API. A's live briefs are not product-quality Research Beta. Not App Store/Play ready. See `SESSION_HANDOFF.md`.
## Session A agent contract — 2026-09-18

Root `AGENTS.md` (and scoped backend/core/mobile/evals files) now bind future work to the consumer product bar, applied-not-recorded gates, owned evidence, and finishing independent items instead of listing them.

## Session A intelligence governor — 2026-09-18

Worker branch `grok-v7/intelligence-governor` (not `main`). See `SESSION_HANDOFF.md` for the machine-readable acceptance map. Do not merge this lane; Product/Integration owns integration. Cheap-first admission now stamps new runs and fail-closes when no route is admitted; live reserves keep writing/verification leftover; document-grounded eval uses an owned passage; portfolio migration is `043_model_portfolio.sql`. Bounded live semantic briefs were executed under a current user grant; the freshness unknown hold was not retried. Historical ZDR/unknown-hold evidence on `main` is not relabeled as a pass. No product-quality or routing-superiority claim.
## Session B retrieval/evidence — 2026-09-18

Do not merge this branch to `main`. Session C owns integration. Branch `grok-v7/retrieval-evidence`, worktree `/home/oranolio/Desktop/deep-v7-retrieval`, base `66df5455de86129db0305f3c96dc3dbf1a13b7e3`. Migration is **044** (not 042) so it does not clash with C’s `042_model_portfolio.sql` or A’s `043_model_portfolio.sql`. ADR is **062**. See `SESSION_HANDOFF.md` for files, tests, OSS decisions, rollback and Session C instructions. Private-term approval UX is not built here.

## User-authorized GitHub main checkpoint — 2026-09-18

The user explicitly requested merging all outstanding code into GitHub main and continuing work. All20 commits ahead of origin/main4d818fe belong to this continuation; the older evidence branch is already an ancestor. No deployment workflow is triggered by push (verification is manual-only). This checkpoint includes the actual provider failures and local successes; it is not a release approval or a claim of passing all checks.

The frozen f12c2fc serial PostgreSQL suite is still running. Its partial checkpoint already contains one25-passage test timeout; previous mixed-source/concurrent run had452pass/6fail. Full units/types/boundaries and six actual-parser correction controls pass. Live source-backed report/correction remains unproved. Exact evidence status: verification/v6/zdr-route/RESULTS.json. Continue verification and repair after merge; retain all timeout holds and original receipts.

## Azure route works; exact-quote repair under local verification — 2026-09-18

Runtime634a8c8 made real Azure/OpenRouter requests while preserving ZDR. Registered MC-D01 produced2attempted/4planned steps: A1 returned HTTP200 with a separately retrieved generation receipt for$0.0005388, but failed invalid_exact_span; B timed out without a provider ID. Neither produced a report; correction and full rerun remain unrun. The timeout retains21658micro of provider reserve and the admitted account allowance. Current key remaining is$4.785384 as of17:41UTC; aggregate usage does not settle the unknown request. No further paid call is being issued.

Runtimef12c2fc (ADR060) adds an opt-in immutable v2 policy for resolving unique exact quotation coordinates, followed by unchanged binding/publication checks and an intent-bound audit event. Pure7/7 and focused PostgreSQL20/20 controls pass; complete verification and actual PDF/HTML correction controls are running. The earlier broad PostgreSQL run has two timeout failures, preserved for diagnosis; it is not called green. Original user ZIPs and legacy financial rows remain intact.

Next: finish local verification and inspect the timed-out provider outcome without resending it. A new paid comparison remains gated on that outcome under the registered protocol. W01–W09 research-quality acceptance is incomplete and W10 native/hosted/release gates are separate. Rollback disables new v2/Azure admissions while preserving existing policies, privacy, evidence checks, receipts and all unknown holds.

## Azure ZDR route implementation checkpoint — 2026-09-18

ADR059 implements immutable per-run structured provider policy, explicit Azure ZDR configuration and renewed processor disclosure. Legacy request bytes and correction inheritance are preserved. Local gateway21/21, policy PostgreSQL3/3 and selected actual PDF/HTML correction4/4 controls pass; model transport in these controls is fabricated. Initial unit/type failures are retained under verification/v6/zdr-route. Broad real PostgreSQL verification is running; no Azure live success is claimed yet.

Next executable task: finish verification, reconcile only the three documented completed404 rejections if all explicit evidence conditions hold, then run a fresh registered MC-D01 comparison under the existing $0.40 cap. User monetary authority already exists. Original legacy ledger remains unchanged. Public-discovery routing and W01–W09 semantic acceptance remain incomplete; W10 release gates remain separate. Rollback disables new Azure admission while preserving admitted policy readers, privacy/publication controls, receipts and holds.

## Accounting repair verified; ZDR route incompatibility identified — 2026-09-18

The prior historical-estimate impasse is superseded by ADR058: the user authorized the repair, original financial rows are fingerprint-verified unchanged, and the new explicitly capped evaluation period uses actual current-key capacity without double-counting history. No receipt export from the user is needed to establish this new period. Current source/check artifacts: verification/v6/forward-accounting/RESULTS.json. Final verify166core/168backend/206mobile/6governance/types/boundaries and136real-PostgreSQL gateway controls pass. The actual live comparison was attempted, not passed:1of4registered steps executed and failed before extraction/report;3steps including correction remain unrun.

Three total model requests (one registered step, two separately reserved diagnostic actions) returned404. The captured error identifies account Zero Data Retention policy excluding the pinned OpenAI endpoint. The key's reported usage remains$0.2140772 and remainingquota$4.7859228; no increase is reported. Individual cost receipts are absent, so64974micro of new reservations remain rather than being relabeled as spend or released. The old $5.545 estimates are unchanged. Raw failure traces and the startup-only diagnostic import failure are retained.

Read-only /endpoints/zdr identifies Azure for the same model at the same base tariff. Next concrete implementation is a versioned, disclosed ZDR-compatible route, preserving old run/request/receipt identities, with explicit handling of these known HTTP rejections and a new registered comparison. This is engineering work, not a request to disable privacy settings or obtain another spending approval. No processor, account privacy setting, model prompt, existing report or release authority changed here. W01–W09 remains incomplete; W10 remains separate. No native build, hosted run, deploy or push. Rollback disables new admissions while preserving both ledgers, all receipts/holds and privacy/publication gates.

## ADR058 forward-accounting repair — 2026-09-18

The user authorized fixing the mistaken preflight block. All70 historical OpenRouter intents are confirmed-state on terminal runs in the pre-receipt schema; their individual actual costs remain unknown. Their $5.545 estimates are not new unpaid charges. The original database is unchanged and fingerprinted. The authorized new $0.40 evaluation period has its own local account/ledger, with no old action resend or hold release. Provider quota is checked from the actual project key before evaluation and each step; existing active-ledger unknown/same-key reservation gates are unchanged. Details: ADR058 and verification/v6/forward-accounting/SETUP.json. This supersedes the prior operator impasse; no new user permission is needed.

Thirteen quota regressions and sixteen existing evaluator unit controls pass; backend typecheck and both metadata validators pass. The real registered MC-D01 comparison is prepared but not yet executed at this checkpoint. Runtime/publication quality remains unproved until its actual receipts/results are recorded. Rollback disables new evaluation while preserving both ledgers and every receipt/hold; no key, private token, deployment or release authority is added.

## Blocked checkpoint — 2026-09-18

Goal remains incomplete. Three consecutive turns retained the same financial-provenance blocker after explicit spending authorization. The latest read-only check on709fb2d7df28bbf28649a117d69a856a06caa41b confirms unchanged legacy OpenRouter estimates; see verification/v6/paid-readiness/PROJECT_ROUTE_RECHECK.json. No current process is being awaited, no generation was sent, no hold released and no old action resent. The first two turns completed independent clean-checkout verification and canonical-plan reconciliation; further status/fixture repetition does not prove the missing real-model journey.

Resume input: the location of the project ledger or provider receipt export that reconciles the historical entries, without credentials in chat. The $0.40 initial registered comparison already has user authority; do not ask for that permission again. Next executable work is provenance reconciliation followed by MC-D01 through the registered production API/worker baseline/adaptive original/correction/full-rerun evaluator, retaining every failure and actual cost. Broader unfamiliar-task and live-discovery evidence remains required afterward. W10 hosted/native/release gates remain distinct. This checkpoint does not claim all W01–W09 acceptance is satisfied. Existing runtime/source, unknown holds, rollback controls and three user ZIPs are preserved.

## Current paid-test authorization and clean checkout — 2026-09-18

The user explicitly authorized OpenRouter spending in this session. The first registered MC-D01 public saved-SQLite original/correction/full-rerun comparison is capped by the operator at $0.40; further monetary permission is not required for that cap. This supersedes earlier statements that current spending authorization was absent. No paid generation has occurred in this continuation; new confirmed cost is $0.

Financial provenance remains unresolved, separately from authorization. A fresh read-only key check at16:33:44UTC still reports a $5 key limit and $4.7859228 remaining. Legacy route inspection confirms real OpenRouter route names:12 original planner intents and58 web intents, all historically labeled confirmed, but56 lack confirmed amounts and retain $5.545 in estimates. The old adapter discarded provider generation IDs and used reserve values as cost, so neither state labels nor these estimates prove actual receipts. No hold was released, old action resent, database migrated or key limit changed. A ledger/receipt location was requested; credentials were not requested. Evidence and authorization: `verification/v6/paid-readiness/`.

Exact detached commit672586baca8f3416ee6aa2fd47b16f630dde9805 passes offline frozen ignore-scripts install and `pnpm verify`:166core/149backend/206mobile/6governance, configured types and boundaries. Final checkout is clean. See `verification/v6/clean-recovery/RESULTS.json`. No new native/hosted/semantic evidence follows. W01–W09 remains incomplete; W10 remains separate. Next task: resolve historical financial provenance without discarding unknowns, then execute the already-authorized registered comparison. Rollback preserves all reservations, receipts, evidence/publication gates and deletion controls.

## ADR057 verified checkpoint — 2026-09-18

Runtime `abdfee1ee623b563a0164def7e73ff94fb56d4f6` adds bounded empty-context recovery after the verified inventory support veto. Final PostgreSQL451/451 across32files, actual isolated extraction51/51, verify166core/149backend/206mobile/6governance/types/boundaries and metadata checks pass. Exact receipts, preserved failures, source hashes and original/correction traces: `verification/v6/bounded-recovery/RESULTS.json` and `HANDOFF.md`. The fresh regression now reaches decisive initially omitted evidence and replays without repeated extraction. Legacy policy, four-iteration limit, unknown holds and publication veto stay enforced.

The W01–W09 research-quality milestone remains incomplete. Across four official-document controls, executed contexts now include all8 previously inspected reference spans (0misses versus3before); fabricated model transport still yields no assertions/no report, not semantic quality or fresh heldout success. No paid generation, new native build, hosted execution, deployment or push.

Current financial preflight is gated: read-only project-key metadata reports limit$5 and remaining key quota$4.7859228 as of2026-09-18T16:14:01UTC, which is not user authority or account credit balance. Configured local project ledger lacks key/receipt attribution:56 unconfirmed OpenRouter intents hold$5.545 in estimates; its$2.80 reported confirmed amount is not receipt-verified. All legacy data/holds are unchanged. The current ledger/allowance clarification is pending; do not bypass liabilities with a fresh database or treat elapsed time as approval. Next concrete task is establish financial provenance and current authorization, then run the smallest registered real-model original/correction/full-rerun comparison. Broader OCR/layout and W10 native/hosted/release gates remain separate. Rollback retains admitted recovery/selection policies, immutable proofs, inventory veto, deletion/fences, provider identities and unknown holds.

## ADR055/ADR056 verified checkpoint — 2026-09-18

Runtime `f0640db7e12d24d96e3ad4eb3334e058c83d523b` adds bounded immutable evidence selection and a separate full-inventory deterministic support veto. Final PostgreSQL446/446 across32files, real isolated extraction51/51, verify164core/149backend/206mobile/6governance/types/boundaries, and committed contradiction probe all pass. Exact commands, elapsed times, source hashes, original failures and source/correction traces: `verification/v6/evidence-selection/INVENTORY_RESULTS.json` and `HANDOFF.md`. Earlier selector baseline443passes did not prove safety: its omitted-contradiction probe failed, and that failure remains preserved separately.

The W01–W09 milestone is still incomplete. Real saved-document reference diagnostic retains3/8 omitted spans; fabricated semantic transports produce no useful report for those official questions. No live model spend/current allowance, new native build, hosted evidence, deployment or push. Next independent implementation: bounded replay-safe recovery after an empty selected-context extraction, preserving whole evidence, immutable paid identities and the inventory veto. Real-model quality/correction/full-rerun comparison requires current project monetary authority; broader OCR/layout and W10 gates stay separate. Rollback suspends new admissions while retaining existing proof/obligation readers, inventory support, ownership/deletion/fences and unknown holds.

## Current continuation — ADR055

**Publication blocker reproduced:** OMITTED_CONTRADICTION.json shows that large neighboring passages exclude a known contradiction and allow the positive limited report, while the small control withholds it. This behavior is not accepted. A versioned inventory-support gate must downgrade writer/calculation/coverage/publication eligibility independently of the model context; raw probe evidence and planned implementation are retained.

Base `3f22f5b3cd96b85fc78c1843fc9feb1bcb367562`, branch `codex/v6-saved-html`. Bounded whole-passage selection is implemented through production extraction/support/writing/publication. Migration038 preserves legacy policy for existing runs and stamps only new runs. Exact inventory metadata uses block positions and full-locator hashes (PDF geometry is not duplicated). Model-input.v5 binds selection proof; current publication requires omission warnings. Missing/corrupt proof terminalizes without reissuing a model action. Source/account deletion purges inventory; rollback must retain admitted policies, proof/obligation readers, deletion and unknown financial holds.

Final broad checks are pending at this source checkpoint. Prior focused failures are retained: old oversize worker expectations now receive qualified reports; direct executable oversize negatives remain. The new correction control initially hit correction_rediscovery_disabled; fixing its configuration restores the safety-required discovery path and the revised negative underwater statement with25 actual reused passages. A test callback implicit-any caused one verify failure and was typed. Official ESP32's old expected capacity failure now becomes no_relevant_assertions under fabricated transport:23/78 selected passages, no report or semantic pass. One metadata review removed duplicated PDF geometry text from the inventory in favor of a full-locator digest; ranking was not tuned to official reference answers.

Next executable work: final full PostgreSQL and actual parser/evaluation checks, exact artifact/commit handoff, then measured semantic recall/answer failures. The W01–W09 milestone remains incomplete; live monetary authorization is unproven and paid execution stays gated. No new native build, hosted execution, deployment or push. Preserve all three user ZIPs and existing evidence. Canonical behavior: ADR055 and ENGINE_CONTRACTS; change packet: specs/features/evidence-selection/.

## Previous continuation — ADR054

Runtime commit `643e20358c5d05a0480e701215f5f1df7963d68c`; strengthened numeric regression `47c3c1a53e637cd83b08e04e1c8d756095dc48d4`. Current branch `codex/v6-saved-html`, base `4d818feb1dcf8808b38c980ac2f2f204977e2d7b` (merged main). The W01–W09 milestone remains incomplete. Saved UTF-8 HTML now enters authenticated binary upload, isolated extraction and registered frozen evaluation using the existing production worker/writer/checker. Structure-v4 fixes reproduced unlabelled UTF-8 corruption; old receipts remain readable and immutable. See `verification/v6/current-continuation/` for exact commands, failures, traces and final results as recorded. No new mobile picker/native build, paid model call, deployment or push.

Final full PostgreSQL425/425 across31files443.46s, real extraction51/51, verify157/149/206/6/types/boundaries and backendtypes after the test repair all pass. The initial full PostgreSQL timeout (423pass/1fail) and second full UUID assertion failure (424pass/1fail) are preserved. Unchanged capacity recheck6/6 and forcedUUID before/after reproduction establish their separate scope. No production publication guard or timeout changed. Do not silently erase the first failed run or infer a general performance repair. Real-model semantic scoring and independent adjudication remain gated; large-context/OCR and broader native/hosted controls remain unfinished. Preserve all three untracked ZIPs. Staged identical V6 input: `/tmp/deep-v6-evidence-staging`.

Rollback disables new HTML admission/evaluation while preserving admitted bytes, old/new proof readers, source membership, deletion, publication fences, receipt reconciliation and unknown holds. Never substitute ready notes, fixture reports or unsandboxed extraction. Exact current terminal evidence and next work are recorded in STATUS and verification/v6/current-continuation/HANDOFF.md, RESULTS.json and JOURNEY_SUMMARY.json. Next independent work is bounded large-document evidence selection with explicit omission/qualification controls; real-model paid evaluation requires a current scoped authorization.

## Historical checkpoint record (superseded by the continuation above)

The W01–W09 goal remains active and incomplete. Preserve the existing app, unrelated changes and both untracked user ZIPs. No push/deployment/hosted migration/public exposure or paid provider calls; current allowance unknown. STATUS.md owns current scope, EXECUTION_LEDGER.md and evidence packets preserve history.

## Current checkpoint

Branch `codex/v6-evidence-milestone`; latest implementation `d19de6bb277be24b87f7b09324698e3a058ff60e` adds frozen-PDF evaluation, strict failure traces and8MiB durable storage. Prior659c335 fixes native-found deletion requests and terminal progress. Prior ce2f889 adds recoverable document corrections, gated evaluation and remote source invalidation. Prior0602f96 adds authenticated settings preflight before private uploads while preserving retry identity and Check/Withdraw. Backend checkpoint `b15c3d85a9fe9911db2323dba5de3a369359591d` adds bounded128 whole-passage capacity and HTML structure-v3. Prior commits retain source deletion, protected content, requested verification, typed corruption handling, exact-span corrections/rediscovery, lease/cancellation fixes and dependency repairs. No broad redesign or fixture fallback.

Original review pin03fab6b9d6a04ce9fdaeb48636383757213f7242; kit /tmp/deep-v6-staging. Check actual git status before editing. Current implementation ce2f889253185455ec1cef5dc85920e10ce3b816 integrates append-owned-document corrections, dedicated mobile recovery, the gated registered evaluator and remote source invalidation. Prior0602 clean proof is historical. Agents must not independently commit. DB suites have finished; no concurrent truncating suites.

## Terminal evidence and limits

Latest working-tree packet `document-evaluation-integrated/`:422/422 PostgreSQL (439.79s),39/39 actual extraction/API (114.57s), verify157core/132backend/186mobile/6governance, mobile/backendtypes and651module2.21MB Android JS export all exit0. Exact-ce2f889 clean proof covers the final account-panel reset: offline frozen ignore-scripts install, verify157/132/186/6, mobiletypes and651module2.21MB JS export all pass, final status clean (`clean-document-evaluation/`). Retained first extraction run36passed/3failed correctly encountered an older unattributed synthetic hold; fresh dedicated evaluator test database repairs isolation without deleting liabilities or weakening accounting/assertions. Default evaluator exits2 with no paid effect; that historical checkpoint supports live discovery only; current frozen-PDF changes are described below. No semantic scoring is claimed.

Backend407/407 real local PostgreSQL integration (457.80s),33/33 actual extraction/API (87.54s), verify155core/117backend/136mobile/6governance, types/boundaries all pass (`capacity-formatting-integrated/`). Later mobile-only preflight148/148/types/648module2.18MB JS export pass (`admission-preflight-integrated/`). Actual local authenticated API preflight probe passes separately with zero provider intents. Wrong-endpoint mock proof was rejected, preserved and corrected before integration. Exact0602f96 clean proof passes frozen offline install, verify155/117/148/6, types/boundaries and648module2.18MB JS export, ending clean (`clean-final-internal/`). Hosted CI not dispatched.

All provider responses in those suites are fabricated. Actual SQLite HTMLv3 parser/serialization retains75wholeblocks, network-filesystem restriction and single-writer limitation for original/corrected contexts; no support/model answer was executed. Synthetic platform correction/full rerun agrees on explicit facts with1newread+1reuse versus2newreads, both8attempts/10synthetic micro-units. Frozen12task/13document corpus retains original omission/sloweradaptive failures; no independent semantic or superiority claim. See STATUS for trace details and artifact paths.

Node20.20.2,pnpm9.15.9,Python3.12.3,TypeScript5.9.3,Vitest4.1.11. LocalPG127.0.0.1:55432; latest full suite used deep_research_final_internal_v6_20260917; evaluator controls retain deep_eval_control_111e23a655c249b3afb1c94215f458e5. Prior isolated databases preserved. Do not erase standard deep_research_test retained synthetic liability. Native database deep_research_native_v6 is separate. Extraction runtime /tmp/deep-v6-extraction-runtime. Run DB suites serially; no repeated broad suite unless source/risk justifies it.

Audit remains exit1 with0moderate/2high image-size findings. PostCSS/Vitest/UUID repairs committed; Metro0.83.8 exceeds current Expo pins and remains experimental. Actual Xcode UUID roundtrip and candidate iOS prebuild pass; neither is native runtime proof. JS exports are not signed/native builds. Current design typecheck is unsuppressed.

## Device and external gates

Last authorized device10.0.0.167:43417, REDMI Note15 5G Android16 ExpoGo54.0.8; locked. Standalone app.deepresearch.mobile remains old. User already asked once to unlock. Latest synthetic server account/content deleted, API/Metro/reverses stopped. That historical cleanup gate is now resolved by the physical-unlocked follow-up below; global Expo data was never cleared. Earlier component evidence is not full current native acceptance. A reused agent issued stale device commands; stopped and preserved in stale-agent-device-attempt/. Do not resume it for device work blindly.

Remaining external evidence: broader physical/iOS/hosted-auth native lifecycle, reconnect and accessibility; paid real-model held-out repetitions and independent adjudication; provider invoices/bounds/retention; hosted identity and W10 signed/release gates. Do not infer authorization from credentials or historical balance.

## Next executable steps and rollback

1. Read final-scope-review/closure-recheck.json and current evidence before choosing further work; exact-ce2f889 clean proof is complete. No repeat DB suite without new source/risk.
2. Preserve this local checkpoint and its failures. Current paid model evaluation needs a new explicit budget/scope; no push, hostedCI dispatch or deployment authority.
3. After device unlock, perform guarded cleanup before native acceptance. Real-model evaluation requires current paid authority; hosted/release remains separate.

Rollback disables new scheduling while retaining immutable128-passage proof readers, HTMLv1/v2/v3 receipts, ownership/tombstones, required markers, publication vetoes, deletion, financial settlement and unknown holds. No fixture fallback or erased admitted obligation. No background continuation after execution stops.

2026-09-18 native graph follow-up on exactce2f889: isolated Android prebuild and actual Gradle releaseRuntimeClasspath resolution pass (Gradle8.14.3,12m25s). Selected CommonsIO2.6,Codec1.10,OkHttp4.9.2,Okio2.9.0,annotation1.8.1,biometric1.1.0,React/Hermes0.81.4. Apache CVE-2024-47554 affects selectedIO2.6 through XmlStreamReader; reachability is not established and no clean native-security claim follows. Official source https://commons.apache.org/proper/commons-io/security.html checked2026-09-18. Prior ADR024 unresolved-resolution statement is historical; actual graph is now inspected. No app compilation/APK/device install/release. Root source/dependencies unchanged. Local Gradle and NDK27.1.12297006 were downloaded under the existing SDK license. Evidence verification/v6/native-graph-current/RESULTS.json. Native compatibility/remediation and current device journey remain open.

Current standalone release graph is inspected; next native dependency work must evaluate compatibility/remediation, not repeat declaration-only inspection. No current paid or release authority.


2026-09-18 native follow-up (`verification/v6/native-current-emulator/`): actual x86_64 Android debug compilation passes on isolated ce2f889 after installing the missing JDK (first failure retained). APK SHA256 `334eef0bb20ae75ba049e0f40b8e12b5adbf4fe3dea3b3f650b515cf20b30306`, Android test debug key, not release signing. Android14 emulator runs the current workspace through Metro and development identity. Actual API/worker/isolated PDF parsing plus fabricated model transport complete report→page/geometry source→cold reopen→full-question correction→added-PDF revision→owned Markdown share preview (cancelled). Three related runs,21 fabricated confirmed calls,zero paid/unknown calls; admission-to-publication9.517/2.963/11.516s are synthetic-control timing, not live quality/latency. Original source versions/digests are reused; added PDF bytes have their own parsed source. Native tests found and repaired empty-JSON DELETE requests and false WRITING progress on invalidated terminal runs. Actual retry purges the source/dependent report; corrected cold restart shows unavailable content without a spinner. Account deletion purges report/evidence content; a second account sees empty Library; logout/cold restart clears its composer. Larger-text130% control is bounded, not screen-reader acceptance. Initial bulk ADB input truncated (cause unverified); complete correction text was checked before submission. The startup System UI ANR, regression/type failures and cleanup failures remain. API SIGTERM exited143 before cleanup; exact owned second-account teardown succeeds. Final native DB has0activeaccounts,0attachmentcontent,0unconfirmedintents;10redacted/historical runs retained. Emulator/API/Metro and emulator reverses stopped, synthetic Downloads removed; physical phone untouched. These source fixes are committed in659c335; the APK dependency graph remains ce2f889 and its Metro runtime exercised those fixes.

Frozen supplied-PDF evaluation is now integrated in the working tree (ADR052), with owned binary uploads, actual parsing, exact digest traces and expiry checks around awaited uploads. Unsupported HTML slots remain explicitly unrun with their denominators retained. Paid model evaluation and independent adjudication remain separately gated.

Exact native-fix implementation `659c335cacc4762983661a7dfa52ce9a64f642a4` passes clean detached frozen offline install, verify157core/136backend/200mobile/6governance/types/boundaries, mobiletypes and651module2.21MB JSexport (5274ms), final checkout clean (`clean-native-fixes/RESULTS.json`). No DB/native/paid rerun. Raw evidence whitespace check remains exit2 for preserved terminal logs/PDF bytes; source/canonical-doc whitespace check passes. Milestone incomplete; the subsequent frozen-PDF evaluator integration is described below.

Frozen-PDF implementation committed as `d19de6bb277be24b87f7b09324698e3a058ff60e`: full local PostgreSQL integration424/424 in401.33s and verify157core/142backend/200mobile/6governance pass. Final actual extraction/API suite passes47/47 across8files in136.65s after the review-found evaluator failure-trace repair; final backend types pass. Artifacts: frozen-pdf-integrated/RESULTS.json. ADR051 retains admitted artifacts up to8MiB, matching existing upload admission; public-fetch1.5MB cap unchanged. ADR052 uses digest-pinned owned PDF uploads through the same API/worker/parser/writer/checker, durable per-upload journal and expiry checks. Official RFC9112/TMP117/ESP32 yield46/50/78actual passages but no useful report with fabricated transport: two no-relevant-assertions outcomes and one model-context-exceeds-policy. This is retained failure evidence, not semantic success. Unsupported frozenHTML, OCR/complex layout and larger-context capacity remain explicit local limitations, distinct from paid/human/hosted gates. Rollback disables new evaluation/uploads while preserving admitted8MiB artifacts, immutable proofs, deletion, financial settlement and unknown holds.

Exact frozen-PDF implementation `d19de6bb277be24b87f7b09324698e3a058ff60e` passes clean detached offline frozen ignore-scripts install and verify157core/142backend/200mobile/6governance/configuredtypes/boundaries, finalgitstatusclean (`clean-frozen-pdf/RESULTS.json`). No repeat native/export/DB/paid execution. Current local implementation/checkpoint work is complete; overall semantic milestone remains incomplete. Next requires a current bounded paid evaluation authorization and independent adjudication; broader physical/accessibility/hosted gates remain separate. UnsupportedHTML/OCR/large-context limits remain explicit local partial capabilities, not disguised external gates.

2026-09-18 unlocked physical follow-up (ADR053, verification/v6/physical-unlocked/): current Expo Go workspace on authorized REDMI Android16 completes actual synthetic PDF→report→page/geometry source→cold reopen→firmware correction with immutable reuse→cancelled native share preview→source/dependent-report deletion→account deletion→second-account emptyLibrary→draft/logout/cold cleanup.14fabricated confirmed calls,14syntheticmicro,paid0,unknown0; no semantic-quality claim or standalone APK update. Initial expired-session cleanup stranded readiness;5failed regressions then repair, final native expired-session direct sign-in passes. Invalidated refresh retained stale offline flag; separate reproduced regression repaired; corrected invalidated native retry unrun. Final206mobile tests/types/6focused pass. Previous pending old-account cleanup is resolved: no credentials/reports/drafts/journals remain.3testaccounts deleted,0active/0attachmentcontent/0unconfirmedintents,12redacted historical runs retained. SyntheticPDF/tempfiles removed; APIexit0/Metro/reverses stopped. No phone settings changed. Screen-reader/rotation/iOS/currentstandalone and hosted/paid semantic gates remain separate. Rollback retains fail-closed cleanup and generation/privacy/financial gates.

Physical phone fixes and evidence committed as `7fb6d387040edf57bb4694e488b62f4ff1cc0156`. User subsequently authorized pushing and merging all implementation work to GitHub main; this does not authorize deployment, paid model calls or hosted provisioning. Both userZIPs remain intact and untracked.

2026-09-18 W09 canonical-plan reconciliation: IMPLEMENTATION_PLAN.md still claimed no application existed, named the retired diagnostic controller as the live default, and labeled implemented correction/mobile/evaluation foundations unimplemented. Reconciled those statuses and the active W01–W09 execution order in the canonical plan; retained P0–P4 requirements and separated W10. No runtime or publication/budget policy changed. Both document validators exit0; evidence verification/v6/plan-reconciliation/RESULTS.json. This does not complete the milestone or resolve financial provenance. Rollback is documentation-only; do not restore diagnostic production routing.
