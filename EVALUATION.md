# Research evaluation and release protocol
Owner role: evaluation lead. Status: protocol, historical **fixture-class** diagnostic harness, and matched production API/worker/extraction controls under `evals/matched-pipeline/`. Model transports in executed local controls are fabricated; real-model paired repetitions and independent adjudication remain unrun. **No competitor trial or human study has been run.** Reviewed: 2026-09-17.

## Main question
Does the controlled system help a person finish a constrained technical decision or document-grounded check with less repair, without worse consequential correctness, than a simpler credible baseline and available dedicated research products?

Do not optimize citation count, source count, word count or self-rated helpfulness. Hard-to-find evidence and whole-report usefulness are different targets (S35). Expert-task rubrics are useful, but evidence contamination and judge bias remain risks (S34). Repeated stochastic trials and realistic tasks matter (S33).

## Smallest useful falsification experiment
Start with twelve **paired task families**: base request plus one consequential correction. `evals/cases/review_seed_cases.json` defines draft shapes, not a validated live dataset. Obtain recent real tasks from users of JOB-1/JOB-2 and have a reviewer inspect the source evidence before finalizing the twelve. Do not call these public seeds held-out, human-curated or already realistic.

For each family create an independent gold packet: exact user constraints; known decisive source(s); necessary distinctions/calculations; admissible alternatives; meaningful uncertainty; acceptable answer conditions; retrieval rights; frozen and live dates. Gold is a reference with uncertainty, not omniscience. A finding outside the packet can be accepted through blinded adjudication.

Arm A: simplest credible iterative controller, same model and tools, normal repeated search, citations and safety checks. Not one deliberately weak search.
Arm B: A plus decision-blocking gaps/source-type switching.
Arm C: B plus dependency-aware correction/refresh, compared against B’s full bounded rerun of the corrected task.

Stage the arms rather than paying for all permutations at once. First ask whether B improves evidence/repair. Test C only on tasks where correction matters. Match actual model/version, prompts except tested components, retrieval access, allowed sources and nominal resource policy. Record actual costs and time, not just nominal caps.

Repeat four preselected difficult families three times for important stochastic behavior. Randomize order within the same day for live comparisons. The sample is exploratory, not sufficient to declare a broad win. When recruiting more users, pre-register a fresh private held-out set and analysis before tuning.

**Diagnostic intervention:** inject the independently inspected decisive evidence into A and B. If both still fail the task, retrieval is not the principal cause; investigate interpretation, calculations or synthesis. If both succeed with gold evidence but B discovers it more reliably unaided, retrieval/control investment has a stronger causal basis.

## User-facing and resource-matched comparisons
Run accessible ChatGPT Deep research, Gemini Deep Research, Claude Research and Perplexity Research on matched tasks under documented plans/modes. Grok belongs only after current relevant mode/entitlement is verified in the account. Use NotebookLM or Elicit only on appropriate source-grounded/specialist jobs; do not punish them for tools outside their intended scope.

Maintain two separate views: comparable customer conditions (actual user plan, interface, constraints) and comparable resource budgets where observable. Consumer products hide internal costs/tools, so perfect budget matching may be impossible. State it. APIs are not the consumer products. Do not compare our research mode to ordinary chat and publish a research victory. Capture run date, settings, selected sources, files, full output, actual latency, failure and limits. No authenticated competitor output was collected here.

## Measurements and adjudication
| Measure | Operational definition |
|---|---|
| Task success | Meets independently written critical requirements, with supported or appropriately inconclusive answer; adjudicated blind where feasible |
| Constraint adherence | Critical constraint violations per task and relevant field; no hidden relaxation |
| Decisive-evidence discovery | Required evidence items found and correctly used, versus the independently inspected task packet; not all URLs |
| Support precision | Audited cited factual claims actually supported by their passages, with scope qualifiers preserved |
| Consequential-claim coverage | All consequential claims, including uncited ones, evaluated for support or explicit inference/uncertainty |
| Numeric correctness | Inputs, denominator, units, dates, formula and output agree with source evidence and deterministic computation |
| Contradiction handling | Real conflicts distinguished from population/date/method differences; unresolved alternatives not erased |
| User repair | Time plus count of user corrections, source checks and full restarts needed to make the answer usable |
| Incremental safety/efficiency | Corrected task reaches same-or-better critical validity; cost/latency/repair relative to full rerun; newly eligible options considered |
| Mobile usability | Time to locate the answer, inspect decisive passage, return to position and challenge a conclusion; accessibility task completion |
| Cost/latency | Measured p50/p95 by task class, failed/cancelled included; cost per usable decision; uncertainty disclosed |

Two blinded reviewers for high-impact disputed items where feasible; disagreements adjudicated with sources. If one model performs all judging, disclose that and do not call it independent human validation. Model graders can locate candidate unsupported claims but cannot be sole factual oracle. Monitor false-positive verifier rejections and missed unsupported claims.

Gold reports/answers must not be in the generator’s retrieval corpus. Block known gold document URLs at the tool layer and test leakage. A prompt asking not to read benchmark answers is inadequate. Keep development cases separate from held-out tasks and version all rubrics.

## Proposed experiment decision rules
These are predeclared product hurdles to test, not calibrated scientific truths:
- B should reduce median user repair by roughly 25% on the chosen jobs or show a clearly useful decisive-evidence gain, without increased critical error. Report pairwise distributions and confidence intervals when sample size supports them.
- C should reduce update cost by roughly 30% or deliver a clear repair/time benefit versus full rerun, with no new critical stale-conclusion or omitted-new-candidate errors in the study.
- A null or noisy small result is inconclusive, not victory. Consistent absence of benefit, extra repair or wrong retained conclusions means simplify/remove the component. Do not change the outcome measure after viewing results to manufacture success.
- Lightweight summary/reader improvement is evaluated separately; a nicer UI can improve use even if controller gains fail.

## Release gates by type
| ID | Type | Proposed gate | Current status |
|---|---|---|---|
| G01 | Safety policy | No unauthorized cross-user access, private-to-public query leakage, invalid consent processing or deletion resurrection in required suites | Passed local PostgreSQL/fixture suite (`apps/backend/test/g01-g02.integration.test.ts`, 4/4 G01 cases). Not hosted RLS/auth. Finite tests are not a zero-risk proof. |
| G02 | Engineering requirement | No invented citation IDs, lost accepted runs, duplicate application debit, obsolete revision publication or cancel-while-writing race in required deterministic/integration cases | Passed local PostgreSQL/fixture suite (5/5 G02 cases in the same file). Fixture/worker path only; not a live-provider race. |
| G03 | Engineering requirement | Native create/close/reopen/read/cite/correct/share/delete flows pass on both platforms and accessible layouts | Historical Android execution2026-09-16 (`verification/g03-android.json`) plus later bounded ExpoGo component receipts. Current complete authenticated research/source/correction/share journey remains unpassed; iOS blocked (no Xcode). Not a current both-platform G03 pass. |
| G04 | Experimental quality target | Original candidate targets: at least 95% audited support precision and 90% consequential-claim coverage, with stated denominators, independently sampled claims and no unaddressed critical fabrication | Unvalidated target; no observations |
| G05 | Experimental product target | Repair reduction/decisive-evidence benefit and incremental-update safety under the registered task protocol | Not run |
| G06 | Engineering/economic requirement | Route privacy/capability probes and measured bounded-cost admission/reconciliation pass; effective processor and tariffs pinned | Local fixture pin + measured C_run passed (`verification/g06-cost.json`). Live OpenRouter invoice/tariff probe not run (no additional spend). Hosted processor unverified. Not a full G06 pass. |
| G07 | Release policy | Actual privacy disclosures, output report flow, purchases/restore/deletion obligations and review access complete under current store rules | In-app privacy disclosure + M10 output reporting passed locally (`verification/g07-output.json`). Purchases/restore/store review remain gated. Not a full G07 pass. |

“Zero observed” in finite tests is not proof of zero future risk. A 95% point estimate from a tiny claim sample is not a 95% guarantee. Report sample sizes, per-task failures and uncertainty. Public superiority language requires a larger relevant evaluation and remains scoped to modes/tasks/dates.

## Operational and ablation suites
Preserve original R/E/J/S/M cases and add the v2 correction/source-discovery/publication/governance cases. Faults include malformed model JSON, unavailable table extraction, hidden source prompt instructions, source disappearance, revoked consent, worker crash, duplicate events, unknown provider outcomes, exhausted reservations and changing assumptions during writing.

Ablations remove one component at a time: gap prioritization, source escalation, critic, parallel branch, dependency reuse or answer-first view. No automatic model substitution across arms. Report the actual quality/cost/latency curve, not a single opaque weighted score.

## Required result bundle
Run manifest with consent and source rights; exact prompts and role/config versions; task/gold/rubric hashes; model/provider/mode/plan/date; retrieved passages and redacted receipts; report versions; actual usage/time; grader identity and adjudication; raw per-task outcomes; analysis script and artifacts; failed/excluded tasks with reasons. Human evaluation recordings require consent and minimal retention. Draft JSON cases in this kit are not that bundle.

## Revision 3 evidence readiness clarification
The twelve public seed families are still `draft_not_validated`. Prepare actual consented JOB-1/JOB-2 tasks and independent decisive-evidence rubrics before treating P1 results as meaningful product evidence; preparation can run alongside P0 when authorized. Paired tasks and gold-evidence diagnostics may expose shortcomings, not establish universal superiority from a small sample. Exploratory results may inform a bounded engineering experiment with disclosed uncertainty, but draft/unevaluated precision or repair percentages must never be represented as achieved results or used to certify production/competitive readiness.

Separate local deterministic P0-D, authorized live P0-L and actual per-platform P0-N evidence. A deterministic stub of a model decision tests controller handling, not the model's real reasoning. Unknown competitor entitlement (including Grok) blocks that comparison only; it does not block implementation of the baseline. Conditional parallelism remains an experiment, not a P0 requirement.


## Historical V6 checkpoint observations

The observations below describe their individual implementation checkpoints, not the latest feature availability. Current implementation/evidence and remaining gates are recorded in STATUS.md and verification/v6/RESULTS.json. Later checkpoints supersede earlier statements that a component is unimplemented; no later local test upgrades fabricated model evidence into semantic quality.

V6 scoped-support execution checkpoint: scoped-support.v1 has deterministic guards and real local PostgreSQL execution/result/replay/deletion tests. The semantic proposal responses in these tests are fabricated transport controls; they do not establish real-model entailment, extraction recall, criterion completeness or research superiority. Pure checks include a paraphrase control and negation, qualification, numeric/unit, scope, snippet, missing-binding and omitted-counterevidence failures. Final core106/backend80/mobile47/governance4 and integration209 counts describe this local scope only. Independent held-out API/worker evaluation, matched baseline/adaptive arms, actual cost/latency and human adjudication remain unrun; keep these separate from fixture/regression passes.

V6 scoped publication checkpoint: 215 local PostgreSQL integration cases include an approved semantic-paraphrase publication/reopen control with stable assertion identity and rejected partial/stale/altered/corrupt/unmapped/forged-approval cases. The final43-case gateway suite additionally checks derivation-label bypass. Semantic verdicts are fabricated transport inputs; these tests establish the publication boundary, not real-model correctness or a completed generic research journey.


V6 generic writer checkpoint: local PostgreSQL223/223 and verify107/80/47/4 pass. Fabricated optimistic semantic responses test final-text guards and localized abstention, not semantic model quality. New prose receives separate claim revisions and premise links; replay, invalid references/expansion, lineage, deletion and checker versions are exercised. No benchmark, human adjudication or paid/native evidence. See verification/v6/RESULTS.json.

Coverage checkpoint: six pure controls and five PostgreSQL cases exercise positive scoped answer coverage, unsupported/missing/mis-scoped evidence, ambiguity, omitted requirements, replay/corruption, stale evidence and deletion. Backend semantic judgments are fabricated, including deliberately optimistic judgments; they establish gating behavior, not real answer quality. Main workflow and independent held-out evaluation remain open.

Final-report coverage controls: completion now requires the executed review of final assertions plus exact canonical report correspondence. Local tests cover complete and incomplete outcomes, invalid review, dropped blocks/claim IDs, corrupted/missing saved review and forged completion at the production publication gate. Semantic responses are fabricated; not live research/evaluation evidence.

Structured worker checkpoint: production processRun executes the same structured services over arbitrary persisted source passages. Positive limited synthesis, failed-unit veto, unavailable evidence, resume and cancellation controls use fabricated provider transport. This proves orchestration boundaries only, not live unfamiliar research, binary API journey, correction quality or benchmark advantage.

Actual binary-document journey: test-generated same-length entity substitution preserves PDF offsets but is not a held-out document corpus. API upload, sandboxed Docling Parse, PostgreSQL, processRun, report/source/library reads and account purge execute real production code. Provider semantic/writer outputs are fabricated. The initial failure exposed an unrelated-qualification false rejection, reproduced in pure core before repair. Recorded trace names evidence class, original digest, cited page/version, support rules and zero paid calls; correction journey remains untested.

Search-transport controls use fabricated HTTP/stream responses and no paid network. They validate bounded parsing, redirect/deadline handling and cost preservation; they do not establish search recall, selected processor behavior, plugin cost ceilings or research quality. Durable discovery and explicit processor policy remain unimplemented.

Durable discovery checkpoint: local PostgreSQL/provider-transport doubles verify engine/provider request pinning, stable replay across evidence changes, no unknown-outcome resend, receipt corruption rejection, concurrent issuance, deletion and old-consent/private-query boundaries. The28658microUSD reservation is a documented policy estimate with no current live invoice proof. Search recall, actual processor behavior, real remaining balance and general worker discovery remain unverified.

W05 runtime-isolation checkpoint: historical integration tests now explicitly import diagnostic-executor.ts; their assertions and prior failure coverage remain intact. They do not establish production research quality. model-gateway.integration.test.ts and document-flow.extraction.test.ts still run the production executor, with actual local database/parser and fabricated model/search transports. The production API/worker transitive import graph excludes the diagnostic executor, fixture adapters/catalog and evaluator gold. This isolation is not W08/W09 matched baseline/adaptive evaluation.

The older fixture-route PDF integration case explicitly uses the diagnostic executor with actual binary extraction; structured upload/search/correction PDF cases use the production executor. Test runtime labels follow the created run route, and assertions are retained.

W05 scope-comparison evidence is deterministic field alignment plus local PostgreSQL/worker controls, not independent semantic comparison or real-model improvement. Tests distinguish opposite proposition wording despite matching scope, absent fields, differing versions/geography/entity/time/population/plan, unrelated criteria, corrupt result/revision, ownership and duplicate execution. Predicate/quantity compatibility is explicitly unassessed. A production refinement control passes a typed comparison into the same generic writer, with fabricated provider responses. Held-out research evaluation remains open.

Scope-context compression control: identical60 assertions yield1770 pairs. Full comparison JSON is1,042,010 bytes and fails existing request capacity; explicit compact format is14,626 bytes, with a43,085-byte complete request. All pairs and field relations are checked against full results, including unrelated-criterion exclusions and null scope. This proves representation size/retention for the registered control, not real-model comprehension, lower paid cost or broad research quality. Larger/different full contexts can still exceed policy. Legacy format and unknown writer replay are checked separately.

## Matched production strategy controls

ADR026 and evals/matched-pipeline/protocol.json define A1/B through identical production API/worker/extraction/support/writer/checker. The local controls use actual synthetic PDF/HTML bytes with fabricated model transports. Both iterate; the corrected B reuses exact source identity while fresh A1 repeats extraction. Eight run traces include unavailable-document failures. Agent-authored expectations are isolated from runtime and are not independent adjudication. The observed HTML B took23.580s versus A1 18.232s despite fewer search calls; this contradicts any automatic latency-benefit claim. Synthetic receipt values19/16microUSD are transport controls, not provider expenditure (actual paid0). Twelve distinct real-document task registration and later authorized semantic evaluation remain separate; no superiority is established.

W08 executable runner (ADR049): `pnpm eval:live` is default-deny unless current explicit operator-recorded user authorization and matching execute/approval/hash arguments are supplied. Credentials and historical ledger balance are insufficient. The evaluator-only runner uses the same authenticated production API, persisted A1/B strategies, worker/parser/tools/writer/checker; only projected original/corrected questions enter generation. It records all selected registered repeat slots, including failures, budget-unrun and unknown outcomes; B snapshot correction is paired with fresh A1 corrected rerun. Stable approval/slot identities prevent a new journal from silently creating fresh retries. Only live-discovery mode is implemented; frozen supplied-document execution explicitly records unrun slots before admission. There is no paid execution or semantic score in the current local control evidence. Actual model repetitions and independent adjudication still require current authority and evidence.

Runner output uses fsynced private JSONL with source/config/policy hashes, owned source/extraction/support/report/reuse traces, exact returned receipts, confirmed versus held exposure and attempt wall time. A provisioned exclusive evaluation database/queue and existing consented account are required; the runner grants no account allowance, consent or schema migration. Account/project/key and unattributed prior liabilities count; unknown outcomes halt later work. Operator attestation and local application arithmetic do not prove provider-side caps or independent user approval. Exported evaluator files are outside server account deletion and require operator-managed retention/deletion.

W09 extraction-control receipts now default to a fresh temporary directory, or explicit `MATCHED_PIPELINE_ARTIFACT_DIR`, and pin current commit/working-tree status plus relevant source hashes. Repeated checks must preserve the committed historical matched-pipeline receipt rather than overwrite it. This changes artifact placement only; assertions and factual evaluation thresholds remain.

Evaluator extraction controls require local test-database CREATE DATABASE permission. Each execution creates and retains a random synthetic database because production accounting intentionally includes all unattributed liabilities; other suites' unknown holds must not be deleted or filtered out to make evaluation green. The database name is printed in the receipt. The first combined execution retained3 failures caused by a pre-existing synthetic unattributed hold; test isolation was repaired without changing production exposure or assertions. Historical matched-pipeline receipts are never overwritten by ordinary reruns.
