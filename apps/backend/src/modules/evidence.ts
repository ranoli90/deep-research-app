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
  let artifactId: string | null = null;
  if (args.bytes) {
    artifactId = crypto.randomUUID();
    await db.query("INSERT INTO evidence_artifacts(id,account_id,run_id,body,digest) VALUES($1,$2,$3,$4,$5)", [artifactId, args.accountId, args.runId, args.bytes, digest]);
  }
  await db.query(`INSERT INTO source_versions(id,source_id,account_id,final_locator,content_hash,mime,access_level,text_coverage,quality_warnings)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [versionId,args.sourceId,args.accountId,args.receipt.finalUrl,digest,args.receipt.mime,
    readable ? "partial-text" : "blocked", readable ? "selected_extracted_blocks" : "unavailable", JSON.stringify(args.extraction?.warnings ?? [args.receipt.outcome])]);
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
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO sources (id, account_id, run_id, canonical_locator, original_locator, publisher, title, source_type, origin_cluster, population, language)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      args.accountId,
      args.runId,
      args.locator,
      args.publisher,
      args.title,
      args.sourceType ?? "web",
      args.originCluster,
      args.population ?? null,
      args.language ?? null,
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
  await db.query(
    `INSERT INTO source_versions (id, source_id, account_id, final_locator, content_hash, mime, access_level, text_coverage)
     VALUES ($1,$2,$3,$4,$5,'text/plain',$6,$7)`,
    [versionId, args.sourceId, args.accountId, args.locator, hash, args.accessLevel, args.accessLevel === "full-text" ? "complete" : "partial"],
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
    `SELECT p.*, s.id AS source_id, s.title, s.canonical_locator, s.publisher, s.origin_cluster, v.access_level, v.quality_warnings, v.text_coverage, r.route_mode
     FROM passages p
     JOIN source_versions v ON v.id = p.source_version_id
     JOIN sources s ON s.id = v.source_id
     JOIN runs r ON r.id = p.run_id
     WHERE p.id = $1 AND p.account_id = $2 AND s.account_id=$2 AND v.account_id=$2 AND r.account_id=$2
       AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$2 AND t.object_kind='source' AND t.object_id=s.id)`,
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
