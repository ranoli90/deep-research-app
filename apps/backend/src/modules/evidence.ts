import { createHash } from "node:crypto";
import type { AccessLevel } from "@deep/contracts";
import type { Queryable } from "../platform/db.js";

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
     VALUES ($1,$2,$3,$4,$5,$6,'fixture-text',$7)`,
    [passageId, versionId, args.accountId, args.runId, args.text, JSON.stringify({ kind: "document" }), hash],
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
     WHERE p.run_id = $1`,
    [runId],
  );
  return { sources: sources.rows as never, passages: passages.rows as never };
}

export async function getPassageForAccount(db: Queryable, passageId: string, accountId: string) {
  const res = await db.query(
    `SELECT p.*, s.title, s.canonical_locator, s.publisher, s.origin_cluster, v.access_level
     FROM passages p
     JOIN source_versions v ON v.id = p.source_version_id
     JOIN sources s ON s.id = v.source_id
     WHERE p.id = $1 AND p.account_id = $2`,
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
