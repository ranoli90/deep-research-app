import type { Queryable } from "../platform/db.js";

export async function recordPortfolioResolution(db: Queryable, row: {
  id: string;
  runId: string;
  accountId: string;
  portfolioId: string;
  operation: string;
  resolvedPolicyId: string;
  admission: string;
  escalationDepth: number;
  escalationTrigger: string | null;
  cacheSessionId: string | null;
  reason: string;
}): Promise<void> {
  await db.query(
    `INSERT INTO model_portfolio_resolutions (
      id, run_id, account_id, portfolio_id, operation, resolved_policy_id, admission,
      escalation_depth, escalation_trigger, cache_session_id, reason
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.id, row.runId, row.accountId, row.portfolioId, row.operation, row.resolvedPolicyId,
      row.admission, row.escalationDepth, row.escalationTrigger, row.cacheSessionId, row.reason,
    ],
  );
}
