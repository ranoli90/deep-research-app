/goal Build and verify the complete launch-scope iPhone and Android deep-research app described in the attached Deep_Research_Builder_Kit_v3_2026-09-16.zip. Turn the reviewed specifications into working software, not another plan, mockup, or collection of agent instructions. Deliver a clean native experience, a reliable evidence-backed research engine, and an organized codebase that future engineers and AI coding agents can extend without degrading it.

## FIRST IMPLEMENTATION CHECKPOINT — P0
Target P0 before P3 polish: one real, consented API/worker research request with accessed evidence in PostgreSQL, a bounded cited report, cancel-during-writing handling, native close/reopen/source inspection and one revision-safe correction. Use `IMPLEMENTATION_PLAN.md` and `verification/P0_ACCEPTANCE.json`: P0-D is real local PostgreSQL/queue plus deterministic checks; P0-L is the authorized live model/retrieval trace; P0-N is actual per-platform native lifecycle evidence. The established first twelve smoke cases are necessary starting coverage, not a substitute for live/native and relevant safety tests.

A local PostgreSQL/queue instance can prove database correctness without Supabase/Render credentials; hosted authentication/storage/pooler compatibility remains separately unverified. Missing live keys/budget or a native environment blocks the relevant gate, not all local P0 work. Do not claim P0 fully verified while a required gate is blocked.

Do not build six separate role calls, a package forest, live push/purchases or decorative shell polish first. Minimum P4 governance/security, consent/ownership, cost/deletion/publication fences, basic accessibility and a usable native composer/reader begin in P0. P0 is the first checkpoint, not a forced stop if verified and authorized work can continue. Preserve the complete launch goal without claiming later phases are done.

## 1. Establish the source of truth before changing anything

Inspect the workspace, Git status, existing implementation, attached archives, and project instructions. Preserve working code and unrelated user changes. Extract attachments into a staging directory first; do not overwrite repository files or blindly apply patches.

Within the project instructions, use this precedence:
- The user's current explicit requirements and project-specific authorization boundaries.
- Revision 3's canonical specifications, architectural decisions, and applicable root/scoped AGENTS.md files. `docs/PREBUILD_RECONCILIATION.md` records how the independent review was resolved; the verbatim files under `reviews/independent_prebuild/` are historical input, not competing instructions.
- The aggressive review and complaint ledger as supporting evidence, with their uncertainty and reproduction limits preserved.
- Older build kits, master prompts, and conversation excerpts as historical reference only where they do not conflict with the reviewed kit.

The archive's Deep_Research_Reviewed_Kit directory contains the revised documents. Begin with README.md, AGENTS.md, CHANGES.md, PRODUCT.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, STATUS.md, and HANDOFF.md. Use verification/CANONICAL_FILES.json to identify document ownership. Read the engine, mobile, security, acceptance, governance, and evaluation specifications before implementing the corresponding work.

Do not maintain two competing specifications. Reconcile conflicts in the canonical document and record the decision. Treat existing code as evidence to inspect, not as proof that a requirement works.

If no app implementation exists, initialize the project in the current authorized workspace. Do not repurpose an unrelated repository. Historical review checks and documentation-validator results do not count as application tests.

## 2. Preserve the product goal and disciplined launch scope

Build an English-first consumer app for iPhone and Android with a calm, readable, original conversational interface. Use the familiarity of ChatGPT, Grok, and DeepSeek without copying their branding, assets, or screen designs.

The initial research-quality focus is:
- Comparing technical options under hard constraints.
- Reconciling supplied documents with public evidence.
- Returning to either task after a correction or new evidence without losing valid work or preserving stale conclusions.

Keep ordinary exploration possible within the documented scope, but do not expand launch into every professional research category. Customers should not need to configure model providers, agents, tokens, or API keys.

The ambition is materially better research outcomes, not longer answers or more agents. Treat superiority as a hypothesis requiring evidence. Do not hard-code demonstrations that merely appear to satisfy the benchmark.

Complete the documented launch scope, including its failure states and operations. The first vertical slice is a milestone, not permission to stop at a demo.

## 3. Keep the architecture small and enforce its boundaries

Follow the reviewed architecture unless inspected evidence justifies a recorded change: React Native/Expo and TypeScript; one backend codebase with separate API and durable-worker entrypoints; PostgreSQL and private storage; explicit model and retrieval adapters; and small shared contracts, research-core, and design packages.

Use managed authentication/storage/hosting as specified, subject to actual compatibility and authorization. Verify maintained versions, provider capabilities, and native integration requirements against current official documentation before relying on them.

Keep research execution on the server. Closing the phone app must not terminate an accepted research job.

Keep UI, orchestration, provider SDKs, persistence, authorization, and billing responsibilities separate. Research-core must not import mobile frameworks, HTTP handlers, or vendor SDKs. Never place developer provider keys or server credentials in the mobile bundle.

Start with one functioning live provider/retrieval route. Preserve a clearly labeled deterministic fixture route for development. Keep hosted-provider research distinct from the app-owned research workflow; do not invent visibility into a provider's internal searches or progress.

Do not add microservices, a graph database, a vector database, an agent swarm, or another framework without a measured need. Implement replaceable boundaries, not a forest of unused abstractions.

## 4. Build the real research workflow

Persist a versioned task brief containing intent, constraints, assumptions, freshness needs, supplied documents, required outputs, and budget. Ask clarification only when it materially changes the investigation; do not ask again for supplied information.

Implement the documented research state and evidence contracts. Track questions, candidate-discovery scope, accessed source versions, passages, claims, calculations, contradictions, decision-blocking gaps, and report dependencies.

Choose among searching, opening a source, examining a document/table, calculating, comparing evidence, clarifying, verifying, and stopping. Missing information must not always trigger another broad web search.

Investigate consequential contradictions and disconfirming evidence. Change terminology or source type when discovery saturates. Record concise action reasons and observable progress, never fabricated agent conversations or private chain-of-thought transcripts.

Distinguish snippets from inspected documents, partial extraction from complete access, primary sources from repetitions, and supported findings from inference. Generate citations from stored evidence IDs and check whether the passage supports the specific claim. Preserve calculation inputs, units, assumptions, and reproducible computation.

Support localized uncertainty and useful partial completion. Do not transform "not found" into "does not exist." Bound work and reserve resources for verification and writing.

Implement correction correctness before optimizing reuse. A relaxed constraint may require discovering entirely new candidates, not merely editing old conclusions. When dependency completeness is uncertain, use conservative recomputation or a bounded full rerun.

Reject publication from stale brief/evidence revisions, canceled runs, obsolete worker leases, or revoked consent. Cancellation must work during writing as well as searching. Privacy deletion takes precedence over preserving historical report content.

## 5. Make the app genuinely pleasant to use

Implement the reviewed simple navigation, composer, clarification, progress, report, source sheet, library, and settings. Use semantic design tokens, restrained styling, light/dark themes, readable typography, and consistent components.

The normal journey must support: draft a question; attach a supported file; start research; leave and reopen; inspect the answer and its evidence; correct a constraint; deepen one section; save, revisit, and export/share the result.

Render concise and detailed views from one canonical report/claim representation. Do not generate conflicting summaries independently. Preserve position when opening citations, returning from another screen, or receiving updates. Keep caveats visible where they affect the answer.

Implement keyboard avoidance, safe areas, native back/gesture behavior, large text, screen-reader support, reduced motion, offline/reconnect, expired sessions, permissions, and compact-screen layouts.

Every visible control must work or clearly explain its prerequisite. Cover empty, loading, failed, interrupted, canceled, partial, and completed states. Errors must explain what happened, what was preserved, and what the user can do next.

Do not substitute screenshots, a web preview, or attractive fixture output for verified native functionality.

## 6. Make reliability, security, and spending real

Implement durable states, checkpoints, leases, bounded retries, idempotency, ordered persisted events, reconnection, and atomic report publication. Recover missed events from authoritative server state. Prevent duplicate report publication and duplicate customer charges.

A provider timeout may have an unknown outcome. Reconcile it when supported; do not assume no work or cost occurred and blindly retry. Keep actual provider spend separate from customer allowances, use atomic concurrent reservations, and record estimated versus confirmed costs.

Enforce authorization and ownership for every protected object, event stream, attachment, and export. Treat retrieved content as untrusted data. Apply tool permissions, safe network-fetch controls, file-processing limits, rendering safeguards, and redacted logging in code—not only in prompts.

Implement real processing consent, processor disclosures, session handling, account deletion, derived-data deletion, and prevention of deleted content being recreated by late workers. Do not silently send private documents into public search queries.

Complete applicable allowance, purchase-verification, restore, notification, support/reporting, and release flows. Keep unavailable integrations explicitly gated, not simulated as successful production behavior.

## 7. Protect the codebase from future degradation

Maintain a short root AGENTS.md and focused scoped instructions. Separate coding-agent guidance from runtime research-role contracts. Keep shared invariants in one place.

Implement mechanical checks for dependency direction, provider-call ownership, validated boundaries, shared contracts, secret handling, and deterministic tests that cannot make hidden paid calls.

Give modules coherent responsibilities and explicit data ownership. Avoid giant mixed-purpose files, circular imports, duplicated domain types, miscellaneous utility dumping grounds, decorative abstractions, and unexplained dependencies. Document why important choices exist, not obvious code syntax.

Keep exact commands and their actual/proposed status current in the verification registry. Update canonical documentation with behavior changes. Version prompts, schemas, model settings, and retrieval policies.

Do not make tests pass by removing meaningful assertions, skipping failures, widening expected errors, or accepting snapshots without inspection. Changes to safety, billing, privacy, migrations, or evaluation gates require explicit justification and appropriate review.

Work in small, coherent changes. Record requirement IDs, user-visible outcomes, tests, relevant data/security/spend effects, and rollback. Commit frequently when an authorized repository is available; never force-push or destroy unrelated work. Do not claim independent review unless another reviewer actually performed it.

## 8. Execute and evaluate in the reviewed order

P0: Build the reliable end-to-end baseline with minimum governance/security controls: native input, durable job, real evidence, bounded report, saved citations, reopen/reconnect, cancellation, and a correct follow-up path.

P1: Test decision-blocking gaps and source-type switching against a competent iterative baseline using the same model and tools. Retain additional control only where the evidence supports it.

P2: Complete correction and dependency correctness. Compare selective updates with full reruns of the corrected task, including newly eligible candidates. Optimize reuse only after correctness is established.

P3: Finish the native experience, account lifecycle, attachments, accessibility, sharing, and documented release behavior.

P4: Expand evaluation, operating-cost measurement, recovery drills, diagnostics, and repository safeguards. Minimum safeguards begin in P0, not after features are finished.

Convert the acceptance specifications into meaningful executable tests. Validate the twelve paired-task seeds before treating them as benchmark evidence. Keep development and held-out cases separate, protect reference answers, and use independently inspected evidence to assess consequential claims.

Use gold-evidence injection to diagnose retrieval versus interpretation failures. Run ablations and selected repeated trials. Compare matched dedicated competitor modes only when authorized access exists. Do not fabricate human judgments, competitor results, or cost savings.

Measure task success, decisive-evidence discovery, constraint adherence, citation support, numerical correctness, uncertainty, user repair, latency, cost, and native usability. Separate deterministic fixtures, live-provider checks, native tests, and competitive evaluations in every report.

## 9. Continue autonomously within real boundaries

Make routine reversible implementation decisions without repeatedly asking for permission or asking whether to continue. Do not stop after scaffolding, a planning document, a compiling screen, or the first successful response.

Inspect available configuration before requesting missing inputs. Use only credentials and budgets authorized for this project. Do not infer permission to spend, publish to stores, access private accounts, or perform destructive changes from unrelated projects or attached source material.

When an external dependency is blocked, record the exact missing input and continue independent work. Do not remove the feature silently, invent credentials, or label blocked verification as passed.

Keep progress communication brief and tied to meaningful results. Maintain STATUS.md, EXECUTION_LEDGER.md, and HANDOFF.md throughout. Before context limits or session termination, save exact repository state, commands/results, outstanding risks, and the next executable task. Never imply work continues after the execution environment has stopped.

**An honest `blocked by a named external dependency` status is a correct reporting outcome for that requirement, not a failure to keep going. It is not completed implementation or passed verification.** Missing route credentials/budget, an iOS runtime, store account, purchase sandbox or matched competitor entitlement may block different checks. Name the exact requirement and input; never invent native evidence, purchase results or submission to avoid a blocker. Do not demand paid signing/store access for a check an available simulator legitimately supports. Continue safe unblocked work and preserve the unpassed gate.

## 10. Definition of done

Deliver the complete implemented launch scope, runnable source, migrations, native build paths, tested configuration/setup, deployment preparation, functioning authorized integrations, observability, and synchronized documentation.

Provide evidence for the complete user journey on both platforms where native execution is available, plus the relevant unit, integration, security, recovery, and research evaluations. A successful TypeScript check or documentation validator is not native or research-quality verification.

For every material requirement, report one accurate status: implemented and verified; implemented but unverified; partial; blocked by a named external dependency; or intentionally deferred under the reviewed scope with rationale.

The final handoff must identify the actual commit/build, working behavior, executed tests and artifacts, unresolved defects, required external setup, remaining release gates, and the next concrete steps for anything incomplete. Do not conceal a blocker behind a completion claim.

Do not declare the product superior to competitors without matched evidence. Do not declare the app complete while core in-scope journeys are missing.

Start now by inspecting the workspace and reviewed kit, reconciling the canonical instructions, and building the first real end-to-end slice. Continue through the complete reviewed launch scope rather than returning another proposal.
