W05 COUNTEREVIDENCE — ROOT HANDOFF DRAFT

Owner/files: new packages/contracts/src/counterevidence.ts; pure packages/research-core/src/counterevidence.ts; backend modules/counterevidence.ts and worker/counterevidence.ts; migration030; their core/gateway tests. Additive integration changes: contract/core exports, config, public-search, structured-research, research-writer, publication-coverage, account deletion. Pinned search body/digest implementation moved unchanged into ports/search.ts and re-exported from the existing adapter, permitting domain receipt validation without importing a vendor adapter. No dependency/service/model/prompt/allowance change. No commit/deploy/paid call.

Suggested ADR025 / canonical engine text:
Counterevidence.v1 adds a default-off STRUCTURED_CHALLENGE_ENABLED production action. The deterministic selector targets up to six initially supported assertions for one consequential question and records the exact counterevidence question, original claim revisions, assertion/scopes and initial evidence digest before any new reading. This is a bounded selected-target check, not proof that every claim was challenged. It executes one admitted public search, durable source reads and assess_support through the existing gateway, followed by independent scope/number/qualification/contradiction guards against all selected authorized evidence. Search receipts, read operations/source versions, final evidence digest, checker version and computed outcome persist. Original extraction/support receipts and claim revisions are restored independently of fresh extraction; an extractor cannot erase the original target by omitting it later.

Allowed outcomes: counterevidence_found; no_counterevidence_found_in_inspected_evidence; blocked; unresolved_at_limit; outcome_unknown. No counterexample found is bounded inspected-evidence information, never proof. Missing access or unknown search/model spend remains explicit; unknown attempts keep their reservations and are never blindly resent. An event cannot supply an execution result.

Publication independently restores target, receipt and support proof. Contradicted, qualified, unknown or stale targets produce target-specific canonical report limitations even if fresh extraction omits them and the model gives optimistic coverage. A server-owned runs.counterevidence_required_revision is set atomically with target capture and survives loss of the derived check row; missing required proof prevents completion. This gate runs before the historical/no-task compatibility path. A missing required record also stops production before unrelated discovery. Existing default-off/legacy writer contexts are preserved.

Query privacy/security impact:
A separate strict transformed-search schema permits exactly the original-question provenance span plus the closed application suffix 'contradictions limitations exceptions'. The executable transformed query is revalidated before spend admission. No source text, target claim wording, private document excerpt, arbitrary query expansion or model authority is accepted. Mixed attachment/public search remains blocked until a separate explicit disclosure flow exists. The query shares the existing three-search durable run ceiling and project/account/key reservations; no added allowance or external connector. Replayed challenge search receipts are excluded from the ordinary initial-discovery trigger, avoiding an extra original-question search on restart. Finished read versions replay without network; current evidence revision still determines extraction/support reuse.

Deletion and rollback:
Account deletion purges counterevidence_checks before raw/derived evidence and model records. The required-revision integer contains no private text. Keep requirement/result readers, publication vetoes, deletion, receipt settlement and unknown holds when disabling new invocations; do not drop the table or erase already-admitted requirement markers. STRUCTURED_CHALLENGE_ENABLED=false disables new scheduling; STRUCTURED_MODEL_ENABLED=false remains broader rollback. Migration030 is additive/idempotent; no destructive down migration.

Evidence scope:
New tests are real local PostgreSQL + production API/worker modules with synthetic source text and fabricated provider/read transports. They prove orchestration, ownership/revision/proof boundaries and deterministic rejection, not live semantic research quality, independent adjudication, useful held-out discovery or actual extraction quality. Existing extraction suite must run separately. Default-off activation and W08/W09 quality evaluation remain explicit gates. User feedback POST /reports/:id/challenges is still feedback storage, not requested-verification scheduling; that separate W06/W07 behavior remains open.

Focused tests cover contradictory/qualified/supportive controls; optimistic model omitted-counterevidence veto; original target omission on re-extraction; pause/restart with existing reads and one search; missing result / legacy/default-off and event-only; altered original revision and forged stored result; private query terms; unknown search and model receipts/no resend; multi-connection concurrent calls/shared query ceiling; stale cancellation and complete deletion. Tests were added without reducing prior assertions.

Failures retained:
- counterevidence-typecheck-initial.log: exit2, duplicate spread kind and implicit reads[] type; fixed.
- counterevidence-focused-initial.log: exit1, 7/8 passed; new test queried nonexistent provider_intents.kind; corrected via run_actions join.
- counterevidence-focused-third.log: exit1, 12/13 passed; missing actual model receipt labeled unresolved instead of outcome_unknown; fixed real outcome classification.
- counterevidence-focused-fourth.log: exit1, 12/14 passed; restart performed unnecessary ordinary initial discovery after challenge search; fixed real query-purpose integration.
Successful intermediary logs:
- counterevidence-typecheck-second/third/fourth/final.log: exit0 (last before final requirement/replay hardening).
- counterevidence-focused-second.log: exit0, 8/8 selected,119 skipped.
- counterevidence-focused-final.log: exit0,132/132 (before final missing-record/replay hardening).
- counterevidence-focused-fifth.log: exit0,14/14 selected,119 skipped (before trivial gate ordering/event-only assertion addition).
- counterevidence-verify.log: exit0,148 core/99 backend/60 mobile/6 governance; before final hardening.
Final combined runs in progress:
- pnpm test:integration -> counterevidence-integration-final.log (session6132)
- pnpm verify -> counterevidence-verify-final.log (session29555)
Root should use their terminal outcomes/counts once reported; do not infer completion from this draft.
