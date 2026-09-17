# Architecture decision register
Reviewed: 2026-09-16. All decisions are proposed for implementation; none implies a migrated live application.

## ADR-009 — measured offline HTML extraction (2026-09-17 implementation checkpoint)

Select Trafilatura 2.2.0 in an isolated Python process behind the existing TypeScript worker. Keep lxml table cells, spans and linked/adjacent footnotes because XML extraction alone drops some table geometry. Do not add Readability as a second production fallback. On identical saved bytes, the Readability 0.6.0/jsdom 26.1.0 candidate preserved 10/11 selected real-document spans; Trafilatura preserved 11/11, including PostgreSQL's connect-timeout caveat. One additional oversized download failed and stays in the denominator. The original eight synthetic cases scored 8/8 for the initial DOM candidate and 7/8 for vanilla Trafilatura (script-shell failure). The production wrapper fixes the shell and is tested separately. Agent-inspected references are not independent human adjudication or a quality leaderboard.

Tradeoff: adds a pinned Python runtime and Linux namespace requirement. The measured caveat loss and lower extraction times justify this small adapter/runtime addition, without replacing backend orchestration. Exact versions, hashes, failure records and retention notes are in `verification/v6/extraction/`; no third-party full documents are committed. The actual adapter preserved 11/11 saved real-document spans, with partial coverage warnings and roughly 0.65–1.59 seconds per isolated invocation on this machine. Reconsider when a broader held-out corpus shows omission, deployment compatibility fails, or runtime cost materially exceeds the benefit. PDF/OCR remains unimplemented. Rollback disables reading; it cannot label raw HTML or snippets as full text.

## ADR-001 — one backend codebase, separate API/worker processes
Choose modular monolith with three shared packages only when they contain real code. Keep original native/server/Supabase/Render direction. Reject separate provider/evidence/billing microservices at launch. Rationale: the first risk is demonstrable research usefulness and reliable transactions, not independent team deployment.
Strongest objection: retrieval/parser workloads may need resource isolation. Separate constrained extraction runtime when actual parsing risk requires it, without turning every domain into a service. Reverse when measured resource/security/deployment requirements justify separation. Port boundaries make reversal moderate, not zero cost. Rollback retains data contracts and fails closed.

## ADR-002 — relational evidence and decision dependencies
Choose typed relationships among constraints, questions, candidate selection, source versions, passages, claims, calculations and report blocks. Reject graph database and universal semantic graph initially. Rationale: selective repair needs ownership and dependency semantics, not a new storage paradigm.
Strongest objection: implicit dependencies are easy to miss. Use conservative branch/full invalidation when dependency completeness is unknown and reopen candidate discovery on relaxed constraints. Reverse to more advanced graph tooling only after query/maintenance limits are measured. Content versions remain subject to deletion.

## ADR-003 — bounded controller with optional escalation
Choose one iterative controller, combined investigation behavior and separate publication checks. Six logical concerns may share calls. Critics/parallel investigators are conditional, capped experiments. Keep one hosted provider route as an evaluation baseline, not invented internal visibility.
Strongest objection: parallel decomposition can improve hard fact gathering (S32). Allow a tested independent-question branch under the same atomic budget; preserve it only when matched evaluation shows benefit. No model vote is independent evidence. Reversal is inexpensive at strategy interface, but output/evidence contracts remain stable.

## ADR-004 — revision-fenced publication
Choose revision basis with brief/evidence/consent/cancel epochs plus worker fencing. Validate at tool authorization and atomic publication. Reject last-write-wins final reports and treating a client stream as state.
Strongest objection: stricter fencing can discard expensive late output. Permit safe raw receipt reconciliation without publishing obsolete conclusions; count actual provider cost honestly. Do not trade correctness/privacy for sunk cost. Migration requires contract compatibility mapping if an app exists.

## ADR-005 — outcome benchmark before broad feature growth
Choose two launch jobs plus correction lifecycle, with independent decisive-evidence rubrics. Reject a large unreviewed synthetic leaderboard and shell-first completion theater. Keep proposed 95/90 citation targets labeled unvalidated; add denominators and source-discovery/repair metrics.
Strongest objection: narrow tasks may not predict consumer demand. Recruit users with recent decisions and test both usefulness and return behavior; pivot the task focus rather than adding every category. A failed experiment is a reason to remove complexity, not relabel the metric.

## ADR-006 — private-data retention outranks historical immutability
Choose logically versioned reports but purge/redact affected private content when required. Keep non-content tombstones and permitted audit metadata. Reject retaining old private excerpts under an “immutable report” exception.
Strongest objection: source removal reduces reproducibility. Disclose that tradeoff and preserve only permitted metadata. External copies already downloaded cannot be recalled; make this limitation explicit. No rollback can restore access after revocation/deletion without lawful new authorization.

## ADR-007 — local correctness and gated progression
Choose real local PostgreSQL/queue for P0-D when cloud access is unavailable; separate live-provider and native evidence as P0-L/P0-N. Make P0 the first checkpoint without postponing minimum security, accessibility or governance. Reject both cloud-credentials-as-a-universal-blocker and treating a fixture/local pass as production compatibility.
Strongest objection: local environments can drift from production. Pin versions and migrations, record permissions/connection mode, and run hosted auth/RLS/storage/pooler/parity checks before deployment. Reverse the local test environment when a measured incompatibility demands it, not because a managed brand is assumed necessary. Existing safety/publication contracts remain unchanged.

## ADR-008 — notification identity without an exactly-once delivery claim
Choose a durable logical completion identity `(runId, completionEpoch)`, created atomically with publication, plus per-account/device-binding delivery identity. Provider deduplication/collapse features are capabilities, not assumptions. Reject the external review's claim that a local key alone prevents a duplicate OS alert after a send/receipt crash. Expo documents possible duplicated or missing handoff; a successful receipt is not proof of device delivery (N01–N03 in `research/RECONCILIATION_SOURCES.json`).
Strongest objection: suppressing an unknown-outcome retry can lose an optional alert. Prefer an inspectable in-app completion and reliable foreground refresh; default to no blind resend after an unreconcilable issued attempt. Change retry policy only with documented provider guarantees and a tested product tradeoff. No rollback may weaken account binding or disclose report contents. P0 tests local outbox invariants; live push arrives with P3 if enabled.
