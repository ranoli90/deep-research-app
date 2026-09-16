# Complaint → causal diagnosis → test
Reviewed: 2026-09-16. These are hypotheses informed by published observations, not diagnoses of proprietary systems. The CSV carries dates, modes, plan/platform context, alternatives and uncertainty.

## Evidence strength and ranking basis
Eighteen retained observations include nine 2026 accounts naming dedicated research, three adjacent-mode reports, three mixed comparisons/usage reports, two historical problem leads and one historical positive. Those nine are not nine reproduced bugs: they include preferences and positive/negative quality-allowance tradeoffs. Most dedicated reports are January–March, not a September representative sample.

Rank below by consequence and controllability for JOB-1/JOB-2, then independent recurrence of the general failure pattern. Do not call this population prevalence or the largest complaints across all users. Source-selection bias, inaccessible output traces, unmatched plans and changing features remain important.

## D1 — the cited source does not establish the decision-critical claim
Evidence: C01 dedicated; C12 adjacent corroboration of scope/entailment error; C13 adjacent extraction warning. Serious because a plausible cited assertion can drive an invalid choice. The actual report/citation content was not independently reproduced.

Task -> extract a particular relation or support a particular proposition. Failure -> plausible claim with topic-related or insufficient evidence. Causes -> extraction omitted material, relationship conflation, date/population mismatch, unsupported synthesis or verification miss.
Distinguishing experiment -> capture permitted fetched text and extraction coverage, compare exact passage to claim, then repeat with gold passages. If gold remains misinterpreted, retrieval is not the main fix.
Response -> inspectable passage and claim-local support status. Change -> claim/evidence scoped links, materiality, extraction access level and a bounded verifier. Simpler alternative -> make the initial task/extraction complete and avoid synthesizing facts not requested.
New failure -> verifier false negatives can suppress correct nuanced inferences. Test/criteria -> original E cases, V2-01/03/19, independent critical-claim coverage; record false positives and user repair. Program P1; high severity, medium causal confidence.

## D2 — research completes but does not become a usable result
Evidence: C02/C03 ChatGPT, C04 Gemini capacity, C05 Claude empty output with a major overlarge-output confound. These show superficially similar symptoms but not one shared cause.

Task -> receive an accepted research artifact. Failure -> invisible/stuck/empty result. Causes -> capacity/admission, account state, client stream, report publication, provider failure or unrealistic requested artifact size.
Distinguishing experiment -> instrument admission ID, persisted stage, provider outcome, report row and client snapshot. Disconnect/reopen and request an oversized report. A visible server report with no client display falsifies a pure model-quality diagnosis.
Response -> state what happened, preserved work and next action; constrain admitted scope. Change -> durable state, outbox, snapshot replay, bounded output, cancellation and partial publication. Simpler alternative -> correct a reader/reconnect bug before adding orchestration.
New failure -> retries cause double spend/duplicate versions. Test -> J-group, V2-07/08/14; no duplicate debit/stale publication in fault suite. Program P0; high requirement confidence, unknown vendor root causes.

## D3 — output depth and cost do not match the job
Evidence: C06 verbosity; C08 wants more frequent lighter research; C09 reports better accuracy alongside allowance dissatisfaction. C18 historical positive values long detail. Do not claim all users want shorter outputs or that quality is universally worsening.

Task -> get enough evidence for a decision within practical attention/allowance. Causes -> task intent missing, generic report template, effort policy or actual subscription changes. Distinguish -> hold evidence constant, vary hierarchy/length; hold presentation constant, vary retrieval effort. Measure task completion and repair, not only preference.
Response -> answer-first canonical view and user-requested depth; explicit allowance policy. Change -> structured report, bounded task-sensitive controller, cost ledger, scoped follow-ups. Simpler -> remove filler and correct UI limits before adding a second model.
New failure -> short summary hides uncertainty or cheap mode sacrifices decisive evidence. Test -> V2-11 and registered user repair study with correctness gates. Programs P1/P3/P4; medium confidence, prices/demand not validated.

## D4 — research misses the decisive source or scope
Evidence: C10 exposes archival/date/category tasks but comparison is not controlled; C11 adjacent search mode; C17 historical specialist task. Evidence for this exact current dedicated-mode complaint is weaker than D1/D2, though the task-specific evaluation rationale is strong (S34–S35).

Task -> find a rare compatibility/archive/methodological fact. Causes -> poor query vocabulary, wrong source type, absent index/access, weak extraction or overlooked requirement. Distinguish -> independent decisive-source list, source-access probe and gold evidence injection.
Response -> state missing decision-changing evidence and try a better route. Change -> gap registry, source-type escalation, candidate-discovery scope and saturation stop. Simpler -> open a supplied primary document completely.
New failure -> planner chases tangents or invents certainty that search is exhausted. Test -> V2-01/02/18 and EVAL task pairs. Program P1; important hypothesis with medium-to-low contemporary complaint evidence, not proven competitive advantage.

## D5 — correct research is hard to inspect on a phone
Evidence: C07 specific reading-position report; C03 recovery workaround; C06 long-form consumption. A single mobile report does not establish prevalence.

Task -> read, check a passage and return to the conclusion. Causes -> unstable block identities, nested scroll, rerender, long generated text or viewer limitations. Distinguish -> native gesture/reopen/large-text task with actual report, measure reading/citation task completion.
Response -> one-tap source sheet and stable position, not a developer dashboard. Change -> canonical block IDs/bookmark mapping, accessible native reading hierarchy and snapshot restoration. Simpler -> fix scroll/selection directly rather than create more content.
New failure -> anchors point to changed/deleted text or brief view disagrees with body. Test -> V2-11/12 plus M-group on both platforms. Program P3; high local fix feasibility, unknown reach.

## Hypotheses not elevated to established current complaints
Exact rates of hallucination; systematic hidden model downgrading for profitability; every vendor’s research becoming worse; multi-agent superiority; all research exhausting itself at a fixed source count; widespread September quota failures; widespread failure to extend existing evidence. Public posts do not establish these. Corrections/continuation remain an engineering and evaluation opportunity, not a documented absence of all current competitor capability.
