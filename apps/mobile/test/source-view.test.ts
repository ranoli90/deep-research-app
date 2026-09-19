import { expect, it } from "vitest";
import { readSourceDetail, publicSourceUrl, sourceDomain, sourceLocation, sourceCellLabel, sourceFreshnessCopy, sourceIndependenceCopy } from "../src/source-view";
import { readingOffset, readingScrollY, visibleReadingBlock } from "../src/report-layout";
import { restoreAnchor } from "../src/state";
const source = { passageId: "p", title: "Document", exactText: "Exact – clause\nsecond line", accessLevel: "partial-text", coverage: "partial", warnings: ["columns_unassessed"], passageLocator: { block: "page:12/block:0", rows: [], geometry: [{ text: "Exact – clause", box: [1, 2, 3, 4] }] } };
it("does not call a null publication date current", () => {
  expect(sourceFreshnessCopy({})).toMatch(/not treated as current/i);
  expect(sourceFreshnessCopy({ retrievedAt: "2026-09-18T12:00:00.000Z" })).toMatch(/not treated as current/i);
  expect(sourceFreshnessCopy({ publicationDate: "2024-06-01", retrievedAt: "2026-09-18T12:00:00.000Z" })).toContain("Published 2024-06-01");
  expect(sourceIndependenceCopy({ originRelation: "syndicated" })).toMatch(/not an independent confirmation/i);
});
it("preserves exact passage, ordered tables, warnings and geometry from the source response", () => {
  const value = readSourceDetail(source);
  expect(value.exactText).toBe(source.exactText); expect(value.passageLocator).toEqual(source.passageLocator);
  expect(value.warnings).toEqual(["columns_unassessed"]); expect(sourceLocation(value)).toBe("Document page 12 · block 0");
  expect(sourceLocation({ ...value, passageLocator: undefined })).toBe("Passage location unavailable.");
});
it("rejects malformed source metadata instead of dropping material extraction limitations", () => {
  for (const value of [null, {}, { ...source, warnings: "lost" }, { ...source, publisher: {} }, { ...source, passageLocator: { rows: [[42]] } }, { ...source, passageLocator: { geometry: [{ text: "x", box: [1, 2, NaN, 4] }] } }]) expect(() => readSourceDetail(value)).toThrow();
});
it("only offers explicit HTTP(S) originals without credentials", () => {
  expect(publicSourceUrl("https://example.org/paper?q=1")).toBe("https://example.org/paper?q=1");
  expect(sourceDomain("https://www.example.org/paper?q=1")).toBe("example.org");
  for (const url of [undefined, "attachment://private", "javascript:alert(1)", "file:///private", "https://user:secret@example.org/", "invalid", "http://localhost:8787/x", "https://192.168.0.5/x", "https://10.1.2.3/x", "https://172.16.9.9/x", "http://127.0.0.1/x", "http://localhost./x", "http://printer.local./x", "https://vault.internal/x", "https://metadata.google.internal/"]) expect(publicSourceUrl(url)).toBeNull();
  expect(sourceDomain("https://vault.internal/x")).toBeNull();
  expect(sourceDomain("https://10.1.2.3/secret")).toBeNull();
});
it("restores a deep citation at the same scroll offset using card-relative block coordinates", () => {
  const offset = readingOffset(940, 160, 700);
  expect(offset).toBe(80); expect(readingScrollY(160, 700, offset)).toBe(940);
  // An invoking citation can be below the viewport's top; signed offset retains its context.
  expect(readingScrollY(160, 1000, readingOffset(940, 160, 1000))).toBe(940);
  expect(visibleReadingBlock({ answer: 50, detail: 700, caveat: 1100 }, 160, 940)).toBe("detail");
});
it("a removed block resets stale within-block offset and explains the change", () => {
  const result = restoreAnchor({ reportId: "r", blockId: "gone", offset: 900 }, [{ id: "new", kind: "text", text: "x", citationIds: [], claimIds: [] }]);
  expect(result.anchor).toEqual({ reportId: "r", blockId: "new", offset: 0 }); expect(result.note).toContain("changed");
});
it("accepts actual extractor cell objects without losing header, span or scope", () => {
  const rows = [[{ text: "Annual amount", header: true, colspan: 2, rowspan: 1, scope: "col" }], [{ text: "30", header: false, colspan: 1, rowspan: 1, scope: "" }]];
  expect(readSourceDetail({ ...source, passageLocator: { block: "table:1", rows } }).passageLocator?.rows).toEqual(rows);
  expect(sourceCellLabel(rows[0]![0]!)).toBe("Header: Annual amount (spans 2 columns) (scope: col)");
});
