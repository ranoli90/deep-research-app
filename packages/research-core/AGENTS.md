# Research core scoped instructions

Root AGENTS.md applies; these rules cannot weaken it.

**Current status:** Pure controller policy (`research-controller.v1`), citation support checks, and publication fences live in `src/`. Adaptive selection is `selectAdaptiveAction`; the bounded chooser is `selectBaselineAction`. `compileResearchIntent` / `evaluateClarificationValue` (`research-intent-compiler.v1`) turn one-sentence questions into structured objectives without rewriting the original question. Query provenance/expansion, source-type planning, evidence-value breadth, freshness, reconciliation and origin clustering are additional pure policy (`query-provenance.v1` and related). No HTTP, React Native, or provider SDKs.

Pure controller policy imports contracts, never React Native, HTTP transport, provider SDKs or database clients. Actions are proposals; policy gates live outside model text. Preserve source/claim/constraint identities, typed dependencies and conservative invalidation. Test source saturation, newly eligible candidates, incomplete evidence and stop decisions. No mandatory agent swarm. `compileResearchIntent` copies the original question unchanged and asks only for material-change unknowns; do not turn underspecification into a chat interview.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook. Do not leave independent compiler/clarification work as a limitations list.

A pure helper is not a shipped capability until the production worker calls it with real inputs. Do not treat unit-tested `nextSourceClass`, `evaluateFreshness`, `reconcileDocumentClaim`, or clustered independence as done if the worker still passes `sources:[]`, hardcodes `freshnessUnmet: false`, or never persists reconciliation.

## Retrieval and evidence quality

Ordinary questions must be able to find decisive evidence without expert vocabulary, PDFs, or treating every URL as equal. Files remain optional. Prefer source classes that can actually change the answer (first-party price, statute/regulator, primary literature, filings, vendor docs/tests) over syndicated blogs.

Query provenance is fail-closed. Classify terms as user-public, safe-application-derived, public-evidence-derived, or private-document-derived. Expand only from a bounded application lexicon and source-class qualifiers after the question-span binding gate. Never copy retrieved snippet text or private document wording into a public query. Canary substrings alone are insufficient: document-only tokens that are not canonical public terms require approval. Default leftover query tokens that exist only in an attachment to private-document-derived, not user-public.

Selection ranks relevance, not truth. Keep `whole-passage-selection.v1` as the stored proof unless a new version is admitted. Neighbor context must use locator kind (heading/table/footnote) or extraction kind, not keyword sniffing of passage text (`except`, `firmware`, `as of`), which pulls unrelated late facts into nearby bundles and breaks inventory/recovery. Omitted inventory stays unassessed; do not convert omission into “does not exist.” Inventory veto may still block a selected claim contradicted by owned unread text.

Independence counts clustered origins, not URL hosts. Five sites repeating one announcement are one confirmation. `independentConfirmationCount` must use title/snippet clustering; live hits set `originCluster` to `url.origin` and that field is not an independence key.

Freshness is criterion-class specific: current price is hours/days; law needs an effective rule; compatibility needs the applicable version; historical events may prefer contemporaneous sources; science is dated method, not recency alone. Persisting a policy row without evaluating source dates does not implement freshness.

Document/web reconciliation compares a document claim to inspected public evidence. Outcomes are confirmed, partially confirmed, contradicted, outdated, unverifiable, or blocked by access. Token overlap is not confirmation: mismatched quantities contradict; a later restatement of the same figure is not outdated. Permission-required is not the same as “we looked and could not tell.” Do not summarize the uploaded file as the answer.

`not found` is coverage. Record queries attempted, source classes attempted, blocked sources, and unresolved absence. Never infer nonexistence.

OSS rerankers, full Docling/ML, OCR, and browser readers stay Experiment/Watch/Reject until they beat the deterministic selector on decisive-evidence recall, qualifier retention, inventory replay, and cost, with a rollback path. Popularity is not adoption.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook.
