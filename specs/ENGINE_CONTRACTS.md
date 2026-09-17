# Research engine contracts — revision 3
Owner role: research/backend lead. Status: normative design to implement; no runtime schemas or application tests executed. Reviewed: 2026-09-16.

Implementation checkpoint 2026-09-17: the repository now has an application; historical design status above is not a test result. W02 adds durable dispatch, atomic admission/reservation and worker attempt fences; W04 replaces the controlled fetch prefix with offline extraction. `source_versions`, `extraction_receipts`, `evidence_artifacts` and immutable block locators retain transport/digest/extractor provenance. HTTP failure text cannot become passages. HTML reading is partial, not full-document comprehension. `apps/backend/extraction/README.md` records the selected runtime and remaining layout/OCR/coverage limitations. Exact evidence and failures are in `verification/v6/RESULTS.json`; the entire W01–W09 milestone remains incomplete.

## 1. Scope and trust
These contracts refine the original evidence-first design. In a real repository, validated executable schemas become the source of truth and documentation is generated or checked against them. Do not maintain two independent schema definitions. Version external contracts and inspect installed clients before changing them.

Every persisted entity has an ID, an explicit tenant/ownership path, timestamps and an applicable schema version. IDs are opaque but are not authorization. Store UTC instants, preserve user timezone/date-only precision, and never invent a publication time from a date. Use exact decimals/integer micro-units with currency for money; preserve scientific units and significant assumptions.

Separate model suggestions from controller authorization. Sources, attachments, retrieved instructions and model outputs cannot change tools, permissions, privacy, spend or completion gates. Actions are read-only except internal state persistence and authorized report/account operations.

## 2. Task and decision representation
`ResearchBrief`: id, conversationId, originalQuestion, desiredOutcome, audience, language, geography, timeRange, freshnessRequirements, outputPreferences, attachmentIds, sourceRestrictions, nonGoals, constraints[], assumptions[], budgetPolicyId, consentPolicyVersion, revision.

`Constraint`: id, field, operator, value, units, origin (`explicit|confirmed|assumed`), importance (`hard|preference`), explanation and appliesTo. Hard constraints are never silently relaxed. `Assumption`: id, value, reversibility, impact and userConfirmationState. A safe assumption is visible and editable; uncertainty that could materially change authorized processing or the decision is clarified.

`DecisionFrame` for comparisons: candidateScope, criteria, hardConstraints, allowedTradeoffs, candidateDiscoveryStatus (`open|bounded-complete|incomplete`), and disqualifyingConditions. Do not impose this schema on every open-ended question; general synthesis uses coverage without recommendations.

`Candidate`: id, identity/version/region, discoveredFrom, currentScope and source evidence. `FeasibilityCheck`: candidateId, constraintId, status (`satisfies|violates|unknown|not-applicable`), evidenceIds, validAsOf and checker method. A missing fact is unknown, not satisfies. Empty search results do not establish no feasible option exists.

## 3. Coverage, questions and gaps
`CoverageItem`: id, question, taskRequirementIds, importance, requiredEvidenceDescription, dependencies, status (`unstarted|investigating|supported|qualified|blocked|excluded-by-user`), supportingIds and limitation. A `qualified` item must state what was established and why uncertainty remains. It is not a synonym for “not attempted.”

`QuestionNode`: id, parentId, coverageIds, originTrigger, scope, attemptedActions, lastUsefulEvidenceAt, currentHypotheses, unresolvedContradictions and nextActionCandidate. Avoid duplicate semantic questions, but retain different dates/populations/versions.

`EvidenceGap`: id, questionId, missingFact, whyItCouldChangeAnswer, affectedCandidateIds/claimIds, importance (`blocking|material|background`), sourceTypeNeeded, accessibleRoutesTried, latestOutcome and stopReason. The model’s question plan is useful but not complete truth. Preserve a bounded discovery/counterexample pass for missed alternatives. Evaluation uses independently identified decisive evidence, not only model-authored coverage.

Clarification is justified when an unresolved field is blocking and cannot be handled safely with a reversible assumption. Record the field, expected benefit, options and default. An exhaustive interview is not the default. A very large requested artifact is admitted as a bounded useful scope with disclosed limits, not promised and then abandoned.

## 4. Action contract and selection policy
Allowed actions: `clarify`, `search`, `fetch`, `extract_text`, `extract_table`, `inspect_visual`, `compare`, `calculate`, `verify`, `challenge`, `replan`, `synthesize`, `stop`. `extract_table` and `inspect_visual` are unavailable until their real adapters/tests exist; explicit capability flags reject use rather than fabricate results. `challenge` is the disconfirmation action (search for evidence that would make a material conclusion wrong). The versioned projection is `research-controller.v1`. Model proposes; `admitProposedAction` decides. The live default selector is `selectAdaptiveAction`; `selectBaselineAction` remains the bounded comparison arm.

Every action contains actionId, runId, briefRevision, coverageIds, gapId if applicable, validated arguments, short observable rationale, estimated maximum resource demand where enforceable, source access constraints and dedupeKey. The controller authorizes it with the current revision basis and atomically reserved budget. It rejects privileged fields proposed by the model.

Policy is a lexicographic decision rule, not a mystical confidence score:
1. Reject unsafe, unauthorized, out-of-scope, duplicate or over-budget actions.
2. Resolve a blocking ambiguity or missing eligibility fact before cosmetic report completeness.
3. Inspect an already-known likely primary source before issuing another generic query.
4. If extraction is incomplete, change extraction method or disclose access limits; do not ask another model to guess the missing table.
5. For a consequential contradiction, align dates, definitions, denominators, populations and versions before treating it as disagreement.
6. If the current route repeats the same source families without changing coverage, switch source type/terminology or stop that branch.
7. Permit bounded disconfirming evidence and candidate discovery when it can change a material conclusion.
8. Reserve verification/writing resources; synthesize when further authorized action has low expected marginal value.

Initial saturation heuristic: after two materially different queries produce no new relevant source family and no coverage progress, re-evaluate rather than blindly repeat. This is a configurable engineering starting rule to test, not an empirically optimal threshold. “New source” does not itself mean useful progress.

Source escalation examples: comparison page -> vendor compatibility matrix; technical blog -> underlying paper or repository issue; aggregate number -> methodology/table; current page -> authorized archive/version history; public assertion -> provided contract/manual. Specialist databases may require credentials/licensing; represent that barrier, do not route around access control.

`ActionOutcome`: success/partial/failed/blocked, receiptIds, accessedSourceIds, evidenceAdded, gapsResolved/created, coverageDelta, costState, nextStepReason. A pivot needs trigger evidence, previous approach, new source route, affected scope and a bounded action. No endless self-dialogue. Expose concise decisions and observable actions, never private chain-of-thought transcripts.

### V6 report/support implementation checkpoint (2026-09-17)

`literal-scope-v3` never uses word overlap as positive entailment. Complete literal statements and a narrow controlled passive paraphrase can pass; other wording remains unsupported/context-only until a substantive semantic assessment exists. Claim bindings cover block text exactly. Unknown/duplicate claims, unmapped factual headings/caveats and evidence-free type-label claims are rejected. A closed set of non-assertive section labels and fixed abstentions can omit claims.

Publication reloads owned passages and atomically stores claim revisions, text/evidence/scope digests, checker version and actual decisions. Pure deterministic report derivations are recomputed from the owned brief/evidence and recorded with input/output digests; they are not model verification receipts. The draft compiler localizes unsupported sections rather than leave unsupported prose or bypass publication. Candidate extraction has no fixture-name catalogue, but remains bounded literal grammar, not arbitrary semantic extraction. Missing evidence stays unknown; price variants retain sentence scope. Source-presence coverage and several event-only action handlers remain unrepaired and cannot establish research completion.

## 5. Evidence and source independence
`Source`: id, tenantScope, canonicalLocator, originalLocator, publisher, author when known, title, sourceType, language, publicationDate/precision, eventDate/precision, originCluster and rights/retentionClass.

`SourceVersion`: id, sourceId, retrievedAt, finalLocator, redirect metadata, contentHash when available, MIME, extractionVersion, accessLevel (`discovered|snippet|abstract|partial-text|full-text|visual-inspected|blocked|failed`), qualityWarnings, textCoverage and authorized artifact pointer. These states describe inspected material, not truthfulness. No blanket “fully read” from successful HTTP alone.

`Passage`: id, sourceVersionId, exact limited text or structured table cell values, locator, extractionMethod, qualityWarnings, scope qualifiers and optional labeled translation with original. Locators include page/section/cell and normalized text offsets or anchors. Hashes establish content identity, not factual correctness.

`SourceFamily`: id, originalWork/source relationship, relation (`same-document|syndicated|quotes|independent-unknown`), evidenceOfRelationship. Several sites repeating a press release do not create independent support. Independent-unknown remains unknown; do not infer independence only from domain names.

`Claim`: id, text, type (`external-fact|user-provided|calculation|inference|conditional-conclusion|limitation`), materiality, scope/date/units, supportStatus (`direct|inference|disputed|unverified`), evidenceLinks and validation records. `ClaimEvidence`: claimId, passageId, relation (`supports|contradicts|qualifies|context-only`), checkerVersion, decision and concise support explanation. Context-only cannot support the displayed assertion.

Citation integrity has distinct checks: referenced ID exists; user owns access; locator resolves; actual passage supports scope of statement; consequential uncited claims are detected; inference does not overreach. A working link is not verification, and a supporting source can itself be wrong. Model agreement is not independent confirmation.

V6 W01 implementation: the validator preserves missing-claim, unmapped-block, contradiction, qualification, ownership and source-version failures through the report wrapper. Publication reloads passages through their run/account/source ownership chain and rejects altered caller text/version. This is a deterministic safety layer, not a calibrated semantic verifier. Revision-scoped assessments, complete factual-clause coverage and legacy composer bindings remain open; passing the isolated regressions does not close those requirements. Rollback must keep these rejections and disable unsafe generation rather than restore false acceptance.

## 6. Calculations and contradictions
`Calculation`: id, named formula/version, inputs with source/claim IDs, exact units/currency/time basis, transformation/rounding, output, error bounds when justified, executionReceipt. Use deterministic bounded arithmetic; no arbitrary model-generated shell/code in production. Missing inputs stay unknown. A sensitivity range may be more useful than invented precision.

`Contradiction`: id, proposition, claimIds, alignedScope, mismatchDimensions, competingExplanations, evidenceNeeded and resolution (`scope-difference|evidence-favors-one|unresolved|withdrawn`). Source count does not settle a dispute. Preserve a supported alternative when evidence remains genuinely ambiguous, without pretending all alternatives have equal support.

## 7. Dependency-aware changes
Persist typed relational edges: constraint -> candidate selection/feasibility; sourceVersion -> passage; passage -> claim; claim/input -> calculation; claim/calculation -> conclusion; conclusion/claim -> report block. Reject invalid owner-crossing edges and dependency cycles where the relation requires an acyclic graph. This is a bounded provenance/impact graph implemented in PostgreSQL, not a knowledge-graph platform.

A correction creates a new brief/evidence revision and an `ImpactSet`: changed inputs, invalidated objects, reopened discovery scopes, preserved objects, reason and dependencyCompleteness (`known|partial|unknown`). If dependencies are incomplete, conservatively rerun the affected branch or full bounded task. Do not sell incremental efficiency at the cost of silently preserving wrong findings.

| Change | Required response |
|---|---|
| A cited number/date is corrected | Recompute dependent calculations and conclusions, then affected blocks; preserve unrelated evidence if freshness still fits. |
| Hard constraint is relaxed/broadened | Reopen candidate discovery, including options previously excluded. Re-ranking only old candidates is insufficient. |
| Constraint is tightened | Recheck all displayed feasibility statuses and conditionally remove choices; new discovery may still be useful if all old options fail. |
| New document is supplied | Parse under consent, identify relevant support/conflicts; do not blindly replace all sources or assume new is correct. |
| A source becomes unavailable | Preserve permitted historical evidence with last-access date; mark inability to refresh. Disappearance alone does not falsify an earlier observation. |
| Private source is deleted or consent revoked | Stop new processing, tombstone dependents, purge/redact prohibited content including historical report copies/caches; retain only allowed non-content audit metadata. |
| User asks only for a different format | Render the same claim set without pretending new research occurred; do not incur an expensive full search by default. |

`ChangeSummary` is semantic: evidence updated, conclusion changed, newly feasible/infeasible option, uncertainty increased/decreased, unchanged material. It references affected block/claim IDs. Do not regenerate an unrelated narrative pretending every sentence changed scientifically.

## 8. Durable lifecycle and phases
Internally distinguish lifecycle (`queued|running|awaiting_input|cancelling|terminal`), phase (`preparing|researching|verifying|writing`) and terminalOutcome (`completed|completed_with_limitations|cancelled|failed`). This avoids conflating a loop phase with run finality. If original external labels exist, map them through a versioned contract: queued, preparing, researching, verifying, writing, awaiting_input, cancelling, completed, completed_with_limitations, cancelled, failed.

Every nonterminal run, including writing and awaiting_input, can be cancelled. Awaiting input is persisted, not an open HTTP request. Completed output can be inspected but a late cancel cannot retroactively double-refund or destroy it. A deletion request is a separate privacy operation and can override retained content.

V6 local deletion implementation: the account lock serializes deletion with admission, attachment storage, correction/follow-up/clarification writes, challenges and worker content transactions. Purge includes original briefs, events/checkpoints/controller state, source metadata/locators, passages, support/derivation records, candidates/gaps/calculations/disconfirmations, challenge excerpts, all report versions and raw database attachment bytes. Minimal tombstones and amount/state/opaque provider receipt identifiers remain for already-issued accounting; unknown spend reservations are not released as if confirmed zero. New attachment bytes commit with their metadata, avoiding the prior file-before-row orphan window. Legacy flat-key files are claimed through `file_deletion_outbox`, unlinked outside transactions, and retried after storage failure or lost acknowledgement. Only the exact generated owned key under configured storage is authorized. API returns `fileCleanupPending` when storage cleanup remains outstanding. Worker startup/periodic replay upgrades prior deletion tombstones via `deletion_cleanup_version`; hosted backup restoration and external copies remain separate evidence gates. Rollback must retain these fences, tombstones and cleanup processing.

Allowed loop: preparation -> investigation -> verification -> writing. Verification may return to investigation for a named material gap with remaining budget; no infinite writer/critic ping-pong. Completion-with-limitations is a useful outcome with explicit blockers, distinct from failed delivery.

## 9. Fences, idempotency and recovery
A `RevisionBasis` contains briefRevision, evidenceRevision, consentEpoch, cancellationEpoch and workerLeaseFence. Load it at action planning, recheck at authorization, and compare atomically before publication. A lease fence is monotonic; an expired worker cannot overwrite the new owner’s result even if its network call finishes later.

Admission validates identity/ownership/consent and atomically records run, user allowance reservation and enqueue/outbox. A duplicate idempotency key with the same canonical request returns the accepted run; the same key with different payload is a conflict. Workers checkpoint evidence and task intent independently of report generation.

V6 identity boundary: production uses the configured Supabase Auth `/auth/v1/user` verification endpoint, not the development session table or client-decoded claims. HTTPS origin and publishable key are required at startup; redirects, oversized/malformed responses, unconfirmed/anonymous/non-user identities and outages fail closed. Provider outages return temporary unavailability rather than invalidating a local session. No bearer token, email or editable user metadata is persisted by identity mapping. The verified issuer/subject digest maps atomically to one server-generated owner; new identities receive zero automatic allowance. The digest survives local deletion solely to deny account resurrection. `/v1/session` returns the resolved local account ID. Follow-up/challenge claim IDs must belong to the owned current/selected report, not merely exist in a claim table. Production login/refresh UI, provider-side identity deletion and hosted Auth verification are still required before real-user activation; current tests establish the adapter/database boundary using transport doubles, not provider cryptography.

Paid calls persist intent before issuance: correlation ID, route/capability version, request digest, scope, reserved maximum, state (`planned|issued|confirmed|failed|outcome-unknown`). A timeout after issuance is not proof of no charge or no work. Query provider status when supported; otherwise keep uncertainty visible and apply a conservative documented reconciliation/refund policy. Do not blindly retry and debit the user twice.

Use bounded retry/jitter for genuinely transient failures, permanent errors for unsupported access/arguments, and explicit manual redrive with lineage. Every redrive rechecks consent, deletion, scope and remaining budget. Dead-letter storage is not an exception to content retention.

Publish report blocks, citation map, run outcome and completion-notification outbox in one transaction guarded by the revision basis. If stale, do not publish. Reconcile late receipts/costs separately if permitted without resurrecting private content. This promises idempotent application effects where tested, not exactly-once external computation (S40).

## 10. Mobile synchronization and events
Events: id, runId, sequence, createdAt, schemaVersion, type, publicSummary, phase, relatedSource/Claim/Report IDs and snapshotRevision. Persist only observed milestones. Discovered/read/cited counts have separate definitions. No invented completion percentage or fictional agent conversation.

Initial transport: authenticated snapshot plus cursor polling with backoff and foreground wake refresh. Add streaming only after native runtime/reconnect tests prove benefit; streaming is disposable. Cursor gaps return a current snapshot and a gap marker. The client deduplicates events by ID and reconciles against server revisions.

Optional push says only that a report is ready, without query/title/source text. Notification permission is not required for research. A push is not proof the client downloaded the report; opening authenticates the active account and fetches authoritative state.

**Completion identity.** Allocate monotonic per-run `completionEpoch` atomically when a new report version is successfully published. Duplicate publication attempts reuse the same existing publication identity; retries must never increment it. A later genuine report publication receives a new epoch. Unique logical notification key is the typed tuple `(runId, completionEpoch)` within its tenant/run ownership constraint, not ambiguous string concatenation. Create that logical outbox row in the publication transaction.

**Delivery identity.** Fan-out, if enabled, uses a unique row `(notificationId, accountId, deviceBindingId, bindingEpoch, channel)`. The binding identifies a particular authorized login/device association, not just a reusable push token. Recheck ownership, active binding epoch, consent and deletion immediately before dispatch. Stop unsent rows on logout/deletion; expire stale tokens. A second legitimate device may receive its own delivery, while token rotation or retry must not create a new logical completion.

**Retries and unknown outcomes.** Persist dispatch intent, attempt status and any provider ticket/receipt. Use the same provider idempotency key only where the adapter verifies support. Provider collapse identifiers can reduce repeated presentation but do not prove exactly-once delivery. After a crash/timeout following issuance, reconcile via supported receipts when possible. If outcome remains unknown and provider idempotency is unavailable, default to no blind resend for this optional notification: mark `outcome_unknown`, retain one logical in-app completion, and rely on foreground synchronization. Retry only documented known-nonaccepted/transient outcomes with bounded attempts; a missing receipt is not proof of nonacceptance.

**Guarantee boundary.** We can enforce one logical completion/outbox entry and per-binding application delivery record. We cannot guarantee exactly one OS-visible alert or guaranteed device delivery across external push services. Expo explicitly allows duplicate or missing handoffs; APNs is best effort (N01–N03, `research/RECONCILIATION_SOURCES.json`). Store normalized provider states `issued|accepted|rejected|outcome_unknown`, never label an accepted handoff `device_delivered` without an actual device acknowledgement. Client in-app events deduplicate by logical identity; OS-level display may bypass app code.

**Logout/privacy.** Clear the prior account's cached reports and app-controlled notification state; remove delivered/pending local notifications when platform APIs support it. A generic remote alert already in flight cannot be reliably recalled. Its deep link must reauthorize and show a safe unavailable state for the wrong account or deleted report. The notification must not carry sensitive report data, and account switching must not allow a late alert to fetch the prior account's report.

P0 implements publication/outbox identity and deterministic fault tests only if an outbox is present; no paid/provider push credentials are needed. Real push transport is a separate P3 feature gate, not a prerequisite for durable research. Acceptance: J02/J14/S12; never reinterpret those as an external exactly-once guarantee.

## 11. Public API contract to implement
| Operation | Required behavior |
|---|---|
| POST /v1/runs | Auth, consent, schema, attachment ownership, idempotency key, atomic admission; returns run ID and accepted snapshot. |
| GET /v1/runs/:id | Ownership, current phase/outcome, revision basis safe subset, next action and preserved artifacts. |
| GET /v1/runs/:id/events?after=cursor | Ownership; ordered paged events; retention-gap signal; never another user’s diagnostics. |
| POST /v1/runs/:id/corrections | Expected briefRevision and idempotency key; conflict on stale edit; new revision/impact request. |
| POST /v1/runs/:id/cancel | Idempotent request; phase-independent cancellation policy and current authoritative outcome. |
| POST /v1/runs/:id/continue | Explicit scope/allowance policy and valid consent; child run lineage; not automatic resurrection. |
| POST /v1/attachments; POST /v1/attachments/bytes; GET /v1/attachments/:id | Explicit pasted notes or bounded binary upload, MIME/magic/UTF-8/size validation, owned processing metadata and honest extraction limits. |
| GET /v1/reports/:id and /sources/:id | Ownership/retention; canonical blocks, evidence access labels and signed short-lived artifact URLs where needed. |
| POST /v1/reports/:id/challenges | Claim/block reference, feedback category and task scope; not unrestricted raw SQL or source instructions. |
| Account/consent/export/purchase endpoints | Separate verified authorized operations, deletion precedence, server purchase verification and replay protection. |

Errors have stable code, user-safe message, retryability, correlation ID and preserved-state summary. Distinguish invalid_input, permission_denied, consent_required, stale_revision, capacity_unavailable, allowance_exhausted, source_unavailable, extraction_partial, provider_outcome_unknown and internal_failure. Do not expose secrets or raw stack traces.

## 12. Reports and context
Canonical report: reportId, version, runId, basis, outcome, blocks with stable IDs, claim/citation links, coverage outcomes, calculation links, limitations, source-access summary and changeSummary. Text/heading/list/table/quote/code blocks are safely rendered; arbitrary HTML is forbidden.

The answer-first view and expanded report reference the same claim set. Report blocks preserve enough semantic identity for stable reading anchors. Store bookmarks as reportVersion + blockId + offset; map across versions only when valid, otherwise explain the moved/removed section rather than resetting silently.

Within-run memory is structured evidence and task state, not a profile. Context assembly selects relevant passages, active constraints and unresolved gaps. Preserve traceable IDs during compression and test that contradictions/negative evidence are not dropped. Reuse answers only within authorized context/freshness; do not share private cache text between users.

## 13. Stop policies and resource limits
Successful completion: all critical task items have supported or explicitly qualified outcomes, hard constraints are preserved, citations resolve, computations pass and material conflicts are addressed. Useful partial: report names remaining access/budget/input blockers and preserved findings. Failure: execution cannot produce the declared useful artifact. Cancellation: user stopped work; no new paid actions issued afterward except unavoidable in-flight accounting.

Depth is governed by decision sensitivity and evidence accessibility, not target words or citations. Initial concurrent investigation limit is one; permit two independent branches only behind an evaluated policy. Numeric per-route budgets are selected during a real authorized capability/cost spike, not invented here. Reserve a fixed configured finishing allowance before exploration; test it against actual task costs and adjust openly.

Gateway/model/search adapters must represent capabilities as supported/unsupported/unknown with checkedAt, test evidence and exact effective processor when known. Unsupported cancellation or internal search limits remain unsupported. A route incompatible with promised privacy or enforceable spending is rejected, not silently substituted. See `docs/SECURITY_PRIVACY_COST.md` for the ledger and privacy policy.


### V6 W04 binary evidence implementation
Migration 013 stores scoped attachment extraction JSON beside immutable original bytes. PDF-like filenames cannot turn pasted text into PDF evidence. Bytes may be stored before research; only a successful, owned, fence-checked extraction joins run evidence. Parsing holds no database transaction. Failed/unsupported input persists an explicit unavailable source with no supporting passages, never an error body as evidence. The selected Docling Parse 7.20.0 geometry adapter records actual page indexes and text-cell rectangles; pypdf 6.19.0 is only strict metadata/encryption validation. No OCR/table-layout model runs. PDF results remain partial. Changes of extractor version invalidate attachment extraction-cache reuse; old pypdf text results cannot bypass the corrected decoder. Source inspection returns sourceVersionId, passageLocator, extractionMethod, coverage and warnings. Content deletion clears every copy of extraction JSON/bytes. Existing general coverage/completion gaps remain open; a file's presence or parser completion does not satisfy a criterion.


Executable argument boundary (W02/F15): `packages/contracts/src/action-arguments.ts` owns strict bounded argument schemas. Admission rejects undeclared keys before transformations and admits the actual transformed executable action again. Proposals cannot supply authority, arbitrary code or verification outcomes. Schema validity alone does not establish named-action execution or evidential support.
