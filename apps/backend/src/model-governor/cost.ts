import { writingReserve } from "@deep/research-core";
import type { OperationClass } from "./portfolio.js";

export type HierarchicalBudget = {
  accountRemainingMicro: number;
  runRemainingMicro: number;
  reservedVerificationMicro: number;
  reservedWritingMicro: number;
};

export type BudgetDecision =
  | { ok: true; attemptMicro: number; reservedVerificationMicro: number; reservedWritingMicro: number }
  | { ok: false; reason: string };

/**
 * Account → run → operation class → attempt. Verification and writing are
 * reserved before exploration can spend.
 */
export function reserveOperationBudget(args: {
  hierarchy: HierarchicalBudget;
  operationClass: OperationClass;
  attemptReserveMicro: number;
  runBudgetMicro: number;
}): BudgetDecision {
  const attempt = args.attemptReserveMicro;
  if (![attempt, args.runBudgetMicro, args.hierarchy.accountRemainingMicro, args.hierarchy.runRemainingMicro].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    return { ok: false, reason: "invalid_budget_integers" };
  }
  const writing = Math.max(args.hierarchy.reservedWritingMicro, writingReserve(args.runBudgetMicro));
  const verification = Math.max(args.hierarchy.reservedVerificationMicro, Math.ceil(args.runBudgetMicro * 0.15));
  if (args.hierarchy.accountRemainingMicro < attempt) return { ok: false, reason: "account_budget_exhausted" };
  if (args.hierarchy.runRemainingMicro < attempt) return { ok: false, reason: "run_budget_exhausted" };
  const remaining = args.hierarchy.runRemainingMicro;
  if (args.operationClass === "exploration" && remaining - attempt < writing + verification) {
    return { ok: false, reason: "verification_writing_reserve" };
  }
  return { ok: true, attemptMicro: attempt, reservedVerificationMicro: verification, reservedWritingMicro: writing };
}

export function actualOrUnconfirmed(actualMicro: number | null | undefined): { confirmed: boolean; actualMicro: number | null } {
  if (actualMicro == null) return { confirmed: false, actualMicro: null };
  if (!Number.isSafeInteger(actualMicro) || actualMicro < 0) return { confirmed: false, actualMicro: null };
  return { confirmed: true, actualMicro };
}
