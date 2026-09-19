import { createHash } from "node:crypto";
import {
  authorizePublicQuery,
  canonicalQueryIdentity,
  canonicalPrivateTermSet,
  clusterSourceOrigins,
  evaluateFreshness,
  freshnessPolicyForQuestion,
  planSourceClass,
  privateTermSetsEqual,
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

/** SHA-256 of the canonical proposed-query identity. Not a union of prior queries. */
export function queryAuthorizationDigest(query: string): string {
  return digest(canonicalQueryIdentity(query));
}

export async function loadPrivateDocumentText(
  db: Queryable,
  accountId: string,
  scope?: { runId: string; briefRevision?: number },
): Promise<string> {
  if (!scope?.runId) {
    throw new Error("private_document_scope_required");
  }
  const res = await db.query<{ extracted_text: string | null }>(
    `SELECT a.extracted_text
       FROM attachments a
       JOIN runs r ON r.id=$2 AND r.account_id=$1
       JOIN research_briefs b ON b.id=r.brief_id AND b.account_id=$1
      WHERE a.account_id=$1 AND a.deleted_at IS NULL AND a.extracted_text IS NOT NULL
        AND (b.payload->'attachmentIds') ? a.id::text
        AND ($3::int IS NULL OR r.brief_revision=$3)`,
    [accountId, scope.runId, scope.briefRevision ?? null],
  );
  return res.rows.map((r) => r.extracted_text ?? "").filter(Boolean).join("\n");
}

export async function loadPrivateCanaries(
  db: Queryable,
  accountId: string,
  scope?: { runId: string; briefRevision?: number },
): Promise<string[]> {
  const text = await loadPrivateDocumentText(db, accountId, scope);
  const out: string[] = [];
  for (const m of text.match(/CANARY:[A-Z0-9_-]+/gi) ?? []) out.push(m);
  return out;
}

export async function loadApprovedPrivateTerms(db: Queryable, args: {
  accountId: string;
  runId: string;
  briefRevision?: number;
  queryDigest: string;
}): Promise<string[]> {
  if (!args.queryDigest) return [];
  const row = await db.query<{ approved_private_terms: unknown }>(
    `SELECT approved_private_terms FROM query_authorizations
      WHERE account_id=$1 AND run_id=$2 AND kind='approved' AND permission_required=false
        AND query_digest=$3 AND ($4::int IS NULL OR brief_revision=$4)
      ORDER BY created_at DESC LIMIT 1`,
    [args.accountId, args.runId, args.queryDigest, args.briefRevision ?? null],
  );
  return canonicalPrivateTermSet(termList(row.rows[0]?.approved_private_terms));
}

function termList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((t) => String(typeof t === "object" && t && "token" in t ? (t as { token: string }).token : t).normalize("NFKC").toLowerCase()).filter(Boolean);
}

/** Exact query proof only. Missing digest is deny. Search 2 cannot borrow search 1. */
export async function hasPublicQueryApproval(db: Queryable, args: {
  accountId: string;
  runId: string;
  briefRevision?: number;
  queryDigest: string;
  terms: readonly string[];
}): Promise<boolean> {
  if (!args.queryDigest) return false;
  const row = await db.query<{ approved_private_terms: unknown; brief_revision: number }>(
    `SELECT approved_private_terms, brief_revision FROM query_authorizations
      WHERE account_id=$1 AND run_id=$2 AND kind='approved' AND permission_required=false AND query_digest=$3
      ORDER BY created_at DESC LIMIT 1`,
    [args.accountId, args.runId, args.queryDigest],
  );
  const item = row.rows[0];
  if (!item) return false;
  if (args.briefRevision != null && item.brief_revision !== args.briefRevision) return false;
  return privateTermSetsEqual(termList(item.approved_private_terms), args.terms);
}

export async function pendingQueryAuthorization(db: Queryable, args: { accountId: string; runId: string; briefRevision: number }) {
  const row = await db.query<{
    id: string;
    proposed_query: string;
    query_digest: string;
    brief_revision: number;
    approved_private_terms: unknown;
    reason: string | null;
  }>(
    `SELECT id, proposed_query, query_digest, brief_revision, approved_private_terms, reason
       FROM query_authorizations
      WHERE account_id=$1 AND run_id=$2 AND brief_revision=$3 AND kind='permission_required'
      ORDER BY created_at DESC LIMIT 1`,
    [args.accountId, args.runId, args.briefRevision],
  );
  const item = row.rows[0];
  if (!item) return null;
  const terms = termList(item.approved_private_terms);
  return {
    id: item.id,
    proposedQuery: item.proposed_query,
    queryDigest: item.query_digest,
    briefRevision: item.brief_revision,
    terms,
    reason: item.reason,
  };
}

export async function approveQueryAuthorization(db: Queryable, args: {
  accountId: string;
  runId: string;
  briefRevision: number;
  authorizationId: string;
  queryDigest: string;
  terms: string[];
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pending = await db.query<{
    id: string;
    kind: string;
    query_digest: string;
    brief_revision: number;
    approved_private_terms: unknown;
  }>(
    `SELECT id, kind, query_digest, brief_revision, approved_private_terms
       FROM query_authorizations
      WHERE id=$1 AND account_id=$2 AND run_id=$3 AND kind IN ('permission_required','approved')
      FOR UPDATE`,
    [args.authorizationId, args.accountId, args.runId],
  );
  const row = pending.rows[0];
  if (!row) return { ok: false, reason: "query_authorization_not_found" };
  if (row.brief_revision !== args.briefRevision) return { ok: false, reason: "stale_brief_revision" };
  if (row.query_digest !== args.queryDigest) return { ok: false, reason: "query_digest_mismatch" };
  const offered = canonicalPrivateTermSet(args.terms);
  if (!privateTermSetsEqual(termList(row.approved_private_terms), offered)) return { ok: false, reason: "term_set_mismatch" };
  if (row.kind === "approved") return { ok: true };
  const updated = await db.query(
    `UPDATE query_authorizations
        SET kind='approved', permission_required=false, approved_private_terms=$2::jsonb, reason='user_approved_exact_term_set'
      WHERE id=$1 AND account_id=$3 AND run_id=$4 AND kind='permission_required'
      RETURNING id`,
    [row.id, JSON.stringify(offered), args.accountId, args.runId],
  );
  if (!updated.rowCount) return { ok: false, reason: "query_authorization_not_found" };
  return { ok: true };
}

export async function loadRunStoredSources(db: Queryable, args: { accountId: string; runId: string }): Promise<StoredSource[]> {
  const rows = await db.query<{ id: string; title: string; locator: string; source_type: string | null; origin_cluster: string | null; publisher: string | null; publication_date: Date | string | null; access_level: StoredSource["accessLevel"] | null; effective_date: string | null; applicable_version: string | null; retrieved_at: Date | null; text_coverage: string | null }>(
    `SELECT s.id,s.title,COALESCE(v.final_locator,s.canonical_locator) AS locator,s.source_type,s.origin_cluster,s.publisher,s.publication_date::text AS publication_date,
       v.access_level,v.effective_date::text AS effective_date,v.applicable_version,v.retrieved_at,v.text_coverage
     FROM sources s LEFT JOIN LATERAL (
       SELECT v.* FROM source_versions v WHERE v.source_id=s.id AND v.account_id=s.account_id
       AND (s.run_id=$2 OR EXISTS(SELECT 1 FROM authorized_run_passages p WHERE p.run_id=$2 AND p.account_id=$1 AND p.source_version_id=v.id))
       AND NOT EXISTS(SELECT 1 FROM source_policy_exclusions x JOIN runs r ON r.id=x.run_id WHERE x.run_id=$2 AND x.account_id=$1 AND x.brief_revision=r.brief_revision AND x.source_version_id=v.id)
       ORDER BY CASE v.access_level WHEN 'full-text' THEN 0 WHEN 'partial-text' THEN 1 WHEN 'snippet' THEN 2 ELSE 3 END,v.retrieved_at DESC LIMIT 1
     ) v ON true WHERE s.account_id=$1 AND (s.run_id=$2 OR EXISTS(SELECT 1 FROM authorized_run_passages p JOIN source_versions av ON av.id=p.source_version_id WHERE p.run_id=$2 AND p.account_id=$1 AND av.source_id=s.id))
       AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$1 AND t.object_kind='source' AND t.object_id=s.id)`,
    [args.accountId, args.runId],
  );
  return rows.rows.map((s) => ({
    id: s.id,
    title: s.title,
    locator: s.locator,
    accessLevel: s.access_level ?? "blocked",
    effectiveDate: s.effective_date ? new Date(`${s.effective_date}T00:00:00Z`) : null, version: s.applicable_version, retrievedAt: s.retrieved_at, textCoverage: s.text_coverage ?? undefined,
    sourceType: s.source_type ?? undefined,
    originCluster: s.origin_cluster ?? undefined,
    publisher: s.publisher ?? undefined,
    publicationDate: !s.publication_date
      ? null
      : s.publication_date instanceof Date
        ? new Date(`${s.publication_date.toISOString().slice(0, 10)}T00:00:00Z`)
        : new Date(`${String(s.publication_date).slice(0, 10)}T00:00:00Z`),
  }));
}

export async function recordQueryAuthorization(
  db: Queryable,
  args: { accountId: string; runId: string; briefRevision: number; proposedQuery: string; authorization: QueryAuthorization },
): Promise<void> {
  const queryDigest = queryAuthorizationDigest(args.proposedQuery);
  const privateTerms = canonicalPrivateTermSet(args.authorization.privateTermsRequiringApproval);
  const values = [
    crypto.randomUUID(),
    args.accountId,
    args.runId,
    args.briefRevision,
    queryDigest,
    args.proposedQuery,
    args.authorization.query,
    JSON.stringify(args.authorization.terms),
    JSON.stringify(privateTerms),
    args.authorization.kind === "permission_required",
    args.authorization.kind,
    args.authorization.reason ?? null,
  ];
  if (args.authorization.kind === "permission_required") {
    await db.query(
      `INSERT INTO query_authorizations(id,account_id,run_id,brief_revision,query_digest,proposed_query,authorized_query,terms,approved_private_terms,permission_required,kind,reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (run_id, brief_revision, query_digest) WHERE kind IN ('permission_required','approved')
       DO UPDATE SET
         proposed_query=EXCLUDED.proposed_query,
         authorized_query=EXCLUDED.authorized_query,
         terms=EXCLUDED.terms,
         approved_private_terms=EXCLUDED.approved_private_terms,
         reason=EXCLUDED.reason
       WHERE query_authorizations.kind='permission_required'`,
      values,
    );
    return;
  }
  await db.query(
    `INSERT INTO query_authorizations(id,account_id,run_id,brief_revision,query_digest,proposed_query,authorized_query,terms,approved_private_terms,permission_required,kind,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    values,
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
  userPublicTerms?: string[];
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
    userPublicTerms: args.userPublicTerms,
  });
}

export async function reconcileOwnedDocumentClaims(
  db: Queryable,
  args: { accountId: string; runId: string; question: string; claims: Array<{ key: string; text: string }> },
): Promise<number> {
  const documentText = await loadPrivateDocumentText(db, args.accountId, { runId: args.runId });
  if (!documentText.trim() || !args.claims.length) return 0;
  const canaries = await loadPrivateCanaries(db, args.accountId, { runId: args.runId });
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
