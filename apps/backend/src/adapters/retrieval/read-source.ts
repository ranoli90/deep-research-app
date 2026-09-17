import { safeFetch } from "../../platform/ssrf.js";
import { extractOffline, type ExtractedDocument } from "../extraction/offline.js";
import type { DownloadReceipt } from "../../modules/evidence.js";

/** Network access and offline extraction remain separate; failure text is never evidence. */
export async function readSource(locator: string, signal: AbortSignal): Promise<{
  receipt: DownloadReceipt; bytes?: Buffer; extraction?: ExtractedDocument;
}> {
  const receipt: DownloadReceipt = { requestedUrl: locator, finalUrl: locator, redirectChain: [],
    status: null, mime: "application/octet-stream", retrievedAt: new Date().toISOString(), outcome: "fetch_unavailable" };
  let fetched: Awaited<ReturnType<typeof safeFetch>>;
  try { fetched = await safeFetch(locator, { signal }); }
  catch { return { receipt }; }
  Object.assign(receipt, { finalUrl: fetched.url, status: fetched.status, mime: fetched.mime,
    redirectChain: fetched.redirectChain, outcome: "successful_body" });
  if (fetched.status < 200 || fetched.status >= 300) {
    receipt.outcome = "unavailable_status";
    return { receipt, bytes: fetched.bytes };
  }
  try {
    const extraction = await extractOffline(fetched.bytes, fetched.mime, { signal });
    if (extraction.status === "unavailable") receipt.outcome = "extraction_unavailable";
    return { receipt, bytes: fetched.bytes, extraction };
  } catch { receipt.outcome = "extraction_unavailable"; return { receipt, bytes: fetched.bytes }; }
}
