# Build entrypoint — reviewed specification, September 16, 2026

**Revision 3 — reconciled pre-build handoff.** For Grok use `Grok_Code_Deep_Research_Goal.md`; both entrypoints defer to the same canonical specifications. First checkpoint is P0 under `IMPLEMENTATION_PLAN.md` (P0-D local correctness, P0-L live route, P0-N native evidence). Minimum governance/security and basic accessible controls start now; decorative P3 scope waits. A named external blocker is valid reporting, not verified completion. The original external review remains supporting input only.

This replaces the earlier monolithic master prompt. It is the entrypoint for a **subsequently authorized implementation**, not a statement that the review built the app.

Build a polished iPhone/Android research application with a simple conversational interface and a durable, inspectable research backend. Do not stop at a mockup or one opaque report-producing model call. Do not claim universal superiority.

Read `AGENTS.md`, `STATUS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, the relevant scoped instructions and the canonical specification named in `README.md`. Read `docs/CURRENT_STATE_AUDIT.md` to understand what actually exists. Do not assume an app repository or paid-provider configuration has already been supplied.

Implement `IMPLEMENTATION_PLAN.md` in dependency order. The first meaningful milestone is a real authorized research request that survives phone closure, persists accessed evidence, publishes a bounded cited report, opens citations and accepts a correction. Preserve the original simple visual direction in `specs/MOBILE_SCREEN_STATES.md`.

The specific competitive hypothesis is less customer repair on constrained technical comparisons and document-grounded decisions. Test decisive-source discovery and dependency-aware corrections using `EVALUATION.md`; do not build six always-running agents first. Saved sources, progress, steering and report editing are baseline features, not evidence of novelty.

Use one backend codebase with separate API and worker entrypoints, PostgreSQL, private storage, explicit model/retrieval adapters and a small shared core. Avoid premature package/service proliferation. Concrete transitions, evidence contracts, budgets and publication fences are in `specs/ENGINE_CONTRACTS.md`. Security and cost acceptance is in `docs/SECURITY_PRIVACY_COST.md`.

Required code quality is enforced by the mechanical checks and ownership rules in `docs/CODEBASE_GOVERNANCE.md`, not by expanding this prompt. Implement proposed scripts before advertising them. Keep fixtures distinctly labeled; no live payment/provider/deployment claim without its execution evidence.

For every completed slice deliver code, test evidence, native evidence where applicable, updated contracts/documents and truthful status. Missing credentials or build access are named blockers; continue unblocked work without fabricating integration success. Respect active authorization for spending, production changes, account access and publication.
