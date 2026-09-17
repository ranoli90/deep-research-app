import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { MAX_FETCH_BYTES, MAX_ATTACHMENT_BYTES } from "@deep/contracts";

const Cell = z.object({ text: z.string().max(1_000_000), header: z.boolean(),
  colspan: z.number().int().min(1).max(1000), rowspan: z.number().int().min(1).max(1000), scope: z.string().max(100) }).strict();
export const ExtractedDocument = z.object({
  version: z.enum(["trafilatura-2.2.0/structure-v1", "pypdf-6.19.0/digital-v1", "docling-parse-7.20.0/geometry-v1", "utf8-notes-v1", "unavailable-v1"]), digest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["extracted", "partial", "unavailable"]), warnings: z.array(z.string().max(200)).max(100),
  blocks: z.array(z.object({ kind: z.enum(["text", "heading", "code", "table"]),
    locator: z.string().max(200), text: z.string().max(1_000_000), rows: z.array(z.array(Cell).max(1000)).max(10000),
    geometry: z.array(z.object({ text: z.string().max(1_000_000), box: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]) }).strict()).max(10000).optional() }).strict()).max(10000),
}).strict();
export type ExtractedDocument = z.infer<typeof ExtractedDocument>;

/** Bytes only. No project mount, credentials, network or arbitrary executable arguments. */
export function extractOffline(bytes: Buffer, mime: string, options: { signal?: AbortSignal; runtime?: string } = {}): Promise<ExtractedDocument> {
  if (bytes.length > (mime === "application/pdf" || mime === "text/plain" || mime === "text/markdown" ? MAX_ATTACHMENT_BYTES : MAX_FETCH_BYTES)) return Promise.reject(new Error("extraction_too_large"));
  const runtime = options.runtime ?? process.env.EXTRACTION_RUNTIME;
  if (!runtime || !isAbsolute(runtime)) return Promise.reject(new Error("extraction_runtime_unavailable"));
  const script = fileURLToPath(new URL("../../../extraction/extract.py", import.meta.url));
  const args = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", resolve(runtime), "/runtime", "--ro-bind", script, "/extract.py",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--chdir", "/tmp",
    "--setenv", "OPENBLAS_NUM_THREADS", "1", "--setenv", "OMP_NUM_THREADS", "1",
    "--setenv", "PATH", "/usr/bin", "--setenv", "LANG", "C.UTF-8",
    "/runtime/bin/python", "-I", "/extract.py"];
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  return new Promise((done, reject) => {
    const child = spawn("/usr/bin/bwrap", args, { env: {}, stdio: ["pipe", "pipe", "ignore"], signal });
    const chunks: Buffer[] = [];
    let size = 0;
    child.on("error", () => reject(new Error("extraction_sandbox_unavailable_or_aborted")));
    child.stdin.on("error", () => {}); // Exit handler owns closed-pipe failures.
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8_000_000) { child.kill("SIGKILL"); reject(new Error("extraction_output_too_large")); }
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      if (code !== 0) { reject(new Error("extraction_failed")); return; }
      try { done(ExtractedDocument.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))); }
      catch { reject(new Error("invalid_extraction_result")); }
    });
    child.stdin.end(JSON.stringify({ bytes: bytes.toString("base64"), mime }));
  });
}
