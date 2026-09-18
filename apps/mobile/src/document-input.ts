/** Client preflight only; the binary API independently validates bytes and ownership. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export function documentMetadata(name: string, size: number) {
  if (!name || name.length > 180 || /[\\/\x00-\x1f\x7f]/.test(name)) throw new Error("Invalid document filename.");
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_DOCUMENT_BYTES) throw new Error("Choose a nonempty document up to 8 MiB.");
  const extension = name.toLowerCase().split(".").pop();
  const mime = extension === "pdf" ? "application/pdf" : extension === "md" ? "text/markdown" : extension === "txt" ? "text/plain" : null;
  if (!mime) throw new Error("Choose a PDF, text (.txt), or Markdown (.md) document.");
  return { filename: name, mime };
}
