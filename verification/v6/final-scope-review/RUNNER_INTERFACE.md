# Minimal W08 evaluator runner interface proposal

Read-only proposal on0602f96; no implementation or execution authorization implied.

The current eval:live command always exits. Reuse buildApp/processRun/measureRunCost and two admitted research_strategy values as demonstrated in apps/backend/test/matched-pipeline.extraction.test.ts. Corpus registration/extraction stays in corpus.mts; production never imports task/rubric/gold files. No alternate executor, grading model or prompt change.

Suggested evaluator-only prepare command takes frozen registration/protocol and selected development task IDs/source mode; emits immutable plan hash with ordered arm/repetition/original/corrected/full-run slots, source hashes (supplied-document mode only), identical policy/prompt/budget/tool settings and required evidence columns. Prepare is provider-free. Do not inspect heldout answers to tune implementation.

Execute must require a current explicit authorization record tied to plan hash, numeric maximum total spend, allowed modes/tasks/repetitions and exact approved command, plus existing account/project/key limits. Credential presence, historical balance or the protocol itself is not authorization. Without that record default deny before admission/network. No paid authority exists now; test executable paths with deliberate injected transports only and label their receipts synthetic.

Projection: generator receives only registered public question/corrected question and explicit supplied document bytes. Evaluator reference criteria, decisive spans, task split and expected calculations remain outside model context and discovery. Live-discovery mode receives no hidden reference URLs. Frozen-source injection is labeled supplied-document evaluation, never discovery success.

Persist a local evaluator journal with exact account/run/key/arm/phase identity before admissions, acknowledging uploads and admissions before advancing. Unknown outcomes stay journaled/reserved and are resolved through existing owned recovery; do not restart on another key. Actual API/worker records are authoritative. Record every failure/cancellation/refusal/no-evidence/invalid output alongside successes; no automatic repeated best-of selection.

Output per slot: source commit/tree/policy hashes; task projection hash; run/revision/strategy identity; operation attempts; source byte/parser/access/locator and support/report traces; actual source reuse for correction; measured end-to-end time; confirmed receipt spend and separately unknown exposure; unrun reason and adjudication status. Existing measureRunCost supplies financial basis. Human/semantic scores stay null until actually adjudicated. A1/B descriptive comparison must not imply superiority.

Nonbillable acceptance: missing authorization denies despite keys; exact projection excludes labels; frozen/live modes do not mix; admitted strategy/policies identical across arms; simulated lost acknowledgement preserves identity/unknown holds; all failed attempts survive restart; correction and full rerun traverse same actual production workflow. Existing actual extraction fixtures can prove wiring, not heldout semantic quality.
