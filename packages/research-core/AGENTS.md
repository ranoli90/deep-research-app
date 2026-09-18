# Research core scoped instructions

Root AGENTS.md applies; these rules cannot weaken it.

**Current status:** Pure controller policy (`research-controller.v1`), citation support checks, and publication fences live in `src/`. Adaptive selection is `selectAdaptiveAction`; the bounded chooser is `selectBaselineAction`. `compileResearchIntent` / `evaluateClarificationValue` (`research-intent-compiler.v1`) turn one-sentence questions into structured objectives without rewriting the original question. No HTTP, React Native, or provider SDKs.

Pure controller policy imports contracts, never React Native, HTTP transport, provider SDKs or database clients. Actions are proposals; policy gates live outside model text. Preserve source/claim/constraint identities, typed dependencies and conservative invalidation. Test source saturation, newly eligible candidates, incomplete evidence and stop decisions. No mandatory agent swarm. `compileResearchIntent` copies the original question unchanged and asks only for material-change unknowns; do not turn underspecification into a chat interview.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook. Do not leave independent compiler/clarification work as a limitations list.
