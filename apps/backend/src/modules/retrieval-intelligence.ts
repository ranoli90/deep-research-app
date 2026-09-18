import { createHash } from "node:crypto";
import {
  authorizePublicQuery,
  clusterSourceOrigins,
  evaluateFreshness,
  freshnessPolicyForQuestion,
  planSourceClass,
  reconcileDocumentClaim,
  recordSearchCoverage,
  type QueryAuthorization,
  type ReconciliationResult,
  type SearchCoverage,
  type SourceClass,
  type StoredSource,
} from "@deep/research-core";
import type { Queryable } from "../platform/db.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function loadPrivateDocumentText(db: Queryable, accountId: string): Promise<string> {
  const res = await db.query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM attachments WHERE account_id=$1 AND deleted_at IS NULL AND extracted_text IS NOT NULL`,
    [accountId],
  );
  return res.rows.map((r) => r.extracted_text ?? "").filter(Boolean).join("\n");
}

export async function loadPrivateCanaries(db: Queryable, accountId: string): Promise<string[]> {
  const text = await loadPrivateDocumentText(db, accountId);
  const out: string[] = [];
  for (const m of text.match(/CANARY:[A-Z0-9_-]+/gi) ?? []) out.push(m);
  return out;
}

export async function loadApprovedPrivateTerms(db: Queryable, args: { accountId: string; runId: string }): Promise<string[]> {
  const row = await db.query<{ approved_private_terms: unknown }>(
    `SELECT approved_private_terms FROM query_authorizations WHERE account_id=$1 AND run_id=$2 AND kind='approved' AND permission_required=false ORDER BY created_at DESC LIMIT 1`,
    [args.accountId, args.runId],
  );
  const raw = row.rows[0]?.approved_private_terms;
  return Array.isArray(raw) ? raw.map((t) => String(t)) : [];
}

export async function hasPublicQueryApproval(db: Queryable, args: { accountId: string; runId: string }): Promise<boolean> {
  const row = await db.query(
    `SELECT 1 FROM query_authorizations WHERE account_id=$1 AND run_id=$2 AND kind='approved' AND permission_required=false LIMIT 1`,
    [args.accountId, args.runId],
  );
  return Boolean(row.rowCount);
}

export async function loadRunStoredSources(db: Queryable, args: { accountId: string; runId: string }): Promise<StoredSource[]> {
  const rows = await db.query<{ id: string; title: string; locator: string; source_type: string | null; origin_cluster: string | null; publisher: string | null }>(
    `SELECT id, title, canonical_locator AS locator, source_type, origin_cluster, publisher FROM sources WHERE account_id=$1 AND run_id=$2`,
    [args.accountId, args.runId],
  );
  return rows.rows.map((s) => ({
    id: s.id,
    title: s.title,
    locator: s.locator,
    accessLevel: "snippet",
    sourceType: s.source_type ?? undefined,
    originCluster: s.origin_cluster ?? undefined,
    publisher: s.publisher ?? undefined,
  }));
}

export async function recordQueryAuthorization(
  db: Queryable,
  args: { accountId: string; runId: string; briefRevision: number; proposedQuery: string; authorization: QueryAuthorization },
): Promise<void> {
  await db.query(
    `INSERT INTO query_authorizations(id,account_id,run_id,brief_revision,query_digest,proposed_query,authorized_query,terms,approved_private_terms,permission_required,kind,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      crypto.randomUUID(),
      args.accountId,
      args.runId,
      args.briefRevision,
      digest(args.authorization.query),
      args.proposedQuery,
      args.authorization.query,
      JSON.stringify(args.authorization.terms),
      JSON.stringify(args.authorization.privateTermsRequiringApproval),
      args.authorization.kind === "permission_required",
      args.authorization.kind,
      args.authorization.reason ?? null,
    ],
  );
}

export async function persistSourceOrigins(db: Queryable, args: { accountId: string; runId: string }): Promise<number> {
  const rows = await db.query<{ id: string; title: string; locator: string; source_type: string | null; origin_cluster: string | null; publisher: string | null }>(
    `SELECT id,title,canonical_locator AS locator,source_type,origin_cluster,publisher FROM sources WHERE account_id=$1 AND run_id=$2`,
    [args.accountId, args.runId],
  );
  const clustered = clusterSourceOrigins(
    rows.rows.map((s) => ({
      id: s.id,
      title: s.title,
      locator: s.locator,
      accessLevel: "snippet",
      sourceType: s.source_type ?? undefined,
      originCluster: s.origin_cluster ?? undefined,
      publisher: s.publisher ?? undefined,
    })),
  );
  let n = 0;
  for (const [sourceId, meta] of clustered) {
    await db.query(
      `INSERT INTO source_origin_links(id,account_id,run_id,source_id,origin_cluster,relation,evidence)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (source_id) DO UPDATE SET origin_cluster=EXCLUDED.origin_cluster, relation=EXCLUDED.relation
       WHERE source_origin_links.account_id=EXCLUDED.account_id`,
      [crypto.randomUUID(), args.accountId, args.runId, sourceId, meta.cluster, meta.relation, "title-or-explicit-cluster"],
    );
    await db.query(`UPDATE sources SET origin_relation=$3, origin_cluster=$4 WHERE id=$1 AND account_id=$2`, [sourceId, args.accountId, meta.relation, meta.cluster]);
    n += 1;
  }
  return n;
}

export async function persistFreshnessPolicy(
  db: Queryable,
  args: { accountId: string; runId: string; question: string; criterionKey?: string },
) {
  const policy = freshnessPolicyForQuestion(args.question, args.criterionKey);
  await db.query(
    `INSERT INTO criterion_freshness_policies(id,account_id,run_id,criterion_key,class,max_age_hours,requires_effective_date,requires_version,policy)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (run_id, criterion_key) DO UPDATE SET class=EXCLUDED.class, max_age_hours=EXCLUDED.max_age_hours, requires_effective_date=EXCLUDED.requires_effective_date, requires_version=EXCLUDED.requires_version, policy=EXCLUDED.policy
     WHERE criterion_freshness_policies.account_id=EXCLUDED.account_id`,
    [
      crypto.randomUUID(),
      args.accountId,
      args.runId,
      args.criterionKey ?? "default",
      policy.class,
      policy.maxAgeHours,
      policy.requiresEffectiveDate,
      policy.requiresVersion,
      JSON.stringify(policy),
    ],
  );
  return policy;
}

export async function persistReconciliation(
  db: Queryable,
  args: { accountId: string; runId: string; result: ReconciliationResult },
): Promise<void> {
  await db.query(
    `INSERT INTO document_web_reconciliations(id,account_id,run_id,claim_key,outcome,permission_required,public_query_digest,source_scope,rationale)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (run_id, claim_key) DO UPDATE SET outcome=EXCLUDED.outcome, permission_required=EXCLUDED.permission_required, public_query_digest=EXCLUDED.public_query_digest, source_scope=EXCLUDED.source_scope, rationale=EXCLUDED.rationale
     WHERE document_web_reconciliations.account_id=EXCLUDED.account_id`,
    [
      crypto.randomUUID(),
      args.accountId,
      args.runId,
      args.result.claimKey,
      args.result.outcome,
      args.result.permissionRequired,
      digest(args.result.queryAuthorization.query),
      JSON.stringify(args.result.sourceScope),
      args.result.rationale,
    ],
  );
}

export async function persistSearchCoverage(
  db: Queryable,
  args: { accountId: string; runId: string; coverage: SearchCoverage },
): Promise<void> {
  await db.query(
    `INSERT INTO search_coverage(id,account_id,run_id,coverage) VALUES($1,$2,$3,$4)
     ON CONFLICT (run_id) DO UPDATE SET coverage=EXCLUDED.coverage WHERE search_coverage.account_id=EXCLUDED.account_id`,
    [crypto.randomUUID(), args.accountId, args.runId, JSON.stringify(args.coverage)],
  );
}

export function authorizeDiscoveryQuery(args: {
  question: string;
  query: string;
  privateDocumentText?: string;
  approvedPrivateTerms?: string[];
  privateCanaries?: string[];
  sourceClass?: SourceClass;
}): QueryAuthorization {
  const plan = planSourceClass(args.question);
  return authorizePublicQuery({
    question: args.question,
    query: args.query,
    privateDocumentText: args.privateDocumentText,
    approvedPrivateTerms: args.approvedPrivateTerms,
    privateCanaries: args.privateCanaries,
    sourceClass: args.sourceClass ?? plan.primary,
    expand: true,
  });
}

export async function reconcileOwnedDocumentClaims(
  db: Queryable,
  args: { accountId: string; runId: string; question: string; claims: Array<{ key: string; text: string }> },
): Promise<number> {
  const documentText = await loadPrivateDocumentText(db, args.accountId);
  if (!documentText.trim() || !args.claims.length) return 0;
  const canaries = await loadPrivateCanaries(db, args.accountId);
  const evidence = await db.query<{ id: string; access_level: string; exact_text: string }>(
    `SELECT s.id, v.access_level, p.exact_text FROM sources s
     JOIN source_versions v ON v.source_id=s.id AND v.account_id=s.account_id
     JOIN passages p ON p.source_version_id=v.id AND p.account_id=s.account_id
     WHERE s.account_id=$1 AND s.run_id=$2 AND s.canonical_locator NOT LIKE 'attachment://%'
     LIMIT 24`,
    [args.accountId, args.runId],
  );
  const publicEvidence = evidence.rows.map((r) => ({ sourceId: r.id, accessLevel: r.access_level, text: r.exact_text }));
  let n = 0;
  for (const claim of args.claims.slice(0, 8)) {
    const result = reconcileDocumentClaim({
      question: args.question,
      claim,
      documentText,
      publicEvidence,
      privateCanaries: canaries,
    });
    await persistReconciliation(db, { accountId: args.accountId, runId: args.runId, result });
    n += 1;
  }
  return n;
}

export { evaluateFreshness, freshnessPolicyForQuestion, planSourceClass, reconcileDocumentClaim, recordSearchCoverage };
