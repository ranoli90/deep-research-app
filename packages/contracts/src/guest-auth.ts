import { z } from "zod";

const Uuid = z.string().uuid();
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Version = z.number().int().positive();
const Text = z.string().min(1).max(4000).refine((text) => Boolean(text.trim()));

export const GuestPendingPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new_research"), text: Text }).strict(),
  z.object({ kind: z.literal("follow_up"), text: Text, parentRunId: Uuid }).strict(),
  z.object({ kind: z.literal("clarification"), text: Text, pendingInputId: Uuid,
    briefRevision: Version, field: z.string().min(1).max(80) }).strict(),
]);
export type GuestPendingPayload = z.infer<typeof GuestPendingPayloadSchema>;

/** Same canonical array form as the protected native guest-pending-action.v2 journal. */
export function canonicalGuestPendingPayload(payload: GuestPendingPayload): string {
  switch (payload.kind) {
    case "new_research": return JSON.stringify([payload.kind, payload.text]);
    case "follow_up": return JSON.stringify([payload.kind, payload.text, payload.parentRunId]);
    case "clarification": return JSON.stringify([payload.kind, payload.text, payload.pendingInputId, payload.briefRevision, payload.field]);
  }
}

export const GuestBootstrapRequestSchema = z.object({}).strict();
export const GuestBootstrapResponseSchema = z.object({
  guestContextId: Uuid, conversationId: Uuid, conversationVersion: Version,
  proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.string().datetime({ offset: true }),
  consentPolicyVersion: z.string().min(1), firstTurnAvailable: z.boolean(),
}).strict();
export const GuestPendingActionRequestSchema = z.object({
  submissionId: Uuid, guestContextId: Uuid, conversationId: Uuid, conversationVersion: Version,
  payload: GuestPendingPayloadSchema, payloadDigest: Digest,
  consentPolicyVersion: z.string().min(1),
}).strict();
export const GuestClaimRequestSchema = z.object({
  claimRequestId: Uuid, submissionId: Uuid, guestContextId: Uuid,
  conversationId: Uuid, conversationVersion: Version, authAttemptId: Uuid,
}).strict();
export const GuestAuthAttemptBeginRequestSchema = z.object({
  submissionId: Uuid, authAttemptId: Uuid, provider: z.enum(["apple", "google", "email_code"]),
}).strict();
export const GuestAuthAttemptEndRequestSchema = z.object({
  submissionId: Uuid, authAttemptId: Uuid, reason: z.enum(["cancelled", "dismissed"]),
}).strict();
export const GuestAuthAttemptResolveRequestSchema = z.object({ submissionId: Uuid, authAttemptId: Uuid }).strict();
export const GuestPendingActionCancelRequestSchema = z.object({ submissionId: Uuid }).strict();
export const GuestClaimedActionAbandonRequestSchema = z.object({ submissionId: Uuid, claimRequestId: Uuid }).strict();
/** Explicit new Send after a claimed clarification answer was abandoned. */
export const GuestMemberActionRegisterRequestSchema = z.object({
  submissionId: Uuid, claimRequestId: Uuid, replacedSubmissionId: Uuid,
  payload: GuestPendingPayloadSchema, payloadDigest: Digest,
}).strict();
export type GuestMemberActionRegisterRequest = z.infer<typeof GuestMemberActionRegisterRequestSchema>;
export const GuestClaimResolveRequestSchema = z.object({ claimRequestId: Uuid, submissionId: Uuid }).strict();
export const GuestActionResumeRequestSchema = z.object({
  submissionId: Uuid, claimRequestId: Uuid, controlVersion: Version, payloadDigest: Digest,
}).strict();
export const GuestActionResolveRequestSchema = GuestClaimResolveRequestSchema;
export const GuestDeleteRequestSchema = z.object({}).strict();

export const GuestErrorCodeSchema = z.enum([
  "AUTH_REQUIRED_NEXT_TURN", "guest_expired", "guest_deleted", "authority_denied", "intent_stale",
  "consent_required", "allowance_exhausted", "idempotency_conflict",
]);
