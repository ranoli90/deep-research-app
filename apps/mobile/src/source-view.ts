export type SourceCell = { text: string; header: boolean; colspan: number; rowspan: number; scope: string };
export type SourceDetail = {
  passageId: string; sourceId?: string; title: string; exactText: string; accessLevel: string;
  locator?: string; publisher?: string | null; sourceVersionId?: string;
  extractionMethod?: string; coverage?: string | null; warnings?: string[];
  originCluster?: string | null; originRelation?: string | null;
  publicationDate?: string | null; retrievedAt?: string | null;
  passageLocator?: { block?: string; kind?: string; rows?: SourceCell[][];
    geometry?: { text: string; box: [number, number, number, number] }[]; coordinates?: string };
};
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validCell(value: unknown): value is SourceCell {
  return record(value) && typeof value.text === "string" && typeof value.header === "boolean" && typeof value.scope === "string" &&
    typeof value.colspan === "number" && Number.isInteger(value.colspan) && value.colspan >= 1 && value.colspan <= 1000 &&
    typeof value.rowspan === "number" && Number.isInteger(value.rowspan) && value.rowspan >= 1 && value.rowspan <= 1000;
}
export function sourceCellLabel(cell: SourceCell): string {
  return `${cell.header ? "Header: " : ""}${cell.text}${cell.colspan > 1 ? ` (spans ${cell.colspan} columns)` : ""}${cell.rowspan > 1 ? ` (spans ${cell.rowspan} rows)` : ""}${cell.scope ? ` (scope: ${cell.scope})` : ""}`;
}
/** Validate the source response before adopting or rendering any provider-derived metadata. */
export function readSourceDetail(value: unknown): SourceDetail {
  if (!record(value) || ![value.passageId, value.title, value.exactText, value.accessLevel].every(v => typeof v === "string")) throw new Error("The source response is unavailable or invalid.");
  for (const key of ["sourceId", "locator", "publisher", "sourceVersionId", "extractionMethod", "coverage", "originCluster", "originRelation", "publicationDate", "retrievedAt"])
    if (value[key] != null && typeof value[key] !== "string") throw new Error("The source metadata is invalid.");
  if (value.warnings != null && (!Array.isArray(value.warnings) || !value.warnings.every(v => typeof v === "string"))) throw new Error("The source warnings are invalid.");
  if (value.passageLocator != null) {
    const p = value.passageLocator;
    if (!record(p) || ["block", "kind", "coordinates"].some(key => p[key] != null && typeof p[key] !== "string") ||
      (p.rows != null && (!Array.isArray(p.rows) || !p.rows.every(row => Array.isArray(row) && row.every(validCell)))) ||
      (p.geometry != null && (!Array.isArray(p.geometry) || !p.geometry.every(g => record(g) && typeof g.text === "string" && Array.isArray(g.box) && g.box.length === 4 && g.box.every(n => typeof n === "number" && Number.isFinite(n)))))) throw new Error("The source location is invalid.");
  }
  return value as SourceDetail;
}
export function sourceDomain(value: string | undefined): string | null {
  const url = publicSourceUrl(value);
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host.includes(":")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return true;
}

export function publicSourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (!isPublicHostname(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
export function sourceFreshnessCopy(source: Pick<SourceDetail, "publicationDate" | "retrievedAt">): string {
  if (!source.publicationDate) {
    return source.retrievedAt
      ? `Retrieved ${source.retrievedAt.slice(0, 10)}. Publication date unknown — not treated as current.`
      : "Publication date unknown — not treated as current.";
  }
  return source.retrievedAt
    ? `Published ${source.publicationDate}. Retrieved ${source.retrievedAt.slice(0, 10)}.`
    : `Published ${source.publicationDate}.`;
}

export function sourceIndependenceCopy(source: Pick<SourceDetail, "originRelation" | "originCluster">): string {
  if (source.originRelation === "syndicated" || source.originRelation === "quotes" || source.originRelation === "derived-from") {
    return "This looks like a syndicated or derived copy, not an independent confirmation.";
  }
  if (source.originRelation === "same-document") return "This passage is from the same work as another cited source.";
  if (source.originCluster) return "Grouped with other sources that appear to share an origin.";
  return "Independence not established.";
}

export function sourceLocation(source: SourceDetail): string {
  const block = source.passageLocator?.block;
  if (!block) return "Passage location unavailable.";
  const page = /^page:(\d+)(?:[/:]block:(\d+))?$/.exec(block);
  return page ? `Document page ${page[1]}${page[2] !== undefined ? ` · block ${page[2]}` : ""}` : block;
}
