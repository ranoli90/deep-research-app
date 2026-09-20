import { publicSourceUrl } from "@deep/contracts";

/** Client preflight only; the binary API independently validates bytes and ownership. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Attach a public URL as a text note. Private/internal hosts are rejected. */
export function publicUrlAttachment(raw: string): { filename: string; mime: "text/plain"; text: string } {
  const url = publicSourceUrl(raw.trim());
  if (!url) throw new Error("Enter a public http(s) URL.");
  let host = "source";
  try {
    host = new URL(url).hostname.replace(/^www\./, "") || "source";
  } catch {
    /* keep fallback name */
  }
  const filename = `${host.replace(/[^a-z0-9.-]/gi, "-").slice(0, 40) || "source"}.txt`;
  return { filename, mime: "text/plain", text: url };
}

export function documentMetadata(name: string, size: number) {
  if (!name || name.length > 180 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new Error("Invalid document filename.");
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_DOCUMENT_BYTES) throw new Error("Choose a nonempty document up to 8 MiB.");
  const extension = name.toLowerCase().split(".").pop();
  const mime = extension === "pdf" ? "application/pdf" : extension === "md" ? "text/markdown" : extension === "txt" ? "text/plain" : null;
  if (!mime) throw new Error("Choose a PDF, text (.txt), or Markdown (.md) document.");
  return { filename: name, mime };
}
