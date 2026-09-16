import type { RevisionBasis } from "@deep/contracts";

export type PublishRejectReason =
  | "stale_brief"
  | "stale_evidence"
  | "consent_revoked"
  | "cancelled"
  | "stale_lease"
  | "deleted"
  | "unknown_citation"
  | "unsupported_citation"
  | "ok";

export function canPublish(args: {
  loaded: RevisionBasis;
  current: RevisionBasis;
  deleted: boolean;
  unknownCitationIds: string[];
  unsupportedCitationCount: number;
}): PublishRejectReason {
  if (args.deleted) return "deleted";
  if (args.current.cancellationEpoch > args.loaded.cancellationEpoch) return "cancelled";
  if (args.current.consentEpoch > args.loaded.consentEpoch) return "consent_revoked";
  if (args.current.workerLeaseFence > args.loaded.workerLeaseFence) return "stale_lease";
  if (args.current.briefRevision !== args.loaded.briefRevision) return "stale_brief";
  if (args.current.evidenceRevision !== args.loaded.evidenceRevision) return "stale_evidence";
  if (args.unknownCitationIds.length > 0) return "unknown_citation";
  if (args.unsupportedCitationCount > 0) return "unsupported_citation";
  return "ok";
}

export function writingReserve(totalBudgetMicro: number, ratio = 0.2): number {
  return Math.ceil(totalBudgetMicro * ratio);
}

export function canSpendExploration(args: {
  totalBudgetMicro: number;
  spentPlusReservedMicro: number;
  actionCostMicro: number;
  isFinishingAction: boolean;
  finishingCostMicro?: number;
}): boolean {
  const reserve = Math.max(writingReserve(args.totalBudgetMicro), args.finishingCostMicro ?? 0);
  const remaining = args.totalBudgetMicro - args.spentPlusReservedMicro;
  if (remaining < args.actionCostMicro) return false;
  if (!args.isFinishingAction && remaining - args.actionCostMicro < reserve) return false;
  return true;
}
