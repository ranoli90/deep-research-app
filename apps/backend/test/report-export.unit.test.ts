import { describe, expect, it } from "vitest";
import type { ReportBlock } from "@deep/contracts";
import { reportMarkdownWithSources } from "../src/modules/report-export.js";

const id = "aaaaaaaa-1111-4000-8000-000000000001";
const other = "aaaaaaaa-1111-4000-8000-000000000002";
const source = { id, source_version_id: "bbbbbbbb-1111-4000-8000-000000000001", title: "Café wetland study",
  publisher: "Research Institute", final_locator: "https://example.org/study?edition=2", locator: { kind: "page", block: "page:3:block:2" },
  retrieved_at: "2026-09-17T12:00:00.000Z", access_level: "partial-text", text_coverage: "partial", extraction_method: "docling-parse" };
const blocks: ReportBlock[] = [{ id: "answer", kind: "text", text: "Café wetlands cover 20 hectares.", claimIds: [], citationIds: [id, other] },
  { id: "again", kind: "quote", text: "20 hectares", claimIds: [], citationIds: [id] }];

describe("W07 V6-F18 export bibliography", () => {
  it("preserves required counterevidence limitations in shared Markdown as escaped text", () => {
    const md = reportMarkdownWithSources(blocks, [source], [
      'Counterevidence check for “Wetlands cover 20 hectares”: contradicted. This conclusion remains unresolved.',
      '<script>untrusted</script> [link](javascript:evil)',
    ]);
    expect(md).toContain("## Limitations");
    expect(md).toContain('Counterevidence check for “Wetlands cover 20 hectares”: contradicted');
    expect(md).toContain('This conclusion remains unresolved');
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('[link](javascript:evil)');
  });
  it("resolves repeated references once, retains full identities and PDF locators, and avoids prefix collisions", () => {
    const md = reportMarkdownWithSources(blocks, [source, { ...source, id: other, title: "Second source" }]);
    expect(md).toContain("Café wetlands cover 20 hectares.");
    expect(md.match(/\[\^source-1\]:/g)).toHaveLength(1);
    expect(md.match(/\[\^source-1\]/g)).toHaveLength(3);
    expect(md).toContain("[^source-2]: Second source");
    expect(md).toContain("[Open source](<https://example.org/study?edition=2>)");
    expect(md).toContain("page:3:block:2");
    expect(md).toContain(`Source version: ${source.source_version_id}; passage: ${id}`);
    expect(md).toContain("coverage: partial");
  });
  it("marks absent evidence unavailable and does not invent a bibliography for uncited text", () => {
    expect(reportMarkdownWithSources(blocks, [])).toContain("[^source-2]: Source unavailable.");
    expect(reportMarkdownWithSources([{ ...blocks[0]!, citationIds: [] }], [source])).not.toContain("## Sources");
  });
  it.each(["javascript:alert(1)", "data:text/html,secret", "attachment://private/file", "https://user:password@example.org/file"])(
    "does not export executable, private or credentialed locator %s", (final_locator) => {
      const md = reportMarkdownWithSources(blocks, [{ ...source, final_locator, title: "<img src=x onerror=alert(1)> [bad](javascript:evil)" }]);
      expect(md).toContain("Non-public document locator");
      expect(md).not.toContain("<img");
      expect(md).not.toContain("[bad](javascript:evil)");
      expect(md).not.toContain(final_locator);
    });
});
