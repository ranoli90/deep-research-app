# Controller admission (foundation)

Goal: every proposed research action (fixture, live baseline, model) is admitted by one application-owned function before execution.

Non-goals: multi-agent swarms, live OpenRouter planner spend, iOS/hosted/store gates.

Contracts: ActionTypeSchema, TOOL_ALLOWLIST, canPublish, live spend reservation.

Migration: `004_gap_payload.sql` adds `evidence_gaps.payload` jsonb.

Privacy/spend: live provider intents are inserted as `issued` before the HTTP call; unknown/failed issued calls keep the reservation.

Tests: `packages/research-core/test/admission.test.ts`, `apps/backend/test/admission.unit.test.ts`, `apps/backend/test/controller-admission.integration.test.ts`.

Rollback: revert the admission module and keep `authorizeAction` callers on the previous allowlist-only path.
