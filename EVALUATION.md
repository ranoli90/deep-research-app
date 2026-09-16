# Research evaluation and release protocol
Owner role: evaluation lead. Status: protocol and draft task seeds only. **No research benchmark, human study or competitor trial has been run by this review.** Reviewed: 2026-09-16.

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
| G01 | Safety policy | No unauthorized cross-user access, private-to-public query leakage, invalid consent processing or deletion resurrection in required suites | Not run |
| G02 | Engineering requirement | No invented citation IDs, lost accepted runs, duplicate application debit, obsolete revision publication or cancel-while-writing race in required deterministic/integration cases | Not run |
| G03 | Engineering requirement | Native create/close/reopen/read/cite/correct/share/delete flows pass on both platforms and accessible layouts | Not run |
| G04 | Experimental quality target | Original candidate targets: at least 95% audited support precision and 90% consequential-claim coverage, with stated denominators, independently sampled claims and no unaddressed critical fabrication | Unvalidated target; no observations |
| G05 | Experimental product target | Repair reduction/decisive-evidence benefit and incremental-update safety under the registered task protocol | Not run |
| G06 | Engineering/economic requirement | Route privacy/capability probes and measured bounded-cost admission/reconciliation pass; effective processor and tariffs pinned | Not run |
| G07 | Release policy | Actual privacy disclosures, output report flow, purchases/restore/deletion obligations and review access complete under current store rules | Not run |

“Zero observed” in finite tests is not proof of zero future risk. A 95% point estimate from a tiny claim sample is not a 95% guarantee. Report sample sizes, per-task failures and uncertainty. Public superiority language requires a larger relevant evaluation and remains scoped to modes/tasks/dates.

## Operational and ablation suites
Preserve original R/E/J/S/M cases and add the v2 correction/source-discovery/publication/governance cases. Faults include malformed model JSON, unavailable table extraction, hidden source prompt instructions, source disappearance, revoked consent, worker crash, duplicate events, unknown provider outcomes, exhausted reservations and changing assumptions during writing.

Ablations remove one component at a time: gap prioritization, source escalation, critic, parallel branch, dependency reuse or answer-first view. No automatic model substitution across arms. Report the actual quality/cost/latency curve, not a single opaque weighted score.

## Required result bundle
Run manifest with consent and source rights; exact prompts and role/config versions; task/gold/rubric hashes; model/provider/mode/plan/date; retrieved passages and redacted receipts; report versions; actual usage/time; grader identity and adjudication; raw per-task outcomes; analysis script and artifacts; failed/excluded tasks with reasons. Human evaluation recordings require consent and minimal retention. Draft JSON cases in this kit are not that bundle.

## Revision 3 evidence readiness clarification
The twelve public seed families are still `draft_not_validated`. Prepare actual consented JOB-1/JOB-2 tasks and independent decisive-evidence rubrics before treating P1 results as meaningful product evidence; preparation can run alongside P0 when authorized. Paired tasks and gold-evidence diagnostics may expose shortcomings, not establish universal superiority from a small sample. Exploratory results may inform a bounded engineering experiment with disclosed uncertainty, but draft/unevaluated precision or repair percentages must never be represented as achieved results or used to certify production/competitive readiness.

Separate local deterministic P0-D, authorized live P0-L and actual per-platform P0-N evidence. A deterministic stub of a model decision tests controller handling, not the model's real reasoning. Unknown competitor entitlement (including Grok) blocks that comparison only; it does not block implementation of the baseline. Conditional parallelism remains an experiment, not a P0 requirement.
