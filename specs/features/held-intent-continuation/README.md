# W02/W08 independent evaluation with preserved holds

Goal: continue a different registered public research question within the existing authorized cap without resending or erasing a timed-out action. ADR061 and the canonical engine/security/evaluation contracts own behavior.

Scope: strict internal authorization snapshot, read-only restoration, all-liability accounting and no-repeat question binding. No migration, new dependency/service, public schema, processor change, permission expansion or budget increase. Original user documents and provider receipts remain untouched. New unknowns stop; incomplete attribution fails closed.

Tests: pure evaluator admission/budget/retry negatives plus actual PostgreSQL snapshot mismatch and hold-preservation controls. No fabricated transport is live quality evidence. Rollback disables optional continuation for new admission while preserving existing holds and receipts. Unresolved: the actual timed-out provider charge remains unknown.
