import { createHash } from "node:crypto";
import { z } from "zod";
import { authorize as authorizeMatched } from "./authorization.js";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export const DOCUMENT_GROUNDED_PASSAGE = "WAL does not work over a network filesystem.";
export const DOCUMENT_GROUNDED_QUESTION =
  "Can SQLite WAL support one shared database on a network filesystem and two simultaneous writers?";

export const LIVE_SEMANTIC_TASK_CLASSES = [
  "one_sentence_purchase_comparison",
  "technical_compatibility_conflict",
  "freshness_sensitive_fact",
  "document_grounded_check",
  "correction",
  "unknown_is_correct",
] as const;
export type LiveSemanticTaskClass = (typeof LIVE_SEMANTIC_TASK_CLASSES)[number];

export const LiveSemanticAuthorizationSchema = z.object({
  version: z.literal("live-semantic-authorization.v1"),
  approvalId: z.string().uuid(),
  approvalReference: z.string().regex(/^[a-zA-Z0-9._:-]{1,160}$/),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  taskClasses: z.array(z.enum(LIVE_SEMANTIC_TASK_CLASSES)).min(1).max(6),
  budgetMicro: z.number().int().positive().safe(),
  budgetScope: z.string().regex(/^evaluation:[a-zA-Z0-9_-]{1,100}$/),
  policyId: z.string().min(1).max(100),
  exclusiveDatabaseAcknowledged: z.literal(true),
  maxAttempts: z.number().int().positive().max(8),
}).strict();
export type LiveSemanticAuthorization = z.infer<typeof LiveSemanticAuthorizationSchema>;

export type LiveSemanticDriver = {
  providerCall: (taskClass: LiveSemanticTaskClass) => Promise<unknown>;
};

/**
 * Fail-closed live semantic entry. Credentials or a leftover grant file are not
 * authorization. Fixture scores are not quality proof.
 */
export function authorizeLiveSemantic(
  raw: string,
  flags: { execute: boolean; operatorConfirmsUserApproval: boolean; approvalId: string; sha256: string },
  now = Date.now(),
): LiveSemanticAuthorization {
  if (!flags.execute || !flags.operatorConfirmsUserApproval || sha256(raw) !== flags.sha256) {
    throw new Error("explicit_current_approval_required");
  }
  const grant = LiveSemanticAuthorizationSchema.parse(JSON.parse(raw));
  if (grant.approvalId !== flags.approvalId || Date.parse(grant.issuedAt) > now
    || Date.parse(grant.expiresAt) <= now || Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt) > 86_400_000) {
    throw new Error("approval_expired_or_mismatched");
  }
  if (new Set(grant.taskClasses).size !== grant.taskClasses.length) throw new Error("duplicate_task_scope");
  return grant;
}

export async function executeLiveSemanticEval(args: {
  rawAuthorization: string;
  flags: { execute: boolean; operatorConfirmsUserApproval: boolean; approvalId: string; sha256: string };
  driver: LiveSemanticDriver;
  taskClasses?: LiveSemanticTaskClass[];
  now?: number;
}): Promise<{ authorization: LiveSemanticAuthorization; executed: LiveSemanticTaskClass[]; providerCalls: number }> {
  const grant = authorizeLiveSemantic(args.rawAuthorization, args.flags, args.now);
  const allowed = new Set(grant.taskClasses);
  const classes = (args.taskClasses ?? grant.taskClasses).filter((taskClass) => allowed.has(taskClass));
  if (!classes.length) throw new Error("unregistered_task_class");
  let providerCalls = 0;
  const executed: LiveSemanticTaskClass[] = [];
  const clock = args.now ?? Date.now();
  for (const taskClass of classes) {
    if (clock >= Date.parse(grant.expiresAt)) throw new Error("approval_expired_or_mismatched");
    await args.driver.providerCall(taskClass);
    providerCalls += 1;
    executed.push(taskClass);
  }
  return { authorization: grant, executed, providerCalls };
}

/** Matched-pipeline authorization remains a separate fail-closed spend path. */
export { authorizeMatched };
