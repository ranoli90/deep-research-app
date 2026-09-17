import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractOffline } from "../src/adapters/extraction/offline.js";

describe("W04 real isolated parser over supplied synthetic bytes", () => {
  it("preserves all decisive spans and exact byte digests", async () => {
    const root = new URL("./fixtures/extraction/", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("EXPECTED.json", root), "utf8"));
    for (const entry of manifest.cases) {
      // HTTP status is a separate transport gate, not an extractor inference.
      if (entry.status !== 200) continue;
      const bytes = await readFile(new URL(entry.file, root));
      const result = await extractOffline(bytes, entry.mime);
      expect(result.digest, entry.id).toBe(createHash("sha256").update(bytes).digest("hex"));
      const text = result.blocks.map((b) => b.text).join("\n");
      for (const required of entry.expected.must_preserve ?? []) expect(text, entry.id).toContain(required);
      if (entry.id === "HTML-07") expect(result.status).toBe("unavailable");
      if (entry.id === "HTML-02") {
        const table = result.blocks.find((b) => b.kind === "table")!;
        expect(table.rows.some((row) => row.some((c) => c.text === "France") && row.some((c) => c.text.includes("90 EUR/month")))).toBe(true);
        expect(table.text).toContain("Annual prepayment is required");
      }
    }
  });
  it("handles actual plain text and preserves table spans without executing script", async () => {
    const plain = await extractOffline(Buffer.from("A private note.\n\nSecond paragraph."), "text/plain");
    expect(plain.blocks.map((b) => b.text)).toEqual(["A private note.", "Second paragraph."]);
    const html = Buffer.from('<main><p>Reference table with a scoped applicability footnote.</p><table><tr><th colspan="2">Plan scope</th></tr><tr><td>North</td><td>Available<a href="#n">1</a></td></tr></table><p id="n">Only for annual subscriptions.</p><script>fetch("https://unapproved.invalid/")</script></main>');
    const result = await extractOffline(html, "text/html");
    const table = result.blocks.find((b) => b.kind === "table")!;
    expect(table.rows[0]![0]!.colspan).toBe(2);
    expect(table.text).toContain("Only for annual subscriptions.");
    expect(JSON.stringify(result)).not.toContain("unapproved.invalid");
  });
  it("does not label PDF bytes as parsed text", async () => {
    const result = await extractOffline(Buffer.from("%PDF-1.7\nnot-a-real-document"), "application/pdf");
    expect(result.status).toBe("unavailable");
    expect(result.blocks).toEqual([]);
    expect(result.warnings).toContain("unsupported_mime");
  });
});
