import { createHash } from "node:crypto";
import type pg from "pg";
import { ExtractedDocument, extractOffline } from "../adapters/extraction/offline.js";
import { insertExtractedVersion, insertSource } from "../modules/evidence.js";
import { bumpEvidence, emitEvent } from "../modules/runs.js";
import type { FencedSession } from "./fenced-session.js";

/** Runs before research. CPU parsing is outside transactions; every persisted result rechecks the run fence. */
export async function ingestAttachments(pool: pg.Pool, run: { id: string; account_id: string },
  brief: { attachmentIds: string[] }, session: FencedSession): Promise<void> {
  for (const id of brief.attachmentIds ?? []) {
    const locator = `attachment://${id}`;
    if ((await pool.query("SELECT 1 FROM sources WHERE run_id=$1 AND canonical_locator=$2", [run.id, locator])).rowCount) continue;
    const row = await pool.query<{ filename: string; mime: string; raw_bytes: Buffer | null; sha256: string | null; extraction: unknown;
      extracted_text: string | null }>("SELECT filename,mime,raw_bytes,sha256,extraction,extracted_text FROM attachments WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL", [id, run.account_id]);
    const att = row.rows[0];
    if (!att) throw new Error("attachment_unavailable");
    const bytes = att.raw_bytes;
    const digest = createHash("sha256").update(bytes ?? Buffer.alloc(0)).digest("hex");
    const cached = ExtractedDocument.safeParse(att.extraction);
    let extraction: ExtractedDocument;
    if (cached.success && bytes && cached.data.digest === digest &&
        (att.mime !== "application/pdf" || cached.data.version === "docling-parse-7.20.0/geometry-v1")) extraction = cached.data;
    else if (!bytes || digest !== att.sha256) {
      extraction = { version: "unavailable-v1", digest, status: "unavailable", blocks: [], warnings: ["original_bytes_unavailable_or_changed"] };
    } else {
      await session.write(async (db) => {
        await emitEvent(db, { runId: run.id, accountId: run.account_id, type: "attachment_processing", phase: "researching", summary: "Reading the uploaded file." });
      });
      try { extraction = await extractOffline(bytes, att.mime, { signal: session.signal }); }
      catch { extraction = { version: "unavailable-v1", digest, status: "unavailable", blocks: [], warnings: ["extraction_runtime_failed_or_unavailable"] }; }
    }
    await session.write(async (db) => {
      const active = await db.query("SELECT sha256 FROM attachments WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL FOR UPDATE", [id, run.account_id]);
      if (!active.rows[0] || active.rows[0].sha256 !== att.sha256) throw new Error("attachment_changed");
      const state = extraction.status === "extracted" ? "ready" : extraction.status === "partial" ? "partially_read" : "unsupported";
      await db.query("UPDATE attachments SET processing_state=$3,extraction=$4,extracted_text=$5 WHERE id=$1 AND account_id=$2", [id, run.account_id, state,
        JSON.stringify(extraction), extraction.blocks.map((b) => b.text).join("\n\n") || null]);
      const sourceId = await insertSource(db, { accountId: run.account_id, runId: run.id, locator,
        title: att.filename, publisher: "uploaded", originCluster: locator, sourceType: "supplied-document" });
      await insertExtractedVersion(db, { accountId: run.account_id, runId: run.id, sourceId,
        ...(bytes ? { bytes, extraction } : {}), receipt: { requestedUrl: locator, finalUrl: locator, redirectChain: [],
          status: null, mime: att.mime, retrievedAt: new Date().toISOString(), outcome: bytes ? "successful_body" : "extraction_unavailable" } });
      await bumpEvidence(db, run.id);
      await emitEvent(db, { runId: run.id, accountId: run.account_id, type: "attachment_processed", phase: "researching",
        summary: state === "ready" ? "Uploaded text is available as evidence." : state === "partially_read" ? "The file was partially read; extraction limitations remain." : "The file could not be read and provides no supporting evidence." });
    });
  }
}
