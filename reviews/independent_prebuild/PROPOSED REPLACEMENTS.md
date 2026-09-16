# Proposed replacements — exact text against supplied paths

These are proposals. They become authoritative only if you accept and reconcile them; originals are unchanged. Each entry quotes the exact current text and the exact proposed replacement, scoped to the smallest sufficient edit.

## RC-01 — Grok_Code_Deep_Research_Goal.md, end of §9

**Current text (last two sentences of §9):**

> Keep progress communication brief and tied to meaningful results. Maintain STATUS.md, EXECUTION_LEDGER.md, and HANDOFF.md throughout. Before context limits or session termination, save exact repository state, commands/results, outstanding risks, and the next executable task. Never imply work continues after the execution environment has stopped.

**Proposed replacement (append one paragraph):**

> Keep progress communication brief and tied to meaningful results. Maintain STATUS.md, EXECUTION_LEDGER.md, and HANDOFF.md throughout. Before context limits or session termination, save exact repository state, commands/results, outstanding risks, and the next executable task. Never imply work continues after the execution environment has stopped.
> 
> **Reporting a requirement as `blocked by a named external dependency` — missing credentials, no Mac/signing environment, no store account, no purchase sandbox, no matched competitor account — is a correct and complete outcome for that requirement, not a failure to keep going.** Do not fabricate native evidence, store submission, or purchase-flow verification to avoid reporting a blocker. An honest blocked status for an unreachable item is preferred over any unverified completion claim, every time.

## RC-02 — Grok_Code_Deep_Research_Goal.md, insert before §1

**Current text:** document begins directly with `/goal Build and verify the complete launch-scope iPhone and Android deep-research app...`

**Proposed replacement (insert as a new lead block before the existing `/goal` line):**

> **First-session target, read this before anything else:** the exit criterion for this session is P0 only — one live (not fixture), consented, cancel-and-reopen-safe research request that persists accessed evidence in real Postgres, publishes a bounded cited report, survives app close/reopen, and accepts one correction. Nothing in P3 (native polish, accessibility passes, purchases, store release behavior) begins before that exists and its first deterministic CI suite (R01/R04/R05/R09/R13, E01/E02, J01/J03/J05, S01/S09 per `specs/ACCEPTANCE_TESTS.md`) passes against real Postgres. Building six runtime-role calls, ten shared packages, or a full native navigation shell before that milestone exists is scope creep, not progress — see `IMPLEMENTATION_PLAN.md` P0 and `docs/CURRENT_STATE_AUDIT.md` finding F14.
> 
> /goal Build and verify the complete launch-scope iPhone and Android deep-research app…
> *(remainder of goal prompt unchanged)*

## RC-03 — specs/SETUP_AND_HANDOFF.md, “Minimum backend evidence” section

**Current text:**

> Real selected Postgres/queue configuration with transactional admission, duplicate delivery, lease expiry, cancellation while writing, late outcomes, allowance race and deletion. Record connection mode and permissions; a SQLite/mock test is not equivalent. The read-only hosted baseline must expose only capabilities actually received.

**Proposed replacement:**

> Real selected Postgres/queue configuration with transactional admission, duplicate delivery, lease expiry, cancellation while writing, late outcomes, allowance race and deletion. Record connection mode and permissions; a SQLite/mock test is not equivalent. A locally run Postgres/queue instance (for example via docker compose, with no cloud provisioning) satisfies this requirement for P0 correctness evidence — hosted Supabase/Render provisioning is a deployment concern for P3/P4 and must not block P0’s transactional and fencing evidence. The read-only hosted baseline must expose only capabilities actually received.

## RC-04 — specs/ENGINE_CONTRACTS.md §10, notification paragraph

**Current text:**

> Optional push says a report is ready without sensitive query text. Notification permission is not required for research. Remove token/account binding on logout, rotate stale tokens and de-duplicate notifications. A push is not proof the client has downloaded the report; opening fetches authoritative state.

**Proposed replacement:**

> Optional push says a report is ready without sensitive query text. Notification permission is not required for research. Remove token/account binding on logout, rotate stale tokens and de-duplicate notifications using `runId + completionEpoch` as the idempotent dedupe key, so a crash after send but before delivery-mark cannot produce a duplicate or uncontrolled alert (J14, S12). A push is not proof the client has downloaded the report; opening fetches authoritative state.

## Not proposing a replacement for

`docs/CURRENT_STATE_AUDIT.md` F04/F06 — no text change needed; the table’s own disclaimer (“Paths/line numbers below refer to the original bytes, not shifted lines in this revision”) is already accurate. I recommend a one-line addition to `STATUS.md` instead (not a replacement of existing text, an addition): “F04 and F06 (docs/CURRENT_STATE_AUDIT.md) are resolved in this revision’s ENGINE_CONTRACTS.md §8-9 and ACCEPTANCE_TESTS.md R19; the audit table describes the pre-revision defect they were written against.” This is additive documentation, not a correction of anything wrong in the current bytes.