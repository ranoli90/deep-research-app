# Acceptance specifications — revision 3

**Status: these are scenario requirements, not executed application tests.** The review tools in scripts/ validate documentation only. Original IDs are retained.

# Acceptance and Regression Tests

Turn these into automated tests where feasible and explicit manual cases where device/human inspection is required. IDs are stable references for the complaint-to-requirement matrix. These are proposed cases, not passing results.

## Research behavior

**R01 — Already-known constraint.** Given a question that includes geography, budget, and date, when the brief is built, those become supplied constraints and no clarification asks for them again. The final report is checked against each constraint.

**R02 — Material ambiguity.** Given a request whose unspecified jurisdiction changes the answer, the system asks a focused question or uses an explicitly permitted assumption. It does not secretly choose the user's location from unrelated context.

**R03 — Irrelevant ambiguity.** Given a sufficiently clear task, minor stylistic ambiguity does not block research with an interview. The report uses the default format and preserves requested substance.

**R04 — False premise.** Given a fixture where the user's named feature does not exist, the investigator verifies the premise, reports the mismatch, and researches the corrected question only when consistent with the intended task. It does not invent the feature.

**R05 — Source duplication.** Given five articles repeating one original announcement, the evidence ledger identifies one origin cluster and does not claim five independent confirmations.

**R06 — Publication versus event date.** Given a recent article about an old event and an older article about a current policy period, the report preserves the relevant dates rather than sorting truth by newest publication alone.

**R07 — Inaccessible source.** Given a blocked page with a search snippet, the record remains snippet-only/blocked. The report does not claim full reading or quote content unavailable to the app.

**R08 — Targeted deeper search.** Given an uncovered high-importance question, a next action names that gap and a source/query likely to resolve it. Generic repeated searches fail the test.

**R09 — Justified pivot.** Given evidence that the initial dataset excludes the user's population, the system pivots to a population-relevant source and records the trigger. It does not merely increase report length.

**R10 — Irrelevant pivot blocked.** Given an attractive but unrelated topic in a webpage, the supervisor declines to add a branch outside the coverage contract.

**R11 — Real contradiction.** Given two sources that disagree on the same quantity/time/scope, the system investigates or explicitly reports the unresolved disagreement with both sources.

**R12 — Apparent contradiction.** Given different percentages with different denominators, the system explains the difference rather than manufacturing disagreement or averaging incomparable values.

**R13 — Diminishing returns.** Given repeated searches that return no novel consequential evidence, the system stops or changes approach within limits. It does not search until a fixed quota is exhausted.

**R14 — Budget-limited outcome.** Given unresolved required questions when the enforced budget is exhausted, the report is marked incomplete/limited with the actual gap and retained findings. It is not marked comprehensive.

**R15 — Useful uncertainty.** Given no reliable evidence for a claim after appropriate bounded investigation, the report says what is unknown and why. It does not assign a made-up precise probability.

**R16 — Anti-generic output.** Given a request for a specific comparison, the report includes the requested entities, relevant criteria, evidence, and tradeoffs. Boilerplate introductions cannot substitute for missed criteria.

**R17 — Detail versus verbosity.** Given a concise requested format, the app preserves essential support/limitations while respecting length. Given a detailed request, it includes consequential nuance rather than imposing a short template.

**R18 — Context compaction.** Given a long run that triggers summarization, hard constraints and evidence provenance remain intact. A retained citation resolves to the original stored passage.

**R19 — Follow-up efficiency.** Given a saved report and a request to verify one claim, only relevant branches rerun unless new evidence makes broader revision necessary. Earlier report versions remain logically versioned, but privacy deletion/revocation must purge or redact prohibited derived content; no immutable-content exception.

**R20 — Freshness.** Given follow-up questions about a mutable price and an immutable historical fact, refresh policy differs appropriately. A retrieved old price is not presented as current.

**R21 — Multilingual source.** Given a useful non-English original, store its language and original passage; label the translation. Do not imply translated wording is a verbatim original quote.

**R22 — Calculation provenance.** Given evidence inputs with units and periods, a deterministic calculation produces the expected result and preserves the formula. A model's unsupported number fails verification.

## Evidence and citation integrity

**E01 — Unknown citation ID.** A synthesized reference to an absent ID blocks publication or triggers a bounded repair. Never render a fabricated link.

**E02 — Non-supporting citation.** A passage mentioning an entity but not supporting the stated claim is flagged. The claim is revised, removed, or qualified—not rubber-stamped because the URL works.

**E03 — Scope qualifiers.** A study about one population cannot support an unqualified claim about everyone. Verification preserves the qualifier.

**E04 — Numerical mismatch.** A cited table value differing from the report value is flagged; verify units, date, and rounding before publication.

**E05 — Changed source version.** Re-fetching changed content creates a new source version. A previously saved report still identifies the evidence version originally used.

**E06 — Partial PDF.** A document with missing pages/extraction failures carries coverage warnings. The agent cannot answer from unread pages without additional authorized processing.

**E07 — Evidence permission.** A valid evidence ID belonging to another account is denied in APIs, reports, exports, caches, and source sheets.

**E08 — Quote integrity.** Quoted text matches the retained passage, with any ellipsis/translation clearly represented. Synthesis cannot silently rewrite a quote.

**E09 — Export integrity.** All in-app citation anchors resolve correctly in Markdown and any advertised PDF export. Long tables and Unicode remain readable.

**E10 — Critical claim removal.** If verification removes a claim used by the conclusion, synthesis revisits the conclusion rather than leaving an unsupported decision in the summary.

## Jobs, concurrency, and cost

**J01 — Double tap.** Two identical create requests with the same user-scoped idempotency key result in one run and one reservation.

**J02 — Worker duplicate.** Two deliveries of one task do not duplicate persisted evidence, final reports, customer settlements, or logical completion/outbox records. Unique delivery rows are scoped to account/device-binding epoch; external OS push delivery is not an exactly-once application effect (J14).

**J03 — Crash after fetch.** A worker dies after storing evidence but before checkpoint completion. Recovery reconciles the checkpoint without erasing evidence or blindly charging again.

**J04 — Unknown remote outcome.** A timeout after a paid request is issued records outcome-unknown. The system follows supported reconciliation or explicit policy rather than assuming the call failed for free.

**J05 — Cancel race.** Cancellation during active execution prevents new calls. A late provider response cannot restart the run or create a second settlement.

**J06 — Completion race.** Cancel arrives after atomic report completion. Preserve the finished report and apply documented allowance policy exactly once.

**J07 — Lease expiration.** A dead worker's job is safely reclaimed after a bounded interval. A live worker cannot overwrite a newer state revision with stale results.

**J08 — Reconnect cursor.** Network loss during progress recovers missing events from sequence numbers or a snapshot. The UI does not duplicate report blocks.

**J09 — Simultaneous overspend.** Concurrent requests cannot reserve more allowance than available. Both customer credits and infrastructure guardrails are checked transactionally.

**J10 — Synthesis reserve.** A run cannot spend its entire permitted resource allocation retrieving sources and then silently fail to write. Preserve the declared verification/writing reserve.

**J11 — Opaque provider limit.** An adapter without enforced internal search/spend limits cannot advertise app-level counters as a guarantee of its total cost.

**J12 — Price/accounting drift.** Missing or stale pricing is explicit. Confirmed provider usage reconciles estimates without altering historical price assumptions invisibly.

**J13 — Global kill switch.** Disabling live spending prevents new paid calls across workers while preserving readable saved reports and safe cancellation.

**J14 — Notification outbox.** Duplicate publication/dispatch attempts preserve the same `(runId, completionEpoch)` and one logical outbox record; fan-out rows use account/device-binding epoch identity. Inject crashes before send, after possible provider acceptance but before receipt persistence, and after a stored receipt. A known rejected request follows bounded retry; an issued unknown outcome is reconciled or suppressed under the declared policy, never blindly retried as free/nonaccepted work. Test providers with and without idempotency; a provider duplicate must not create repeated app completion state or a retry loop. Different legitimate devices and genuinely new report publications remain independently addressable. Passing these tests proves application-level deduplication/controlled retry, not duplicate-free OS delivery. Live push tests remain separate from deterministic local outbox tests.

## Security and privacy

**S01 — Prompt injection.** A webpage instructing the model to reveal keys or ignore constraints is treated as source text and cannot authorize a tool or policy change.

**S02 — SSRF chain.** A public URL redirecting to metadata, loopback, private IPv4/IPv6, or a DNS-rebound target is blocked at the actual request path.

**S03 — Malicious document.** Oversized/compressed/malformed files are bounded and isolated; they cannot exhaust the worker or access secrets.

**S04 — Unsafe markup.** Generated HTML/scripts/event handlers and unsafe link protocols cannot execute in the report reader or export pipeline.

**S05 — Private-search leakage.** A private attachment containing personal identifiers cannot be copied into a public search query without permitted purpose and appropriate explicit disclosure/consent.

**S06 — Unsafe fallback.** A provider outage cannot cause routing to a processor outside the approved privacy/capability policy.

**S07 — Cross-account cache.** A cached private source or report is never delivered to a different account, including after logout and login on the same device.

**S08 — Forged purchase.** A modified client payload or unsigned/replayed webhook cannot grant extra entitlement. Out-of-order valid events follow authoritative reconciliation.

**S09 — Deletion during run.** Account/attachment deletion cancels relevant new work, marks tombstones, removes permitted derived content, and prevents late callbacks from recreating it.

**S10 — Redacted logs.** Standard logs, metrics, support IDs, and mobile errors contain no test secret, auth token, private document body, or unapproved question text.

**S11 — Consent revocation.** Revoking AI-processing permission stops new transfers and explains limits on already-issued requests. It does not silently switch providers to continue.

**S12 — Session switch and push.** After account switch, prior cached reports are inaccessible and stale binding epochs cannot dispatch new pushes. Inject a delayed already-issued push: its payload contains no private report/query/title; opening its link must not fetch or render the prior account's data. App-controlled pending/displayed notifications are cleared where platform APIs permit. Record the limitation that an already-issued generic remote alert cannot be reliably recalled; do not fake a transport guarantee. Test deletion and two devices as well as logout/login.

## Native UI and release behavior

**M01 — App lifecycle.** Start real or fixture-backed research, background/terminate the app, reopen, and recover the exact state on both operating systems.

**M02 — Accessibility.** Navigate composer, progress, report, source sheet, and settings with VoiceOver/TalkBack and enlarged text. No essential action is unlabeled or clipped.

**M03 — Keyboard/back.** On compact iPhone and Android layouts, the composer/send button remains usable with keyboard open; native back/gestures behave predictably.

**M04 — Long content.** A long report, code block, wide table, Unicode text, and many citations remain selectable and readable without whole-screen horizontal overflow.

**M05 — Offline.** Losing connectivity preserves a draft and permitted cached report, displays the actual state, and does not invisibly submit paid work.

**M06 — Denied notification.** The app remains fully usable with notification permission denied. Reopening obtains server progress without requiring push delivery.

**M07 — Prerequisite routing.** Starting research while unauthenticated/unconsented/unfunded preserves the draft and navigates to the relevant requirement with clear return behavior.

**M08 — Versioned follow-up.** A targeted follow-up creates a new result with change summary while the previous report remains available and exportable.

**M09 — Account deletion.** In-app and required web deletion paths are real, authenticated appropriately, and accessible without reinstalling the app for the web path.

**M10 — Output reporting.** The user can flag a generated answer inside the app, receive submission confirmation, and choose whether diagnostic content is included.

**M11 — Purchases.** Test purchase, pending/failed state, restore, renewal/revocation simulation, wrong-account restore, and subscription-management guidance with actual supported sandbox tools.

**M12 — Demo/production separation.** Demo mode is visible. Production refuses fake auth/billing and cannot display fixture reports as live completed research.

## Evidence recording and gates

Each executed case records case ID, fixture/live mode, expected result, actual result, commit, environment/device, date, command/manual steps, evidence path, and pass/fail/blocked status. Tests not executed remain unverified.

The first deterministic CI suite should cover at least R01, R04, R05, R09, R13, E01, E02, J01, J03, J05, S01, and S09. Expand to the other cases before a release claim. Passing twelve smoke cases does not imply the remaining cases pass.

For research quality, predefine the audited claim and citation sets. Citation precision denominator is all audited citation-to-claim relationships, not just successful checks. Coverage denominator is the independently identified consequential factual claims requiring evidence, not every sentence and not only cited statements. Report sample size, uncertainty, missing data, and grader method.

Use a separate held-out set for promotional comparisons. No critical observed security/charge/citation-fabrication defect may be averaged away by a good aggregate score. A competitive win must be scoped to the tested tasks, date, budgets, and available products.


## Revision 2 scenarios

**V2-01 — Decisive fact over source count.** A comparison has many summaries and one authoritative compatibility limitation. The controller locates/uses the limitation or marks eligibility unknown; it does not certify compatibility from summary count.

**V2-02 — Source-type saturation.** Two materially different queries return the same underlying source families without coverage gain. The next step changes source route/extraction or records a bounded stop; no repeated broad-search loop.

**V2-03 — Gold-evidence diagnostic.** Evaluate both baseline and enhanced system with and without an independently verified decisive passage. Record whether failure persists with gold evidence; do not misclassify a synthesis failure as retrieval success.

**V2-04 — Relaxed constraint opens candidate space.** A corrected constraint permits an option excluded before discovery. The update searches/re-evaluates the broader set rather than merely re-ranking prior candidates.

**V2-05 — Corrected numeric input.** An input changes unit/date/value. Recompute affected calculations/conclusions and preserve unrelated evidence; old result is not displayed as newly verified.

**V2-06 — Unknown dependency fallback.** Remove a required dependency edge or flag dependency completeness unknown. The executor conservatively revisits the affected scope instead of declaring a safe cheap update.

**V2-07 — Cancellation during writing.** Cancel while report writing is in flight. No new work is issued after the accepted fence; late completion cannot overwrite the cancelled result. Account for unavoidable in-flight cost honestly.

**V2-08 — Stale worker publication.** Expire a lease and assign a new worker; return the old worker result. The old fence cannot publish or double-settle even if it received a valid provider answer.

**V2-09 — Deletion beats historical report retention.** Delete a private attachment while writing and replay its late callback. Original and prohibited derived text in report versions/caches are purged or redacted; only permitted tombstone metadata remains.

**V2-10 — Disappearing source is not automatic falsification.** A previously inspected public source becomes unavailable. Show last-access evidence/rights limitations and unresolved refresh, not a fabricated fresh read or an automatic claim retraction without reason.

**V2-11 — One canonical answer and body.** Concise view and expanded report use the same claim/citation version. A correction cannot leave the summary supporting an option that the body now excludes.

**V2-12 — Stable reading anchor.** Read deep in a report; open source sheet; scale text; close/reopen. Restore the valid block position; explain when the block changed. Test actual iOS and Android.

**V2-13 — Private query canary.** Supply a private document with a canary phrase not authorized for public search. No search request, routine log or cross-user cache includes it.

**V2-14 — Concurrent budget reservations.** Race two branches against remaining allowance. Reservations plus settled/unknown costs stay within the enforceable route policy; uncertainty is not treated as zero.

**V2-15 — Forbidden imports detected.** Introduce mobile-to-provider, core-to-HTTP, cross-domain-write and alias-based forbidden dependencies. The implemented application CI must fail each and allow valid imports.

**V2-16 — Test weakening detected.** Remove/skip a critical regression or broaden its expected outcomes. The change requires explicit review evidence and cannot silently pass the release policy.

**V2-17 — Command readiness truthful.** A proposed script without an implementation cannot be marked runnable or verified. Documentation checking is never counted as native/app/provider testing.

**V2-18 — No feasible answer versus incomplete discovery.** Distinguish a bounded fully inspected candidate set with no eligible option from an inaccessible/incomplete search. State the limit; no universal absence claim.

**V2-19 — Table and visual fidelity.** A decisive detail exists in an unreadable/scanned table. Use the real authorized extraction path or disclose it remains unread; never infer successful review from text parsing.

**V2-20 — Privacy-compatible fallback.** Primary provider fails. Any fallback must satisfy actual consent, geography, capability and cost policy; unsupported routes stay blocked rather than silently downgraded.

## Revision 3 milestone interpretation
The original twelve-case deterministic smoke suite remains unchanged in identity. Persistence/fault cases run against real selected PostgreSQL/queue; semantic fixtures test code paths and are not live-model accuracy proof. `verification/P0_ACCEPTANCE.json` records the separate local, live and per-platform native gates from `IMPLEMENTATION_PLAN.md`. Smoke success alone does not satisfy all relevant publication/authorization/privacy/cost cases or the live/native gates. J02/J14/S12 now distinguish logical deduplication from uncontrolled external delivery. All 90 cases remain specifications, not executed application tests.
