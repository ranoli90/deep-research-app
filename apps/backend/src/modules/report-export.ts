import { CanonicalReportSchema, ReportBlockSchema, type ReportBlock } from "@deep/contracts";
import { blocksToMarkdown } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";

type ExportSource = {
  id: string; source_version_id: string; title: string; publisher: string | null;
  final_locator: string; locator: unknown; retrieved_at: Date | string;
  access_level: string; text_coverage: string | null; extraction_method: string;
};

// Metadata is untrusted text, never Markdown/HTML supplied by a source.
function plain(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f]+/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~^-]/g, "\\$&");
}

function sourceLink(locator: string): string {
  try {
    const url = new URL(locator);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "Non-public document locator";
    const destination = url.href.replace(/[<>"\s()]/g, (c) => encodeURIComponent(c));
    return `[Open source](<${destination}>)`;
  } catch { return "Non-public document locator"; }
}

export function reportMarkdownWithSources(blocks: ReportBlock[], sources: ExportSource[], limitations: string[] = []): string {
  const ids = [...new Set(blocks.flatMap((block) => block.citationIds))];
  const references = new Map(ids.map((id, index) => [id, `[^source-${index + 1}]`]));
  const byId = new Map(sources.map((source) => [source.id, source]));
  const bibliography = ids.map((id, index) => {
    const source = byId.get(id);
    const label = `[^source-${index + 1}]:`;
    if (!source) return `${label} Source unavailable. Passage: ${plain(id)}.`;
    const date = new Date(source.retrieved_at);
    const retrieved = Number.isNaN(date.valueOf()) ? "unknown" : date.toISOString();
    return `${label} ${plain(source.title)}${source.publisher ? ` — ${plain(source.publisher)}` : ""}. ${sourceLink(source.final_locator)}. ` +
      `Retrieved: ${retrieved}. Access: ${plain(source.access_level)}; coverage: ${plain(source.text_coverage ?? "unknown")}. ` +
      `Passage locator: ${plain(JSON.stringify(source.locator))}. Extraction: ${plain(source.extraction_method)}. ` +
      `Source version: ${source.source_version_id}; passage: ${source.id}.`;
  });
  return [blocksToMarkdown(blocks, references),
    ...(limitations.length ? ["## Limitations", limitations.map(plain).join("\n\n")] : []),
    ...(bibliography.length ? ["## Sources", bibliography.join("\n\n")] : [])].join("\n\n");
}

export async function exportReportForAccount(db: Queryable, reportId: string, accountId: string): Promise<string | null> {
  // One statement gives report and bibliography the same deletion/ownership snapshot.
  const report = await db.query<{ blocks: unknown; limitations: unknown; sources: ExportSource[] }>(`SELECT r.blocks,r.limitations,
    COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM (
      SELECT p.id,p.source_version_id,p.locator,p.extraction_method,
        s.title,s.publisher,v.final_locator,v.retrieved_at,v.access_level,v.text_coverage
      FROM authorized_run_passages p JOIN source_versions v ON v.id=p.source_version_id AND v.account_id=p.account_id
      JOIN sources s ON s.id=v.source_id AND s.account_id=p.account_id
      WHERE p.account_id=r.account_id AND p.run_id=r.run_id AND p.id::text IN (
        SELECT jsonb_array_elements_text(block->'citationIds') FROM jsonb_array_elements(r.blocks) block
      )
    ) e),'[]'::jsonb) AS sources
    FROM reports r JOIN accounts a ON a.id=r.account_id
    WHERE r.id=$1 AND r.account_id=$2 AND a.deleted_at IS NULL AND r.redacted_at IS NULL`, [reportId, accountId]);
  if (!report.rows[0]) return null;
  const blocks = ReportBlockSchema.array().parse(report.rows[0].blocks);
  const limitations = CanonicalReportSchema.shape.limitations.parse(report.rows[0].limitations);
  return reportMarkdownWithSources(blocks, report.rows[0].sources, limitations);
}
