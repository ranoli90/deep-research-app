# Current-state audit

**Revision 3 reading note:** F04/F06 describe the original pre-revision specification bytes and are now resolved in specification text only. Application behavior remains unimplemented/unverified here. See STATUS.md and docs/PREBUILD_RECONCILIATION.md (from this file: `PREBUILD_RECONCILIATION.md`) for current disposition; historical row references remain unchanged.

**Scope:** supplied ZIP and standalone master, bounded connected repository search, public research. **Date:** 2026-09-16. **Reviewer:** one model applying multiple perspectives; no independent expert panel.

## Inputs and checks actually performed
The ZIP contains 22 files. Its 21 listed manifest entries match the files’ hashes and byte lengths. The standalone master is byte-identical to the bundled master. See `verification/INPUT_INTEGRITY.json` and `verification/INPUT_INVENTORY.json` for the actual baseline records.

Read the root instructions, full master, all four specifications, twelve role files, README, manifest and research leads/source notes. The original acceptance file contains 70 scenario descriptions (R01–R22, E01–E10, J01–J14, S01–S12, M01–M12). They are requirements, not executable test results. Earlier conversational references to other counts do not govern these bytes.

No mobile source, server handlers, database migrations, package manifest, lockfile, runtime schemas, native artifacts or executable application tests were present. The root AGENTS and six development/six runtime role files are specifications. Scoped AGENTS were requested by the master but not supplied in the original ZIP.

Connected GitHub repository search for `research` returned no match. A code search for `CoverageContract` returned unrelated repositories, none identified as this app. No unrelated repository was assumed to be the project. The search is bounded and does not prove no differently named or inaccessible implementation exists. No commit or deployment was made. A live request trace is inaccessible, not failed.

## Authoritative baseline and updated ownership
Original README identifies MASTER_BUILD_PROMPT.md as governing. The current user request supersedes its instruction to implement immediately: this task is a review and plan revision. Revision 2 shortens the master into an entrypoint, with explicit canonical ownership in README. The modifications address only inspected specifications; no claim of production code repair is made.

## Findings
Paths/line numbers below refer to the original bytes, not shifted lines in this revision. Line locations can be reconstructed from the input hashes and original archive.

| ID | Observed basis | Finding and status | Confidence and disposition |
|---|---|---|---|
| F01 | MASTER_BUILD_PROMPT.md §§2,19,23; wide task examples and generic success aims | Sound ambition but no selected initial job or user-repair benchmark. Product strategy specified broadly, not validated. | High for specification; target-market recommendation remains a hypothesis. Narrow scope in PRODUCT. |
| F02 | Entire file inventory; README explicitly says specifications | No executable implementation in the supplied artifact. App runtime is inaccessible, not proven broken or absent everywhere. | High within artifact boundary. Preserve honest status. |
| F03 | MASTER_BUILD_PROMPT.md §8 lists ten shared packages and multiple root docs | Package/document proliferation is a design risk before stable code ownership exists, not an observed code smell. | Medium engineering judgment. Adopt one backend codebase and three real shared packages when needed. |
| F04 | specs/ENGINE_CONTRACTS.md §8, original line 73, vs MOBILE_SCREEN_STATES cancellation controls | Transition text names preparing/researching/verifying as cancellable but not writing. Incomplete normative transition coverage; not a reproduced bug. | High textual gap. Define every nonterminal cancel path and revision fence. |
| F05 | ENGINE_CONTRACTS §§2,11; MOBILE_SCREEN_STATES follow-ups | Corrections/versioning exist in prose. Explicit invalidation of previously excluded candidates is not specified. | High specification gap. Add selection-space dependencies and expansion tests. |
| F06 | ACCEPTANCE_TESTS R19: “Old reports remain immutable”; ENGINE_CONTRACTS §12 deletion | Unqualified immutability conflicts with removal of private derived material. | High textual tension. Make content versioned but subject to privacy tombstones/purge. |
| F07 | ENGINE_CONTRACTS §§3–4; master §12 | Adaptive actions are enumerated but source-choice escalation and falsifiable decision-value tests are not concrete enough to distinguish a productive pivot from generic extra search. | Medium; policy needs empirical tuning. Add named gaps/action outcomes and gold-evidence diagnostic. |
| F08 | Master §§13,19; acceptance E-group | Citation support, source independence and independent factual-coverage checking are already specified. They are not newly discovered omissions. | High. Preserve them; add completeness against independently identified decisive evidence. |
| F09 | ENGINE_CONTRACTS §§9–10 already distinguish hosted visibility and opaque costs | Provider capability honesty is sound in the plan. Implementation is unverified. | High. Keep capability probes and fail-closed routing; no unnecessary provider-stack replacement. |
| F10 | Root AGENTS intended script contract; SETUP_AND_HANDOFF §3 | Scripts and verification ledgers are requested, not implemented. Future agents could mistake instruction compliance for runnable proof. | High status distinction. Introduce actual/proposed command registry and verification envelopes. |
| F11 | Master §9 and twelve role files | Runtime concerns are separated, and the master permits merging roles; six always-on calls are not a requirement. | High. Keep roles, make escalation policy explicit rather than attack a nonexistent mandatory swarm. |
| F12 | Root AGENTS boundaries/small-change rules | Mechanical import/ownership/contract/test-regression gates are described too abstractly to constrain future code growth. | Medium-high. Specify CI checks, trigger-based review and one module write owner. |
| F13 | Master §19 proposed 95%/90% gates | Thresholds are labeled proposed correctly, but have no observed distribution, denominators or validated benchmark here. | High. Retain as candidate targets and add adjudication/sampling/statistical limitations. |
| F14 | Master §23 native shell precedes full live path; no customer demand evidence | A prolonged shell-first execution could polish the wrong research loop. | Medium prioritization judgment. Pair minimal native slice with live baseline and benchmark before broad feature completion. |

## Capability classification
| Capability | Current state |
|---|---|
| Root/scoped instructions and revised plan | Root existed; scoped files/document changes supplied by this review. Document integrity checks only. |
| Mobile/UI | Specified but not implemented in supplied materials. No device testing. |
| Durable backend, retrieval, model calls | Specified; executable source/configuration inaccessible. |
| Evidence ledger and correction engine | Specified; v2 semantics refined, not implemented. |
| Security, consent, billing, privacy deletion | Required; no production behavior verified. |
| Proposed research benchmark | Seed specifications and protocol only; no real gold set, live trials or human outcome measurement. |
| PDF export, broad connectors, scheduled refresh | Intentionally deferred/gated. |
| Artifact validators | Implemented and separately executed; see execution records for exact scope. |

## Architectural baseline verdict
Retain the stack direction and evidence-first separations. The key deficiency is not a missing trendy framework. It is the absence of a narrow outcome experiment, sufficiently explicit correction/controller semantics and mechanical repository guardrails. The revised kit is still a plan, with small tested documentation tools—not an application audit masquerading as implementation evidence.
