import { strictPolicyForNewAdmission, modelPolicy, type ModelPolicyId } from "../ports/model-policy.js";
import { capabilitiesFor, type PrivacyRequirement } from "./portfolio.js";
import { cacheSessionPolicy, resolveOperationRoute } from "./routing.js";

export type RunPolicyChoice = {
  policyId: ModelPolicyId;
  admission: "inherited_parent_policy" | "pinned_run_policy" | "cheap_first_admitted";
  reason: string;
  cacheSessionId: string | null;
};

function reject(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function pinRejection(policyId: string, privacy: PrivacyRequirement, structuredOutputRequired: boolean): string | null {
  const cap = capabilitiesFor(policyId);
  if (!cap.available) return "candidate_unavailable";
  if (structuredOutputRequired && !cap.structuredOutput) return "structured_output_required";
  if (privacy.dataCollection === "deny" && cap.dataCollection !== "deny") return "privacy_incompatible_unavailable";
  if (privacy.zdrRequired && !cap.zdr) return "zdr_incompatible_unavailable";
  return null;
}

/**
 * New runs take the cheap-first admitted route. Explicit eval/operator pins stay
 * only when that policy itself is privacy-admitted. A child run is a new admission
 * of the parent's processor under current strict semantics; the parent policy id
 * is not rewritten.
 */
export function chooseAdmittedRunPolicy(args: {
  runId: string;
  parentPolicyId?: string | null;
  requestedPolicyId?: ModelPolicyId;
  zdrRequired?: boolean;
  remainingBudgetMicro: number;
  attemptReserveMicro: number;
}): RunPolicyChoice {
  if (args.parentPolicyId) {
    const policyId = strictPolicyForNewAdmission(args.parentPolicyId);
    return {
      policyId,
      admission: "inherited_parent_policy",
      reason: `inherited_parent_policy;pinned=${policyId}`,
      cacheSessionId: cacheSessionPolicy({ runId: args.runId, nextPolicyId: policyId, qualityEscalation: false }).sessionId,
    };
  }
  if (args.requestedPolicyId) {
    const requested = modelPolicy(args.requestedPolicyId);
    if (args.remainingBudgetMicro < args.attemptReserveMicro) reject("attempt_budget_exhausted");
    const privacy: PrivacyRequirement = {
      zdrRequired: requested.provider === "azure" || Boolean(args.zdrRequired),
      dataCollection: "deny",
    };
    const rejection = pinRejection(requested.id, privacy, true);
    if (rejection) reject(rejection);
    return {
      policyId: requested.id,
      admission: "pinned_run_policy",
      reason: `pinned_run_policy;pinned=${requested.id}`,
      cacheSessionId: cacheSessionPolicy({
        runId: args.runId,
        nextPolicyId: requested.id,
        qualityEscalation: false,
      }).sessionId,
    };
  }
  const route = resolveOperationRoute({
    operation: "run",
    operationClass: "structured",
    privacy: { zdrRequired: Boolean(args.zdrRequired), dataCollection: "deny" },
    structuredOutputRequired: true,
    remainingBudgetMicro: args.remainingBudgetMicro,
    attemptReserveMicro: args.attemptReserveMicro,
    runId: args.runId,
  });
  if (!route.admitted || !route.policyId) reject(route.reason);
  const policyId = modelPolicy(route.policyId).id;
  return {
    policyId,
    admission: "cheap_first_admitted",
    reason: route.reason,
    cacheSessionId: route.cacheSessionId,
  };
}
