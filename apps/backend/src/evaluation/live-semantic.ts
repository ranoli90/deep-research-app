import { authorize, type Authorization } from "./authorization.js";

export const LIVE_SEMANTIC_TASK_CLASSES = [
  "one_sentence_purchase_comparison",
  "technical_compatibility_conflict",
  "freshness_sensitive_fact",
  "document_grounded_check",
  "correction",
  "unknown_is_correct",
] as const;
export type LiveSemanticTaskClass = (typeof LIVE_SEMANTIC_TASK_CLASSES)[number];

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
): Authorization {
  return authorize(raw, flags, now);
}

export async function executeLiveSemanticEval(args: {
  rawAuthorization: string;
  flags: { execute: boolean; operatorConfirmsUserApproval: boolean; approvalId: string; sha256: string };
  driver: LiveSemanticDriver;
  taskClasses?: LiveSemanticTaskClass[];
  now?: number;
}): Promise<{ authorization: Authorization; executed: LiveSemanticTaskClass[]; providerCalls: number }> {
  const grant = authorizeLiveSemantic(args.rawAuthorization, args.flags, args.now);
  const classes = args.taskClasses ?? [...LIVE_SEMANTIC_TASK_CLASSES];
  let providerCalls = 0;
  const executed: LiveSemanticTaskClass[] = [];
  const driver: LiveSemanticDriver = {
    providerCall: async (taskClass) => {
      providerCalls += 1;
      return args.driver.providerCall(taskClass);
    },
  };
  for (const taskClass of classes) {
    await driver.providerCall(taskClass);
    executed.push(taskClass);
  }
  return { authorization: grant, executed, providerCalls };
}
