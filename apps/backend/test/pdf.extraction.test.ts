import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { extractOffline } from "../src/adapters/extraction/offline.js";

it("W04 parses original digital PDF bytes into page-bound text with honest layout limitations", async () => {
  const bytes = await readFile(new URL("./fixtures/documents/digital-scoped.pdf", import.meta.url));
  const result = await extractOffline(bytes, "application/pdf");
  expect(result.digest).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(result.status).toBe("partial");
  expect(result.blocks).toHaveLength(2);
  expect(result.blocks[0]?.locator).toBe("page:1/block:0");
  expect(result.blocks[0]?.text).toContain("Ardent does not support underwater recording.");
  expect(result.blocks[1]?.locator).toBe("page:2/block:0");
  expect(result.blocks[1]?.text).toContain("This result does not apply to immersion or cold weather.");
  expect(result.blocks.every((b) => b.rows.length === 0)).toBe(true);
  expect(result.warnings).toContain("pdf_layout_tables_and_ocr_unverified");
});
it("W04 empty, malformed and pasted PDF inputs cannot manufacture documentary support", async () => {
  const empty = await extractOffline(await readFile(new URL("./fixtures/documents/empty-page.pdf", import.meta.url)), "application/pdf");
  expect(empty.status).toBe("unavailable"); expect(empty.blocks).toEqual([]);
  for (const bytes of [Buffer.from("pasted text labelled PDF"), Buffer.from("%PDF-1.7\nnot-a-real-document")]) {
    const invalid = await extractOffline(bytes, "application/pdf");
    expect(invalid.status).toBe("unavailable"); expect(invalid.blocks).toEqual([]);
    expect(invalid.warnings).toContain("invalid_pdf");
  }
});

it("W04 encrypted PDF remains explicitly unavailable without password guessing", async () => {
  const result = await extractOffline(await readFile(new URL("./fixtures/documents/encrypted.pdf", import.meta.url)), "application/pdf");
  expect(result.status).toBe("unavailable"); expect(result.blocks).toEqual([]);
  expect(result.warnings).toContain("encrypted_pdf_unsupported");
});

it("W04 binds a late-drawn bold negation to its physical sentence, with recoverable cell geometry", async () => {
  const result = await extractOffline(await readFile(new URL("./fixtures/documents/mixed-font-order.pdf", import.meta.url)), "application/pdf");
  expect(result.status).toBe("partial");
  expect(result.blocks[0]?.text).toBe("Kestrel MUST NOT allow data transfer after revocation.");
  expect(result.blocks[0]?.text).not.toContain("Kestrel allow");
  expect(result.blocks[0]?.geometry?.some((cell) => cell.text === "MUST NOT" && cell.box.length === 4)).toBe(true);
});
