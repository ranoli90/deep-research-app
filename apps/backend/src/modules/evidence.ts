import { canonicalSourceUrl, parseSourcePublicationDate } from "@deep/research-core";
import { createHash } from "node:crypto";
import type { AccessLevel } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";
import type { ExtractedDocument } from "../adapters/extraction/offline.js";

export type DownloadReceipt = {
  requestedUrl: string; finalUrl: string; redirectChain: string[];
  status: number | null; mime: string; retrievedAt: string;
  outcome: "successful_body" | "unavailable_status" | "fetch_unavailable" | "extraction_unavailable";
};

/** Caller owns the account/run transaction and fence; failed retrieval never becomes a passage. */
export async function insertExtractedVersion(db: Queryable, args: {
  accountId: string; runId: string; sourceId: string; receipt: DownloadReceipt;
  bytes?: Buffer; extraction?: ExtractedDocument;
}): Promise<string> {
  const owned = await db.query("SELECT id FROM sources WHERE id=$1 AND account_id=$2 AND run_id=$3", [args.sourceId, args.accountId, args.runId]);
  if (!owned.rows.length) throw new Error("source_owner_mismatch");
  const digest = args.bytes ? createHash("sha256").update(args.bytes).digest("hex") : null;
  if (args.extraction && args.extraction.digest !== digest) throw new Error("extraction_digest_mismatch");
  const readable = args.receipt.outcome === "successful_body" && args.extraction?.status !== "unavailable" && Boolean(args.extraction?.blocks.length);
  const versionId = crypto.randomUUID();
  // Date/version labels come from exact extracted text, not retrieval time or a guessed date.
  const text=args.extraction?.blocks.map(b=>b.text).join("\n") ?? "";
  const effectiveDate=parseSourcePublicationDate(text.match(/\beffective(?: date)?\s*[:=]?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? "");
  const applicableVersion=text.match(/\b(?:applicable version|software version|firmware version)\s*[:=]\s*([a-z0-9][a-z0-9._+-]{0,159})/i)?.[1]?.replace(/[.]+$/, "") ?? null;
  let artifactId: string | null = null;
  if (args.bytes) {
    artifactId = crypto.randomUUID();
    await db.query("INSERT INTO evidence_artifacts(id,account_id,run_id,body,digest) VALUES($1,$2,$3,$4,$5)", [artifactId, args.accountId, args.runId, args.bytes, digest]);
  }
  await db.query(`INSERT INTO source_versions(id,source_id,account_id,final_locator,content_hash,mime,access_level,text_coverage,quality_warnings,effective_date,applicable_version,retrieved_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [versionId,args.sourceId,args.accountId,/^https?:/.test(args.receipt.finalUrl) ? canonicalSourceUrl(args.receipt.finalUrl) : args.receipt.finalUrl,digest,args.receipt.mime,
    readable ? "partial-text" : "blocked", readable ? "selected_extracted_blocks" : "unavailable", JSON.stringify(args.extraction?.warnings ?? [args.receipt.outcome]),effectiveDate?.toISOString().slice(0,10) ?? null,applicableVersion,args.receipt.retrievedAt]);
  await db.query(`INSERT INTO extraction_receipts(account_id,run_id,source_version_id,artifact_id,transport,extraction) VALUES($1,$2,$3,$4,$5,$6)`,
    [args.accountId,args.runId,versionId,artifactId,JSON.stringify({ ...args.receipt, bytes: args.bytes?.length ?? 0, digest }),
      JSON.stringify(args.extraction ?? { status: "unavailable", blocks: [], warnings: [args.receipt.outcome] })]);
  if (readable && args.extraction) for (const block of args.extraction.blocks) {
    await db.query(`INSERT INTO passages(id,source_version_id,account_id,run_id,exact_text,locator,extraction_method,content_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [crypto.randomUUID(),versionId,args.accountId,args.runId,block.text,
      JSON.stringify({ kind: block.kind, block: block.locator, rows: block.rows, ...(block.geometry ? { geometry: block.geometry, coordinates: "PDF points; bottom-left origin" } : {}), normalization: "extractor-output-v1" }),
      args.extraction.version,createHash("sha256").update(block.text).digest("hex")]);
  }
  return versionId;
}

export async function insertSource(
  db: Queryable,
  args: {
    accountId: string;
    runId: string;
    locator: string;
    title: string;
    publisher: string;
    originCluster: string;
    sourceType?: string;
    population?: string;
    language?: string;
    publicationDate?: Date | string | null;
    originalLocator?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO sources (id, account_id, run_id, canonical_locator, original_locator, publisher, title, source_type, origin_cluster, population, language, publication_date)
     VALUES ($1,$2,$3,$4,$12,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      args.accountId,
      args.runId,
      /^https?:/.test(args.locator) ? canonicalSourceUrl(args.locator) : args.locator,
      args.publisher,
      args.title,
      args.sourceType ?? "web",
      args.originCluster,
      args.population ?? null,
      args.language ?? null,
      args.publicationDate instanceof Date ? args.publicationDate.toISOString().slice(0, 10) : args.publicationDate ?? null,
      args.originalLocator ?? args.locator,
    ],
  );
  return id;
}

export async function insertVersionAndPassage(
  db: Queryable,
  args: {
    sourceId: string;
    accountId: string;
    runId: string;
    locator: string;
    text: string;
    accessLevel: AccessLevel;
    extractionMethod?: "search-snippet";
  },
): Promise<{ versionId: string; passageId: string }> {
  const versionId = crypto.randomUUID();
  const passageId = crypto.randomUUID();
  const hash = createHash("sha256").update(args.text).digest("hex");
  const finalLocator = /^https?:/.test(args.locator) ? canonicalSourceUrl(args.locator) : args.locator;
  await db.query(
    `INSERT INTO source_versions (id, source_id, account_id, final_locator, content_hash, mime, access_level, text_coverage)
     VALUES ($1,$2,$3,$4,$5,'text/plain',$6,$7)`,
    [versionId, args.sourceId, args.accountId, finalLocator, hash, args.accessLevel, args.accessLevel === "full-text" ? "complete" : "partial"],
  );
  await db.query(
    `INSERT INTO passages (id, source_version_id, account_id, run_id, exact_text, locator, extraction_method, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$8,$7)`,
    [passageId, versionId, args.accountId, args.runId, args.text, JSON.stringify({ kind: "document" }), hash, args.extractionMethod ?? "fixture-text"],
  );
  return { versionId, passageId };
}

export async function loadEvidence(db: Queryable, runId: string): Promise<{
  sources: {
    id: string;
    title: string;
    canonical_locator: string;
    origin_cluster: string | null;
    source_type: string | null;
    population: string | null;
    language: string | null;
    access_level: AccessLevel;
  }[];
  passages: { id: string; source_id: string; source_version_id: string; exact_text: string }[];
}> {
  const sources = await db.query(
    `SELECT s.id, s.title, s.canonical_locator, s.origin_cluster, s.source_type, s.population, s.language,
            COALESCE(sv.access_level, 'discovered') AS access_level
     FROM sources s
     LEFT JOIN LATERAL (
       SELECT access_level FROM source_versions v WHERE v.source_id = s.id ORDER BY retrieved_at DESC LIMIT 1
     ) sv ON true
     WHERE s.run_id = $1`,
    [runId],
  );
  const passages = await db.query(
    `SELECT p.id, s.id AS source_id, p.source_version_id, p.exact_text
     FROM passages p
     JOIN source_versions v ON v.id = p.source_version_id
     JOIN sources s ON s.id = v.source_id
     JOIN LATERAL (
       SELECT id FROM source_versions latest
       WHERE latest.source_id = s.id
       ORDER BY latest.retrieved_at DESC
       LIMIT 1
     ) latest ON latest.id = v.id
     WHERE p.run_id = $1`,
    [runId],
  );
  return { sources: sources.rows as never, passages: passages.rows as never };
}

export async function getPassageForAccount(db: Queryable, passageId: string, accountId: string) {
  const res = await db.query(
    `SELECT p.*, s.id AS source_id, s.title, s.canonical_locator, s.publisher, s.origin_cluster, s.origin_relation,
            s.publication_date::text AS publication_date, v.effective_date::text AS effective_date, v.applicable_version, v.access_level, v.quality_warnings, v.text_coverage, v.retrieved_at, r.route_mode
     FROM passages p
     JOIN source_versions v ON v.id = p.source_version_id
     JOIN sources s ON s.id = v.source_id
     JOIN runs r ON r.id = p.run_id
     WHERE p.id = $1 AND p.account_id = $2 AND s.account_id=$2 AND v.account_id=$2 AND r.account_id=$2
       AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$2 AND t.object_kind='source' AND t.object_id=s.id)
       AND (r.claimed_parent_run_id IS NULL OR NOT EXISTS(SELECT 1 FROM tombstones t
         WHERE t.account_id=$2 AND t.object_kind='run' AND t.object_id=r.id
           AND t.reason='source_deletion'))
       AND NOT EXISTS(SELECT 1 FROM source_policy_exclusions x WHERE x.run_id=r.id AND x.account_id=$2 AND x.brief_revision=r.brief_revision AND x.source_version_id=v.id)`,
    [passageId, accountId],
  );
  return res.rows[0] ?? null;
}

export async function insertClaim(
  db: Queryable,
  args: { runId: string; accountId: string; text: string; type: string; supportStatus: string; passageId?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO claims (id, run_id, account_id, text, type, support_status) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, args.runId, args.accountId, args.text, args.type, args.supportStatus],
  );
  if (args.passageId) {
    await db.query(
      `INSERT INTO claim_evidence (claim_id, passage_id, relation, checker_version, decision, explanation)
       VALUES ($1,$2,'supports','support-v1','supports','passage selected by composer')`,
      [id, args.passageId],
    );
  }
  return id;
}
