# P0/P1 findings

## FP-001 — P0 — Clarification rewrites immutable originalQuestion

**Confidence:** CONFIRMED

**Evidence:** apps/backend/src/api/app.ts POST /v1/runs/:id/continue; packages/research-core/src/intent-compiler.ts promises original immutable

**Failure mode:** Same brief can no longer truthfully represent what user originally asked; breaks provenance/replay/corrections

**Required fix:** Keep originalQuestion immutable; pass confirmed clarification constraints as separate model context; create revisioned brief state

**Required test:** Test DB column + payload stay exact original after clarification; task/replay uses confirmed constraints without question rewrite

## FP-002 — P0 — research_briefs.original_question column can diverge from payload.originalQuestion

**Confidence:** CONFIRMED

**Evidence:** /continue updates payload only after mutating brief.originalQuestion

**Failure mode:** Two authoritative question values in one row; stale task digests and audit ambiguity

**Required fix:** Enforce one canonical immutable original; add DB/app consistency check/trigger or remove duplicated mutable representation

**Required test:** Corrupt-one-side test must fail restore/admission

## FP-003 — P0 — Assumption replacement mutates a brief in place without brief revision

**Confidence:** CONFIRMED

**Evidence:** POST /v1/runs/:id/assumptions directly UPDATEs research_briefs payload

**Failure mode:** Existing report/task/model results remain tied to old semantic assumptions while UI shows new assumptions

**Required fix:** Confirm-only may update confirmation metadata; semantic replacement must create a new brief revision/child run or invalidate and re-plan

**Required test:** Replace assumptions after report; old report remains old version; new research creates new revision and cannot reuse stale task

## FP-004 — P1 — Steering/source-policy changes mutate current brief without revision

**Confidence:** CONFIRMED

**Evidence:** /follow-up steer/add_source UPDATE research_briefs payload sourceRestrictions

**Failure mode:** Worker may hold stale brief; already adopted evidence may violate new source policy; audit trail lies

**Required fix:** Persist steering/change-set revision and apply at safe checkpoint; define whether change creates child run or controller revision

**Required test:** Steer during search/read/write; issued requests immutable; future actions respect new policy; old evidence disposition explicit

## FP-005 — P1 — Research task identity is keyed mainly to question/revision, not complete planning semantics

**Confidence:** CONFIRMED

**Evidence:** research_tasks question_digest + same brief revision; assumptions/sourceRestrictions can mutate within revision

**Failure mode:** Task can be reused after semantic state changes

**Required fix:** Persist canonical planning-manifest digest including constraints, assumptions, source policy, expected output, clarification answers

**Required test:** Mutate any planning-relevant field => old task must be stale

## FP-006 — P1 — Run awaiting_input does not persist exact expected input identity/type

**Confidence:** CONFIRMED

**Evidence:** run lifecycle awaiting_input; /continue and query approval independently resume it

**Failure mode:** Wrong endpoint can resume a run; stale approval/clarification race

**Required fix:** Persist pending input object/id/type/revision; require matching input id and transition transactionally

**Required test:** Wrong clarification ID/type, stale approval, concurrent answer/approval tests

## FP-007 — P1 — Generic clarification fields are converted to lowercase hard eq constraints

**Confidence:** CONFIRMED

**Evidence:** /continue body.answers -> field/value -> operator eq, importance hard

**Failure mode:** Budget/date/preference/range/private_search semantics silently corrupted

**Required fix:** Use strict field-specific schemas/operators/normalizers and core MaterialClarificationField definitions

**Required test:** Budget/currency, timeframe, population, platform, yes/no private search, preferences

## FP-008 — P1 — Brief model context omits confirmed constraints, driving original-question rewrite hack

**Confidence:** CONFIRMED

**Evidence:** ModelContextSchema + briefContext(question)

**Failure mode:** Planner/model cannot see confirmed answer except via mutated question

**Required fix:** Extend brief/planning model context with server-owned confirmed constraints/assumptions/source policy

**Required test:** Clarified jurisdiction visible to brief model while original question byte-for-byte unchanged

## FP-011 — P0 — Fallback success is persisted using primary intentId

**Confidence:** CONFIRMED

**Evidence:** model-gateway.ts swaps result/request/policy after altAttempt, final saveModelOperation still uses attempt.intentId

**Failure mode:** Successful failover can fail with model_intent_owner_mismatch; logical operation not replayable

**Required fix:** Track active intentId with active request/result; persist fallback result under fallback intent; create logical operation linkage

**Required test:** Primary transient -> fallback success; crash before save; replay must reuse fallback exactly once

## FP-012 — P0 — Fallback unknown/issued state is not authoritative on replay

**Confidence:** CONFIRMED

**Evidence:** Gateway cached-primary fast path returns before fallback state recovery

**Failure mode:** Restart can surface old primary failure and orphan fallback hold/result

**Required fix:** Persist logical operation attempt chain and restore latest authoritative attempt; unknown fallback HOLD

**Required test:** Primary fails, fallback outcome unknown, process restart, no resend and correct pending/hold

## FP-013 — P0 — Known failed provider intents with null confirmed_micro are treated as unknown liabilities

**Confidence:** CONFIRMED

**Evidence:** settleRun counts confirmed_micro IS NULL regardless state; liveSpendUsedMicro reserves failed-null intents

**Failure mode:** Known 404/no-endpoint failures can reserve allowance indefinitely

**Required fix:** Represent failure cost state explicitly: known-zero/known-cost/unknown-cost; settlement condition by financial state, not null alone

**Required test:** 404 with provider-confirmed zero, 404 cost unknown, transport unknown, 429, malformed response

## FP-014 — P0 — Invalid-output repair can issue a second paid call when first attempt cost/outcome is unknown

**Confidence:** CONFIRMED

**Evidence:** createResearchDraft and ensureResearchTask retry status invalid_output; providerIntentStateForResult may classify null-cost invalid output as outcome-unknown

**Failure mode:** Blind financial retry violates unknown HOLD invariant

**Required fix:** Repair only if prior financial state is confirmed/known; otherwise terminal/pending hold

**Required test:** Schema invalid with actualMicro null must not send repair; with confirmed cost may repair once

## FP-015 — P1 — Operation-aware reserve can be clamped below planned request worst-case

**Confidence:** CONFIRMED

**Evidence:** reserveMicroForOperation caps against legacy STRUCTURED_CALL_RESERVE_MICRO while write allows 8192 output

**Failure mode:** Under-reservation; budget may admit a call whose configured max cost exceeds reserved amount

**Required fix:** Reserve >= computed max input/output cost + margin; cap should be an admission ceiling, not a smaller legacy reserve

**Required test:** Max-sized write_report request reserve >= worst-case price

## FP-016 — P1 — Context admission should account input + max output against model context

**Confidence:** HIGH

**Evidence:** token-budget/openrouter paths

**Failure mode:** Large input plus large write output can exceed model context even if input alone passes

**Required fix:** Explicit inputTokens + outputTokens + schema/system margin <= context limit

**Required test:** Boundary tests per operation/policy

## FP-018 — P1 — Production gateway still uses run-level model policy for all operations

**Confidence:** CONFIRMED

**Evidence:** performModelOperation -> runModelPolicy; resolveOperationRoute not production selector

**Failure mode:** No real per-operation model governor despite architecture claims

**Required fix:** Persist per-operation route decision before reserve; route by operation/context/privacy/budget

**Required test:** Same run routes brief/extract/write to distinct approved policies in deterministic test

## FP-019 — P1 — All production policies use same underlying gpt-4o-mini tier

**Confidence:** CONFIRMED

**Evidence:** portfolio.ts

**Failure mode:** No quality escalation or genuine multi-model capability

**Required fix:** Benchmark/register distinct approved tiers or explicitly scope Beta to single-model routing

**Required test:** No superiority/multi-model claim unless real routes execute

## FP-022 — P0 — Unknown query tokens fall through as user-public

**Confidence:** CONFIRMED

**Evidence:** query-intelligence.ts classifyQueryTerms default

**Failure mode:** Model-invented/private-adjacent term can be sent publicly without provenance

**Required fix:** Unknown term must be blocked/unclassified unless user question, safe app expansion, approved private term, or public-evidence-derived

**Required test:** Model query adds invented term => blocked; public evidence term => allowed with provenance

## FP-023 — P1 — Approved query does not consume/close pending permission row

**Confidence:** CONFIRMED

**Evidence:** approveQueryAuthorization inserts approved row; pending permission_required remains

**Failure mode:** GET run can keep showing stale pending approval; repeated approvals duplicate

**Required fix:** State machine pending->approved/denied with single durable authorization row or superseding pointer

**Required test:** Approve once clears pending; replay idempotent; stale revision denied

## FP-024 — P1 — Approved private terms are aggregated across all queries in a revision

**Confidence:** CONFIRMED

**Evidence:** loadApprovedPrivateTerms unions terms

**Failure mode:** Term approved for one query can silently be reused in a different query

**Required fix:** Decide exact semantics; V8.1 promised exact query+term scope, so authorize by digest/action not global term union

**Required test:** Approve term X for query A; query B containing X still needs approval unless explicit reusable permission

## FP-025 — P1 — Gate A can treat any approved row for revision as generic public-search approval

**Confidence:** CONFIRMED

**Evidence:** hasPublicQueryApproval without digest/terms

**Failure mode:** Coarse approval can weaken future paths

**Required fix:** Every public query must authorize exact query/provenance; remove blanket Gate A except explicit user policy

**Required test:** Search 2 cannot borrow Search 1 approval

## FP-026 — P1 — query_authorizations lacks state CHECK and uniqueness/idempotency constraints

**Confidence:** CONFIRMED

**Evidence:** migration 043

**Failure mode:** Duplicate/invalid pending/approved rows possible under race

**Required fix:** CHECK kind/permission_required relationship; unique/supersession per run/revision/query digest

**Required test:** Concurrent approval and duplicate pending creation

## FP-027 — P1 — Attachment-backed counterevidence path appears to block categorically rather than consume exact approval

**Confidence:** HIGH

**Evidence:** counterevidence/document-search approval flow

**Failure mode:** Private-doc research may never get full challenge after user approval

**Required fix:** Use exact query authorization path for counterevidence too

**Required test:** Approved exact private term permits one counterevidence query, no broader leak

## FP-029 — P0 — Azure ZDR live search still uses maxResults=3

**Confidence:** CONFIRMED

**Evidence:** ports/search.ts discoveryPolicyForNewSearch returns AZURE_DISCOVERY_POLICY v2; Azure policy copied from v1

**Failure mode:** Real live production path contradicts PASS claim of 8 results/query

**Required fix:** Create Azure ZDR v3 policy with maxResults=8 (or task-aware value) and immutable versioning

**Required test:** Azure live policy body asserts correct max_results; frozen old versions unchanged

## FP-030 — P1 — Queries/classesAttempted/iteration/Evidence Needs are process-local

**Confidence:** CONFIRMED

**Evidence:** structured-research.ts initializes arrays/counters each invocation

**Failure mode:** Crash/redelivery resets adaptive strategy and bounds; can repeat/deviate

**Required fix:** Persist controller/action state or reconstruct fully from durable operations/events

**Required test:** Crash after query 2/read; restart chooses query 3, not repeats; ceilings survive restart

## FP-031 — P1 — for iteration<4 bound resets on worker restart

**Confidence:** CONFIRMED

**Evidence:** structured-research.ts

**Failure mode:** Run can exceed conceptual loop bound after crashes

**Required fix:** Persistent action counter/stop state

**Required test:** Repeated crash cannot exceed configured bound

## FP-032 — P1 — Discovery decision uses stale run.spent_micro snapshot

**Confidence:** CONFIRMED

**Evidence:** structured-research.ts cached run

**Failure mode:** Planner can keep proposing work after spend changed; reserve layer saves money but wastes cycles

**Required fix:** Refresh financial state before each continuation decision or derive from ledger

**Required test:** Spend changes mid-run reflected in next decision

## FP-033 — P1 — Finished full-text source is reported readable=false

**Confidence:** CONFIRMED

**Evidence:** source-reading.ts returns readable: accessLevel === partial-text

**Failure mode:** Good full-text reads can be treated as unavailable

**Required fix:** Readable for partial-text OR full-text

**Required test:** Full-text read integration test

## FP-034 — P1 — Thrown source-read errors can reject whole Promise.all batch

**Confidence:** HIGH

**Evidence:** readAdoptedSources only handles non-read return values

**Failure mode:** One operational source exception can abort otherwise viable research

**Required fix:** Classify per-source degradable errors vs security/stale/cancel errors; use settled batch semantics

**Required test:** One fetch timeout + two valid sources => continue; LostWorkerLease still propagates

## FP-035 — P1 — Issued source read without persisted operation can replay pending forever

**Confidence:** HIGH

**Evidence:** source_read_operations issued row + no finished row path

**Failure mode:** Crash after network read/issue can deadlock run

**Required fix:** Persist explicit unknown/failed state and recovery/terminal behavior

**Required test:** Crash between network and result commit; replay does not spin pending forever

## FP-039 — P1 — Domain policy is enforced on discovered locator, not clearly on final redirect URL

**Confidence:** HIGH

**Evidence:** search adoption vs safeFetch redirect

**Failure mode:** Allowed/trusted hit may redirect to excluded domain and still be ingested

**Required fix:** Reapply source policy after final redirect; store requested+final URL

**Required test:** Allowed.com -> excluded.com redirect blocked or marked

## FP-040 — P1 — prefer_primary behaves as primary-only exclusion

**Confidence:** CONFIRMED

**Evidence:** source-policy.ts applySourcePolicy

**Failure mode:** Legitimate independent sources are discarded instead of de-prioritized

**Required fix:** Separate rank preference from allow/deny; fallback to secondary if primary inadequate

**Required test:** prefer_primary keeps secondary candidates but ranks/uses primary first

## FP-041 — P1 — Official-host heuristic is mainly gov/intergovernmental

**Confidence:** CONFIRMED

**Evidence:** source-policy.ts

**Failure mode:** Vendor docs/standards/project docs incorrectly excluded from primary strategy

**Required fix:** Classify primary by source class/entity relationship, not hostname suffix alone

**Required test:** Apple/NVIDIA/Python/SEC/standards cases

## FP-042 — P1 — userSuppliedUrls/source policy is persisted but not actually fetched by structured worker

**Confidence:** CONFIRMED

**Evidence:** source-policy/steering vs structured-research

**Failure mode:** 'Check this URL too' can appear accepted without reading URL

**Required fix:** First-class URL ingestion action through safe fetch/source identity pipeline

**Required test:** Add URL during run -> actual source read, event, evidence membership

## FP-043 — P1 — Freshness unknown is not considered unmet

**Confidence:** CONFIRMED

**Evidence:** sourcesHaveUnmetFreshness only checks stale

**Failure mode:** Undated current-price/legal/version evidence can satisfy stop logic

**Required fix:** For policies requiring date/version, unknown must remain unmet/uncertain

**Required test:** Current price with no source date continues/publishes limitation, not 'fresh'

## FP-044 — P1 — Strategy sources carry publicationDate only; legal effectiveDate/version absent

**Confidence:** CONFIRMED

**Evidence:** loadRunStoredSources + freshness policy

**Failure mode:** Law/compatibility freshness requirements cannot actually be proven

**Required fix:** Persist/propagate retrievedAt/effectiveDate/version with provenance

**Required test:** Legal and compatibility end-to-end freshness tests

## FP-049 — P1 — Evidence Needs are transient helpers, not durable adaptive state

**Confidence:** CONFIRMED

**Evidence:** evidence-needs.ts + structured-research.ts

**Failure mode:** Does not meet V8.1 'durable Evidence Needs' claim; restart loses state; query hints all same

**Required fix:** Persist need lifecycle/status/evidence/action/stop reason; rebuild from durable events; criterion-specific strategy

**Required test:** Crash/restart preserves needs; evidence changes update one need; next action changes

## FP-051 — P0 — Candidate ledger module is not wired/persisted in production structured worker

**Confidence:** CONFIRMED

**Evidence:** candidate-ledger.ts; no worker usage found

**Failure mode:** Matrix says decision candidate completeness is real when it is not

**Required fix:** Integrate canonical candidate ledger into extraction/discovery/correction; persist candidate states and exclusion evidence

**Required test:** Purchase task discovers/inspects/excludes; relaxed budget reopens exclusions and discovers new candidates

## FP-052 — P1 — candidate-ledger can mark bounded-complete based on caller flag without proof

**Confidence:** CONFIRMED

**Evidence:** candidate-ledger/candidate helpers

**Failure mode:** Future wiring could overclaim 'best' universe

**Required fix:** Completeness must derive from bounded universe/search coverage/stop proof

**Required test:** Cannot mark complete from one search with arbitrary boolean

## FP-053 — P0 — Per-conclusion falsification helper is not wired into production

**Confidence:** CONFIRMED

**Evidence:** falsification helper vs structured worker; counterevidence is one run-level check

**Failure mode:** Matrix says targeted falsification is real when only coarse counterevidence runs

**Required fix:** Persist conclusion challenge objects per consequential conclusion and source strategy

**Required test:** Two consequential conclusions produce independent challenge state/results

## FP-054 — P1 — Counterevidence is unique per run/revision/version, not per conclusion

**Confidence:** CONFIRMED

**Evidence:** migration 030 UNIQUE(run,brief,version)

**Failure mode:** Cannot represent independent falsification history for multiple conclusions

**Required fix:** Key challenges by conclusion/claim revision + challenge version, bounded by policy

**Required test:** Multiple claims challenged without overwriting each other

## FP-055 — P1 — Only fully supported claims are primary challenge targets

**Confidence:** HIGH

**Evidence:** production flow/support selection

**Failure mode:** Partially supported consequential claims may escape targeted falsification

**Required fix:** Policy based on consequentiality, uncertainty, and decision impact

**Required test:** Partially-supported decisive claim receives challenge

## FP-056 — P1 — 'Hybrid semantic' compiler is still local regex/rules; external semantic overlay not production-called

**Confidence:** CONFIRMED

**Evidence:** semantic-intent.ts; no production model overlay call found

**Failure mode:** Product can fail messy natural-language jobs while matrix implies semantic generality

**Required fix:** Add cheap structured semantic compile operation with exact provenance validation, or rename honestly and expand parser

**Required test:** Held-out typos/multi-intent/unknown entities/general decision tasks

## FP-060 — P0 — Reconciliation outcome is lexical overlap/number/regex heuristic, not scoped semantic support

**Confidence:** CONFIRMED

**Evidence:** reconciliation.ts + reconcileOwnedDocumentClaims

**Failure mode:** Matrix RB-REC-01 overclaims semantic verification; false confirmation/contradiction possible

**Required fix:** Use same support/reconciliation model+deterministic scope/number/date guards; lexical only triage

**Required test:** Private doc claim vs paraphrase/negation/scope/date/version adversarial cases

## FP-061 — P1 — Only first 24 public passages and first 8 claims are reconciled

**Confidence:** CONFIRMED

**Evidence:** retrieval-intelligence.ts

**Failure mode:** Silent omission of claims/evidence

**Required fix:** Bound by decision importance with explicit unresolved coverage, not arbitrary silent slice

**Required test:** >8 claims / decisive passage >24 remains visible as unresolved

## FP-062 — P1 — repairSupportAssessments synthesizes supported assessments for omitted writer rows

**Confidence:** CONFIRMED

**Evidence:** model-span-resolution/repair helper

**Failure mode:** Application can invent semantic review the model did not provide

**Required fix:** Missing assessment must remain missing/invalid unless deterministic proof fully substitutes under explicit versioned policy

**Required test:** Omitted heading/paragraph assessment fails closed; repair request may re-assess

## FP-063 — P1 — repairCoverageReview can synthesize missing question rows when some review exists

**Confidence:** CONFIRMED

**Evidence:** repair helper

**Failure mode:** Application infers reviewer coverage state

**Required fix:** Require complete model review or explicitly deterministic coverage from checked claims; don't mix silently

**Required test:** Partial model review missing critical question cannot become supported automatically

## FP-064 — P1 — Write-from-prior can publish using prior evidence after later unread evidence with generic limitation

**Confidence:** HIGH

**Evidence:** research-writer historical path

**Failure mode:** Later evidence may be materially contradictory but report still reuses old conclusion

**Required fix:** Track criterion dependency and why later evidence is unread; only reuse unaffected claims; otherwise unresolved

**Required test:** Later unread source tied to decisive criterion prevents stale conclusion

## FP-065 — P1 — Null/category-only claim inventory contradiction bug was recently repaired but full suite not re-proven

**Confidence:** CONFIRMED

**Evidence:** scoped-support extraPassages, STATUS

**Failure mode:** Regression-prone support gate

**Required fix:** Keep new test and rerun full suite twice after fix pass

**Required test:** Null-scope contradiction in omitted selected passage

## FP-068 — P0 — completed_with_limitations bypasses ordinary structured coverage restoration

**Confidence:** CONFIRMED

**Evidence:** publication-coverage.ts: if report.outcome != completed return true after special checks

**Failure mode:** Outcome label can bypass exact question/criterion coverage proof; degraded report can publish without machine-proving all unresolved critical requirements are disclosed

**Required fix:** Define limited-publication proof: restore coverage, map every unresolved/blocked critical question to explicit limitation, verify exact blocks/claims

**Required test:** Craft limited report missing one unresolved critical criterion => reject

## FP-069 — P1 — Unsupported writer heading can be replaced with generic 'Answer'

**Confidence:** CONFIRMED

**Evidence:** draft-report writer heading salvage

**Failure mode:** Hides writer defect and degrades structure; can enable publication by changing semantics

**Required fix:** Reject/repair heading with validator error; deterministic fallback only for non-semantic decorative labels with explicit version

**Required test:** Numeric/factual/claim headings never salvaged; repair gets reason

## FP-070 — P1 — Repair prompt does not receive exact validator errors

**Confidence:** CONFIRMED

**Evidence:** repairPass prompt path

**Failure mode:** Second paid call can repeat same defect

**Required fix:** Provide bounded redacted structural failure codes/paths, not sensitive raw values

**Required test:** First call invalid span/unsupported heading -> repair receives code and fixes

## FP-071 — P1 — Live wide-task writer still produces caveat/unpublished useful facts

**Confidence:** CONFIRMED

**Evidence:** J11 artifacts/status

**Failure mode:** Core user abandonment risk remains

**Required fix:** Fix synthesis grounding so it restates approved claims exactly enough to publish useful answer; hierarchical synthesis for wide jobs

**Required test:** Live wide purchase/EV task with audited claims produces useful report

## FP-072 — P1 — Hierarchical synthesis is not default production path

**Confidence:** CONFIRMED

**Evidence:** status/modules

**Failure mode:** Complex jobs constrained by one-shot writer/output

**Required fix:** Section/evidence hierarchy when complexity threshold warrants; final global citation/consistency review

**Required test:** Large task with >N claims produces complete report under context budget

## FP-073 — P1 — Current calculated-report integration remains red

**Confidence:** HIGH

**Evidence:** STATUS at 906 focused failures

**Failure mode:** Arithmetic path not regression-safe

**Required fix:** Root-cause remaining completed/completed_with_limitations and unsupportedProse failures; do not change expectations blindly

**Required test:** Full PG 480/480 twice; arithmetic adversarial cases

## FP-077 — P0 — Mobile ignores typed sanitized activity and renders legacy type/publicSummary fields

**Confidence:** CONFIRMED

**Evidence:** backend /events returns activity + raw fields; mobile UiState.events omits activity; research-activity maps legacy

**Failure mode:** Typed safe event contract is not authoritative; privacy/truth improvements not actually wired

**Required fix:** Make mobile consume only typed activity for progress UI; keep raw fields internal/non-returned where not needed

**Required test:** Private-looking summary never reaches UI when activity null; typed source metadata renders

## FP-078 — P1 — /events still returns raw publicSummary even when sanitizer exists

**Confidence:** CONFIRMED

**Evidence:** api/app.ts

**Failure mode:** Sanitizer cannot serve as privacy boundary

**Required fix:** Return versioned sanitized event DTO; omit/redact raw summary/payload to consumer API

**Required test:** CoT/private canary/raw URL payload absent from response

## FP-079 — P1 — accepted event maps to intent_ready

**Confidence:** CONFIRMED

**Evidence:** public-activity.ts

**Failure mode:** UI can claim intent ready before compilation

**Required fix:** Separate accepted vs intent_compiled

**Required test:** Event ordering test

## FP-080 — P1 — research_unresolved maps to plan_pivot

**Confidence:** CONFIRMED

**Evidence:** public-activity.ts

**Failure mode:** Failure/unresolved can look like healthy plan update

**Required fix:** Dedicated unresolved/failed kind with user-safe wording

**Required test:** Unresolved event shows limitation/failure, not pivot

## FP-083 — P1 — Stale permission_required row can keep pending approval visible after approve

**Confidence:** CONFIRMED

**Evidence:** backend pending row behavior + mobile snap

**Failure mode:** User can be asked twice / UI stuck

**Required fix:** Consume pending row and refresh exact state

**Required test:** Approve -> pending null immediately and after cold reopen

## FP-084 — P1 — UI assumption edit uses in-place backend mutation

**Confidence:** CONFIRMED

**Evidence:** api.confirmAssumptions + backend

**Failure mode:** Same report can appear under changed assumptions

**Required fix:** Use revisioned correction/clarification flow; show version transition

**Required test:** Edit assumption on completed report creates new research version

## FP-085 — P1 — Physical Android IME suggestion bar covers send control

**Confidence:** CONFIRMED

**Evidence:** v8k QA/status

**Failure mode:** Core composer action inaccessible/obscured

**Required fix:** Fix keyboard insets/controller before UI phase; current issue is functional, not visual polish

**Required test:** Physical device Gboard/suggestion bar screenshot/action

## FP-088 — P1 — RB-PERF-01 marked PASS despite explicitly unmeasured multi-thousand-line live report

**Confidence:** CONFIRMED

**Evidence:** acceptance matrix

**Failure mode:** Verification process overstates readiness

**Required fix:** Set PARTIAL/FAIL until target corpus/device benchmark passes

**Required test:** Matrix generation must reject self-contradictory evidence text

## FP-089 — P1 — Deleted-account check is inconsistent across endpoints

**Confidence:** CONFIRMED

**Evidence:** api/app.ts some !a||a.deleted, many !a only

**Failure mode:** Post-delete reads/actions behave inconsistently; relies on downstream guards

**Required fix:** Centralize auth to reject deleted identity by default; explicit reconciliation-only exceptions server-internal

**Required test:** Deleted token cannot access events/library/report/settings/cost/cancel

## FP-090 — P1 — Several V8 endpoints use raw TS casts rather than strict schemas

**Confidence:** CONFIRMED

**Evidence:** continue, assumptions, query approval, follow-up pre-routing, events after

**Failure mode:** Malformed/oversize/unknown fields can alter behavior or produce 500s

**Required fix:** Zod strict schemas + length/enums/normalization

**Required test:** Fuzz unknown fields, huge strings/arrays, invalid unicode/numbers

## FP-092 — P1 — Server creates random idempotency key if /runs header omitted

**Confidence:** CONFIRMED

**Evidence:** POST /v1/runs

**Failure mode:** Network retry by non-mobile client can create duplicate paid run

**Required fix:** Require idempotency key for controlled-research (and ideally all non-fixture admissions)

**Required test:** Missing header => 400; replay exact => reuse; changed payload => conflict

## FP-093 — P1 — Repeated approval can create multiple approved rows

**Confidence:** CONFIRMED

**Evidence:** approve endpoint + schema

**Failure mode:** Duplicate state/audit noise and ambiguous latest permission

**Required fix:** Idempotent transition using pending ID unique state

**Required test:** Approve twice same request returns reused

## FP-096 — P1 — model_portfolio_resolutions has no FKs to run/account

**Confidence:** CONFIRMED

**Evidence:** migration 042

**Failure mode:** Audit rows can orphan/mismatch identity if code bug; manual deletion required

**Required fix:** Add FKs where compatible, plus ownership integrity/immutable trigger

**Required test:** Insert foreign/mismatched resolution rejected

## FP-097 — P1 — research_briefs duplicated original/revision semantics lack DB consistency guard

**Confidence:** CONFIRMED

**Evidence:** schema + app bug

**Failure mode:** Already caused divergence

**Required fix:** Trigger/check/canonical serializer; immutable original column

**Required test:** Payload/column divergence rejected

## FP-101 — P0 — Acceptance matrix contains PASS rows contradicted by current code/evidence

**Confidence:** CONFIRMED

**Evidence:** 35_ACCEPTANCE_MATRIX.csv

**Failure mode:** Can falsely authorize merge/Research Beta

**Required fix:** Regenerate matrix only after fix pass from machine-readable evidence; no self-certified PASS from helper existence

**Required test:** Gate script validates evidence class and current SHA

## FP-102 — P0 — RB-INTENT-01 immutable originalQuestion PASS is false

**Confidence:** CONFIRMED

**Evidence:** matrix vs /continue

**Failure mode:** Readiness lie

**Required fix:** Mark FAIL until FP-001/002 fixed

**Required test:** Test exact original survives clarification

## FP-103 — P0 — RB-REC-01 semantic reconciliation PASS is false

**Confidence:** CONFIRMED

**Evidence:** matrix vs reconciliation.ts lexical algorithm

**Failure mode:** Readiness lie

**Required fix:** Mark FAIL until semantic reconciliation wired

**Required test:** Adversarial semantic reconciliation

## FP-104 — P0 — RB-CAND-01 persisted candidate completeness PASS is false

**Confidence:** CONFIRMED

**Evidence:** matrix vs unused helper

**Failure mode:** Readiness lie

**Required fix:** Mark FAIL until production/persistence

**Required test:** Production candidate ledger evidence

## FP-105 — P0 — RB-EVIDENCE-01 durable Evidence Needs PASS is false

**Confidence:** CONFIRMED

**Evidence:** matrix vs pure transient helper

**Failure mode:** Readiness lie

**Required fix:** Mark FAIL/PARTIAL

**Required test:** Crash/restart persistence

## FP-106 — P0 — RB-FALSIFY-01 per-conclusion falsification PASS is false

**Confidence:** CONFIRMED

**Evidence:** matrix vs unused helper/run-level challenge

**Failure mode:** Readiness lie

**Required fix:** Mark FAIL/PARTIAL

**Required test:** Per-conclusion durable challenge

## FP-107 — P0 — RB-SOURCEPOL-01 direct URL path PASS is false/incomplete

**Confidence:** CONFIRMED

**Evidence:** matrix vs source policy only; worker doesn't fetch user URL

**Failure mode:** Readiness lie

**Required fix:** Mark PARTIAL until actual ingestion

**Required test:** Direct URL live/fixture path

## FP-108 — P0 — RB-SEARCH-01 8-result live deep search is false on Azure path

**Confidence:** CONFIRMED

**Evidence:** matrix vs Azure v2 maxResults 3

**Failure mode:** Readiness lie

**Required fix:** Fix Azure v3 then rerun live

**Required test:** Provider body audit

## FP-109 — P0 — RB-PERF-01 PASS is unsupported

**Confidence:** CONFIRMED

**Evidence:** matrix explicitly says multi-thousand live report not measured

**Failure mode:** Readiness lie

**Required fix:** Mark PARTIAL until benchmark

**Required test:** Long report device metrics

## FP-110 — P0 — RB-API-01 typed activity PASS is not fully wired to mobile

**Confidence:** CONFIRMED

**Evidence:** matrix vs mobile legacy event state

**Failure mode:** Safety/truth contract not authoritative

**Required fix:** Mark PARTIAL until mobile consumes DTO

**Required test:** API/mobile contract test

## FP-111 — P0 — RB-NATIVE-02 PASS despite send control occluded by IME

**Confidence:** CONFIRMED

**Evidence:** matrix/status

**Failure mode:** Core interaction broken on tested device

**Required fix:** Treat as FAIL/PARTIAL until fixed

**Required test:** Physical device

## FP-112 — P1 — Clarification test rewards rewritten question indirectly by requiring report contain geography

**Confidence:** CONFIRMED

**Evidence:** p3-remaining clarification tests

**Failure mode:** Can normalize invariant-breaking implementation

**Required fix:** Assert original unchanged + constraints separately + report uses constraint

**Required test:** Regression test architecture not symptom

## FP-113 — P1 — Assumption endpoint test only checks mutation visible, not revision/report invalidation

**Confidence:** CONFIRMED

**Evidence:** p3-remaining

**Failure mode:** Encodes dangerous in-place mutation as success

**Required fix:** Rewrite test for semantic versioning

**Required test:** Old report vs new assumption

## FP-114 — P1 — History of live salvage repeatedly weakened fail-closed gates before later repairs

**Confidence:** CONFIRMED

**Evidence:** STATUS/commit history

**Failure mode:** High recurrence risk

**Required fix:** Audit every assertion changed in salvage commits; require two-reviewer/root-cause mapping in fix pass

**Required test:** Full PG twice; mutation tests around support/coverage

## FP-115 — P0 — Full PG remains red at reviewed checkpoint; latest 906 has only focused retest evidence

**Confidence:** CONFIRMED

**Evidence:** STATUS / integration-int9 473/7 and 906 message

**Failure mode:** Cannot merge or declare Beta

**Required fix:** Fix root causes and run complete suite on fresh DB twice

**Required test:** 480/480 twice at exact final SHA

## FP-116 — P1 — Calculated-report cases remain red

**Confidence:** CONFIRMED

**Evidence:** 906 STATUS focused retest

**Failure mode:** Arithmetic path incomplete

**Required fix:** Root-cause fix, no expectation weakening

**Required test:** Calculated writer variants + parent/child correction
