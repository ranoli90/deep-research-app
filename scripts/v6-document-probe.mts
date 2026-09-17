import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readSource } from "../apps/backend/src/adapters/retrieval/read-source.js";
const url = "https://www.rfc-editor.org/rfc/rfc9112.pdf";
const root = "/tmp/deep-v6-pdf";
await mkdir(root, { recursive: true });
const started = performance.now();
const result = await readSource(url, AbortSignal.timeout(40_000));
if (result.bytes) await writeFile(`${root}/rfc9112.pdf`, result.bytes);
if (result.extraction) await writeFile(`${root}/rfc9112-extraction.json`, JSON.stringify(result.extraction, null, 2));
const expected = "A sender MUST NOT send a Content-Length header field in any message that contains a Transfer-Encoding header field.";
// Comparison tolerates a physical line break after a retained hyphen; stored evidence is unchanged.
const decisivePages = result.extraction?.blocks.filter((block) => block.text.normalize("NFKC").replace(/-\n(?=[A-Za-z])/g, "-").replace(/\s+/g, " ").includes(expected)).map((block) => block.locator) ?? [];
const artifact = { task: "W04/V6-F07", revision: process.env.PROBE_REVISION ?? "unrecorded",
  command: "EXTRACTION_RUNTIME=/absolute/path/to/venv pnpm exec tsx scripts/v6-document-probe.mts",
  scope: "Public non-sensitive technical PDF through production safe transport and offline extractor; no model, quality benchmark or human adjudication",
  receipt: result.receipt, digest: result.bytes ? createHash("sha256").update(result.bytes).digest("hex") : null,
  bytes: result.bytes?.length ?? 0, extractionVersion: result.extraction?.version,
  status: result.extraction?.status ?? "unavailable", warnings: result.extraction?.warnings ?? [],
  decisiveReference: { source: "https://www.rfc-editor.org/rfc/rfc9112.html#section-6.2", expected, matchedLocators: decisivePages, review: "agent checked reference and rendered page; not human adjudication" },
  blockCount: result.extraction?.blocks.length ?? 0, wallMs: Math.round(performance.now() - started) };
await writeFile(`${root}/rfc9112-result.json`, JSON.stringify(artifact, null, 2) + "\n");
console.log(JSON.stringify(artifact));
if (!result.extraction?.blocks.length || !decisivePages.includes("page:18/block:0")) process.exitCode = 1;
