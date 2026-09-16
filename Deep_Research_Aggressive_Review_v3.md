# Deep Research App: skeptical product and engineering review

**Revision 3 reconciliation note — September 16, 2026.** The underlying review below is retained as historical reasoning. The independent review did not establish application readiness or a competitive win. Current execution clarifications and accepted/modified changes are in `docs/PREBUILD_RECONCILIATION.md`. P0 is now an explicit first checkpoint with separate local/live/native gates; local PostgreSQL does not require cloud provisioning; honest blockers are reinforced; notification identity does not promise exactly-once external delivery. F04/F06 are resolved in specification text, not runtime. Original source/complaint observations were not comprehensively reverified in this update; three official push-delivery sources were checked separately.

**September 16, 2026 • Review and revised plan, not an implementation**

## Verdict
**The most consequential weakness is not the stack. It is that the plan promises excellent general research before selecting a narrow task and proving that its research controller reduces the customer’s checking and correction work.** The evidence-first architecture is mostly sound, but the existing documents can lead an agent to build an elaborate, well-described system whose advantage has never been demonstrated.

**The strongest opportunity is constrained technical decisions that can be corrected and revisited without losing the evidence.** Find the decisive eligibility fact, make its support inspectable, and safely update the decision when the user changes an assumption. Treat this as a differentiated implementation hypothesis, not a new category that competitors lack.

**The smallest useful disproof is a paired-task experiment, not a complete agent platform.** Test twelve realistic task families, each followed by a material correction, against the same model/tools under a simple iterative baseline. Independently identify decisive evidence before seeing outputs. If our extra control does not improve correctness or reduce repair—and safe incremental updates do not beat a full rerun—remove the complexity. The seed cases supplied here are drafts, not completed experiments.

## 1. What was actually inspected
The supplied archive has 22 files, including one root AGENTS file, six development-role files, six runtime-role files, four detailed specifications, the master and research leads. The 21 manifest entries match file bytes/hashes, and the standalone master matches the bundled one. The acceptance document defines 70 scenarios; it contains no executable application tests. Full path/hash evidence is in `verification/`.

No app source, API handler, queue implementation, schema migration, package manifest, lockfile, native build or live test receipt is included. Bounded connected GitHub searches did not identify this app; unrelated code matches were not treated as the project. A differently named or inaccessible repository may exist. Therefore no request could be traced through executable code. This is a specification/current-context audit, not a fabricated production audit.

The original master already specifies coverage, evidence passages, source independence, citation checks, cancellation, server jobs, cost bounds, failure recovery, privacy and ablations. Calling all of those “missing” would be dishonest. The useful review question is whether the requirements are concrete, prioritized and testable enough to produce the intended behavior.

The actual document findings are in `docs/CURRENT_STATE_AUDIT.md`, F01–F14. Important corrections include cancellation during the writing phase, candidate-space invalidation after relaxing a constraint, privacy deletion taking precedence over “immutable” old reports, and a truthful registry separating proposed scripts from runnable ones.

## 2. The competitive starting line is higher than the original framing suggests
ChatGPT documents source controls, editable plans and refinement. Gemini documents selected sources, plans and uploads. Claude explicitly describes iterative research. Perplexity’s Advanced Deep Research documentation, modified September 15, 2026, includes mid-run follow-ups, live findings and editable reports. Those are documented alternatives, not demonstrated equal performance (S01–S05).

NotebookLM already combines research with a persistent source workspace, and Elicit is a serious specialist alternative for literature workflows (S07–S09). Grok’s current official page establishes mobile/web search and agent capabilities, but this review could not establish exact present DeepSearch/DeeperSearch entitlement from the public pages; a future matched test needs that account check (S06).

Consequently, “we have agents,” “we can ask follow-ups,” “we have memory,” “we show progress” and “we attach citations” are not strong positioning. Better execution of a valuable workflow could still win. An untested list of similar features cannot establish it.

`research/COMPETITOR_REVIEW.md` records access context and gaps. Exact subscription quotas/prices and latest paid-account output quality were not benchmarked. An official feature page is not evidence of satisfied users. A September page modification is not proof that a feature launched that day.

## 3. What the complaint evidence supports—and does not
The ledger retains eighteen source-level observations. Nine 2026 observations name dedicated research; the remainder are explicitly adjacent-mode, mixed, historical or positive. Most dedicated observations are January–March, so this is not a representative September complaint survey. No post was independently reproduced. Comments within a thread and a blog’s Reddit repost are not counted as independent cases. Exact dates remain unknown when index/relative dates conflict.

### 3.1 A credible-looking citation may not establish the claim
A Perplexity user supplied material for a client-list task and reported that the cited relationships could not be substantiated. That is directly relevant to evidence support, but the user’s theory about cost-cutting or truncated pages is not a verified diagnosis (C01/S10). An author’s scientific-review account and a Claude Code fetch complaint offer adjacent examples of scope/extraction concerns; they must not be relabeled as dedicated Claude Research failures (C12–C13/S21–S22).

The engineering response is not “add more citations.” Separate actual source access, extraction coverage, factual relationship, claim scope and support. First test whether the missing information was ever available to the writer. Then test whether it was interpreted correctly. Gold evidence injection can distinguish those two failure classes.

### 3.2 Failed research can actually be failed delivery
One ChatGPT user reported invisible completed research and then confirmed a mobile-reopen workaround. A support thread describes stuck attempts, while a Gemini paid-plan post describes capacity failure. A Claude empty-output report involved an unusually large requested output, a major confound rather than evidence of universal failure (C02–C05/S11–S14).

These symptoms call for admission, persistence, partial-output and client-reconciliation tests. More intelligent search will not repair a report that exists but is never shown. Nor should blind retries turn an uncertain external outcome into duplicate charges.

### 3.3 Users disagree about the right depth/cost tradeoff
A Gemini user dislikes excessive prose; a Perplexity user wants a lighter frequent research option. Another Perplexity account explicitly praises improved accuracy while objecting to allowance constraints. A historical positive ChatGPT report values long detailed research (C06/C08/C09/C18).

The conclusion is not “make every answer short” or “competitor quality is declining.” Match effort and presentation to the task, preserve requested detail, make the answer inspectable, and measure total user repair. Long output can be useful; repeated generic paragraphs are not depth.

### 3.4 Decisive-source discovery is promising but less directly established by the sample
A mixed-product comparison includes hard archival date/category tasks; an adjacent search account reports returning to conventional search for obscure repository/forum facts. A historical specialist thread describes missing evidence. Those are useful task leads, but they do not prove a current dedicated-mode competitor deficit on our chosen jobs (C10/C11/C17).

This is why the decisive-source feature is an experiment rather than a marketing assertion. Relevant research benchmarks distinguish difficult information discovery from general presentation quality, but no published benchmark result is imported as our own result (S34–S35).

### 3.5 The phone reader itself can destroy value
One Gemini user describes excessive scrolling and lost position while reading research. That is a specific usability problem, not a population estimate (C07/S16). A stable citation sheet and return-to-reading anchor may create more observable customer value than another critic agent. Test it on actual devices.

The causal ledger maps each pattern through plausible causes, discriminating evidence, simpler alternatives, introduced risks and test IDs. Priorities reflect consequence and controllability for the selected jobs, not an invented ranking of global complaint prevalence.

## 4. Focus the initial product
Start with two jobs: **compare technical options under hard constraints**, and **reconcile user-supplied documents with public evidence**. Returning to either after a correction is the important continuing journey, not a separate sprawling product.

For the comparison job, an answer is not useful just because it describes five options. It must distinguish satisfies, violates and unknown for the constraints that matter. A feature could exist in one firmware version but not another; offline viewing may not mean offline editing; a generic price may not apply to the actual region or service scope. These are illustrative task shapes, not claims about named current products.

For document reconciliation, preserve the exact claim and the source section/table it depends on. If the crucial table was not readable, say that before offering a confident conclusion. If two documents differ by date, population or definition, do not present the difference as a contradiction without checking scope.

The current plan’s broad general-purpose vision remains a future ambition. It should not force launch claims about clinical decisions, professional legal research, investment suitability, complete systematic reviews or exhaustive scientific discovery. General exploration can still be offered with stated evidence limits. No demand or willingness-to-pay study has been conducted, so this focus is a plausible product hypothesis, not a proven business.

## 5. Three improvements worth testing
### I1. Decision-blocking gaps with source-type switching
The customer notices that the system finds a decisive fact rather than padding the report with familiar summaries. Implement a gap record explaining which missing fact could change eligibility or the conclusion, the required source class and the attempts already made. The next step might be reading a compatibility table, locating an original study, checking a versioned repository issue or asking for one missing user constraint—not another broad query.

Dependencies are accessible retrieval, stable evidence IDs, task scope and a bounded action policy. Latency/cost could increase or decrease: a targeted primary source may replace several searches, while a dead-end specialist route may be expensive. Measure the actual curve. The hardest failure is a planner that overlooks the real decisive fact and certifies its own incomplete question map.

The smallest experiment compares identical models/tools with and without the gap policy against independent decisive-evidence rubrics. Add gold evidence to both as a diagnostic. The hypothesis survives only if discovery or user repair improves without more critical error. Classification: differentiated implementation, not a claimed invention.

### I2. Corrections that preserve valid work but reopen the right search space
The customer changes a detail and gets a trustworthy update rather than an expensive restart or a stale answer. Persist typed dependency edges among constraints, candidate selection, passages, claims, calculations and report sections. Generate a semantic change report from changed evidence and conclusions.

The missed subtlety is that relaxing a constraint can create candidates that were never considered. Claim-level invalidation alone is not sufficient. The candidate-discovery scope must also depend on relevant constraints. Conversely, a small formatting request should not trigger new research.

The hardest failure is incomplete implicit dependencies. Use conservative recomputation when completeness is unknown; full rerun remains preferable for small tasks where lineage costs more than rereading. A correction or privacy revocation during writing must reject late results with stale revision/consent fences. Classification: differentiated implementation hypothesis. Measure safe update cost/repair against a complete corrected rerun, not against the wrong original answer.

### I3. An answer-first evidence reader that reduces verification work
The customer sees the useful answer, the key unknown and the decisive source passage without scrolling through pages of repeated background. A source sheet returns to the same block; report updates say what changed. The concise view and long report use one canonical claim set rather than two independent generated texts.

This is mostly a useful refinement. It requires good report structure and native interaction work, not a research breakthrough. The hardest failure is hiding caveats in a pleasing summary. Test comprehension, source-check time and reading continuity, not just visual preference. A measured UI improvement remains worth shipping even if the adaptive-controller experiment fails.

## 6. The revised research process
The controller maintains a versioned task brief, explicit hard constraints, answerable questions, a candidate scope where appropriate, source versions, passages, claims, calculations, gaps, contradictions and resources. Models propose bounded actions; code authorizes them.

First preserve intent. Clarify a genuinely consequential ambiguity, but handle reversible assumptions visibly without forcing an interview. Then prioritize blocking facts, inspect likely primary sources, align conflicting evidence, and use a different source class when search saturates. Repeated source families and no coverage improvement trigger reevaluation; they are not a reason to fill a source quota.

Saturation has a configurable starting heuristic, not a pretended mathematically optimal rule. Effort remains bounded by actual route capabilities and remaining finishing resources. A critic is conditional on material uncertainty, not an obligatory extra call after every paragraph.

The stop decision distinguishes supported completion, useful qualified completion, missing input, inaccessible evidence, budget exhaustion, cancellation and failed execution. “I did not find it” cannot become “it does not exist.” A conclusion can remain defensible with a localized uncertainty; the entire report does not need a meaningless uniform confidence score.

Report writing consumes evidence-linked claims, not loose search snippets. Citation checks ask whether the passage supports the specific scoped assertion. Independent source families, dates, exact quantities and reproducible computations matter. Model agreement does not supply missing real-world evidence.

The full state/action/data contract, including typed change propagation and public API semantics, is in `specs/ENGINE_CONTRACTS.md`. This review specifies it; it has not executed an intelligent controller.

## 7. Architecture: retain the foundation, remove premature fragmentation
Keep React Native/Expo, TypeScript, Fastify, PostgreSQL, private storage, an explicit OpenRouter adapter and a durable worker. Keep the phone out of long-running research execution; OS-managed background scheduling is not a persistent server worker (S38–S39). Actual queue/Supabase integration remains a required live technical check.

Simplify the proposed package forest into a mobile app, one backend codebase with API/worker entrypoints, and small contracts/core/design packages containing real code. Backend domain modules own runs, evidence, reports, access and billing. Adapters isolate SDKs. Relational dependency tables are enough initially; no graph database, Kafka or agent platform is justified by the reviewed evidence.

Report publication is an atomic, fenced event. A result can publish only against the current brief, evidence, consent, cancellation and worker-lease basis. A late worker can reconcile allowed receipt/cost metadata without replacing a newer or cancelled result. A provider timeout is not proof that no work occurred; unknown costs remain reserved until reconciled or explicitly handled.

Preserve the distinction between a hosted research baseline and our controlled engine. OpenRouter server tools are beta; full passages, progress, cancellation and costs are capabilities to probe, not fields to fill with invented values (S28). Provider fallback must preserve privacy and capabilities. Upstream queue semantics cannot promise exactly-once external AI execution (S40).

## 8. Resolve the important expert-perspective conflicts
These are one reviewer’s distinct perspectives, not independent expert endorsements.

| Perspective | Strongest objection | Resolution |
|---|---|---|
| Research quality | A focused decision frame might narrow exploration too early | Separate hard requirements from preferences; bounded counterexample/new-candidate search; unresolved evidence stays visible |
| Retrieval | Primary sources may be difficult to access or may not answer the actual user experience | Use source type appropriate to the claim; firsthand complaints for experience, primary documentation for supported features; access limitations explicit |
| Distributed systems | Detailed revision fencing discards expensive late computation | Correctness/privacy outrank sunk cost; safe receipt reconciliation without stale publication |
| Mobile design | More evidence controls make the app a dashboard | Ordinary composer for corrections, one source sheet, answer-first reading, advanced details contextual |
| Evaluation science | A dozen tasks cannot establish general superiority | Treat starter study as falsification/diagnosis; then private heldout tasks, repeats, blinded source-based grading and uncertainty |
| Security/privacy | Persistent evidence and version history make deletion hard | Typed dependencies and tombstones; purge prohibited derived content; disclose limits on user-downloaded copies |
| Reliability/economics | Critics and browser exploration may erase margins | Measure full cost per usable decision; conditional escalation and atomic reservations; keep cheaper full-rerun option for small tasks |
| Impatient customer | The user does not care how elegant the controller is | Measure successful completion, repair time and readability. Ship a useful simple baseline rather than narrating internal agents |

## 9. Prevent AI-generated code from becoming disorganized
The original instructions encourage good conduct but need executable guardrails. The revised root AGENTS is a short map. Scoped instructions cover mobile, backend, core and evaluation. Shared runtime invariants live once, with small role files that do not pretend six services are mandatory.

The application must implement import-direction checks, module write ownership, boundary schema/contract checks, no hidden paid calls in deterministic tests, and review gates for removed regressions or changed prompts. Public types are not hand-copied across the app. A generic utility folder is not a substitute for choosing the domain that owns an invariant.

Every meaningful change should carry one user outcome, affected requirement IDs, migrations/consent/spend impact, tests, exact evidence and rollback. Large diffs or files mixing UI, provider calls and persistence trigger review; arbitrary line-count splitting does not solve ownership. Dependency additions need a concrete reason, not “this framework is advanced.”

Repository documentation has a canonical owner map. Commands are marked actual or proposed. CI artifacts, not an agent’s edited STATUS paragraph, establish verification. A skipped race test, widened error expectation or disabled type rule is a review event, not an automatic fix. Privacy/security/billing checks stay blocking.

This approach is consistent with published short-map and mechanical-boundary engineering practice, but its effectiveness here remains to be tested in the actual repository (S31). Only the review-data validator exists and was tested in this deliverable. No application CI enforcement has been installed.

## 10. Security and economics are part of product quality
The deterministic boundary authorizes every tool and object. Malicious pages cannot send messages, reveal secrets or change spending. Safe network access must handle DNS/IP/redirect cases, not only URL-string filtering. File extraction has bounded resource use. Private documents should not silently become public search queries. These control classes are supported by primary security guidance (S36–S37).

Explicit personal-data processing consent, real processor disclosure, tenant isolation, permission-aware fallbacks, deletion of derived versions/caches and redacted logs are required. OpenRouter privacy/ZDR controls do not automatically describe all separate processors in the pipeline (S29–S30). Store permission/reporting requirements need implementation and current release checks, not a claim of approval from reading their policies (S41–S42).

The economics model includes inference, search, fetch, extraction/OCR, optional browser use, worker/storage/observability and retries. Customer allowance is separate from provider spend. Concurrent workers reserve atomically; unknown paid outcomes are not zero. A provider-managed loop without an enforceable upper bound cannot support an absolute advertised cost cap merely because our app uses a local counter.

No real model costs, plan conversion, retention, user willingness to pay or support burden were measured. Capped allowances are a reasonable starting mechanism, not proof of sustainable margins. Measure cost per usable decision including failed attempts and repair, and keep prototype subsidy separate from production economics.

## 11. Implementation and evaluation sequence
P0 is an honest live end-to-end slice with minimum P4 code guardrails: native question, durable run, real accessible evidence, saved cited report, close/reopen, cancellation and correction. Fixture development is useful but not live verification. P1 adds the gap policy only when diagnostics show retrieval/control weakness. P2 adds correction correctness and selectively proves incremental efficiency. P3 completes native reading/account/release behavior. P4 expands verified quality, cost and operations.

The benchmark starts with paired base/correction tasks. A competent iterative baseline uses the same model/tools. The enhanced controller changes only the tested policy. Incremental update is compared with a full corrected rerun. Gold-evidence injection tests whether retrieval or reasoning is actually limiting the result.

The proposed 25% reduction in median user repair and 30% update-cost reduction are product hurdles, not calibrated facts. Small noisy results are inconclusive. Existing candidate 95% citation-support and 90% consequential-claim-coverage targets must have independent denominators and actual audited samples; they are not achieved here. Zero observed critical failures in finite tests is not zero future risk.

Compare against current dedicated competitor modes only with exact account/plan/date/source context. Consumer internal budgets may be hidden, so distinguish user-facing comparisons from resource-matched experiments. Model judges assist but do not replace source adjudication. Protect gold answers from the generator’s search path; do not rely on a prompt request to avoid leakage (S33–S35).

Every program in IMPLEMENTATION_PLAN.md includes evidence, current status, root-cause hypothesis, architecture changes, alternatives, dependencies, tradeoffs, acceptance IDs, verification, rollout and rollback. This is a ranked plan, not an unlimited backlog.

## 12. What would make this direction wrong?
The underlying model might fail even with perfect evidence. Users might be satisfied with current competitors after learning existing steering controls. The chosen task class may be too infrequent to support a subscription. Dependency-aware updates may cost more than reruns. A third-party hosted research engine may match our outcomes more cheaply. A cleaner reader alone may provide most of the value.

Those are not reasons to give up or add more features defensively. They are reasons to run the defined experiments and remove unsupported complexity. The current evidence supports disciplined prototyping around decisive evidence and repair; it does not support claiming a superior product or a validated business.

## Delivery and unresolved limits
Revised canonical product, architecture, engine, mobile, acceptance, agent and setup files are supplied with complaint/source ledgers, a causal map, ADRs, a ranked plan and draft benchmark seeds. Local artifact checks and the patch-application check are recorded separately in EXECUTION_LEDGER. Their scope is documentation/data correctness.

Remaining inputs: an identified app repository if one exists; project-specific authorized provider/native credentials; realistic consented customer tasks; independently prepared decisive-evidence packets; paid competitor access and actual native trials where required; measured costs/latency/user repair. These gaps did not prevent the review, but they prevent a runtime audit or competitive victory claim.

**Bottom line: keep the sound stack, reduce structural ambition, and make the next proof about a correct, inspectable decision that survives a correction—not about how many agents the app can describe.**
