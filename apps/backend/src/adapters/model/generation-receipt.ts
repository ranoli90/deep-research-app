import { createHash } from "node:crypto";
import { z } from "zod";
import type { GenerationLookup } from "../../ports/provider-receipt.js";
import { costToMicro } from "./usage.js";

const Envelope = z.object({ data: z.object({ id: z.string().min(1).max(300), model: z.string().min(1).max(300),
  provider_name: z.string().min(1).max(300), total_cost: z.union([z.string().max(100), z.number()]) }) });

/** Fixed read-only metadata endpoint. Never resends the original completion/search. */
export async function lookupGenerationReceipt(args: { providerId: string; apiKey: string; signal: AbortSignal;
  deadlineMs?: number }): Promise<GenerationLookup> {
  const unavailable = (reason: string): GenerationLookup => ({ kind: "unavailable", reason });
  const deadline = args.deadlineMs ?? 10_000;
  if (!args.apiKey.trim() || !args.providerId || args.providerId.length > 300 ||
      /[\x00-\x1f\x7f]/.test(args.providerId) || !Number.isSafeInteger(deadline) || deadline < 1 || deadline > 10_000)
    return unavailable("invalid_receipt_lookup");
  if (args.signal.aborted) return unavailable("receipt_lookup_cancelled");
  // Own the deadline timer: Node 20 can collect a transient timeout signal used
  // only through AbortSignal.any, losing the deadline while fetch never settles.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(args.signal.reason);
  args.signal.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), deadline);
  const signal = controller.signal;
  let onAbort: (() => void) | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("receipt_lookup_aborted"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    const url = new URL("https://openrouter.ai/api/v1/generation");
    url.searchParams.set("id", args.providerId);
    const response = await Promise.race([fetch(url, { method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${args.apiKey.trim()}` } }), aborted]);
    if (!response.ok) {
      if (response.body) void response.body.cancel().catch(() => undefined);
      return unavailable(`receipt_http_${response.status}`);
    }
    if (!response.body) return unavailable("receipt_empty_body");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 64_000) return unavailable("receipt_body_too_large");
      chunks.push(part.value);
    }
    const raw = Buffer.concat(chunks);
    const parsed = Envelope.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
    if (!parsed.success || parsed.data.data.id !== args.providerId) return unavailable("receipt_identity_mismatch");
    const data = parsed.data.data, actualMicro = costToMicro(data.total_cost);
    if (actualMicro === undefined) return unavailable("receipt_cost_unavailable");
    return { kind: "receipt", receipt: { version: "openrouter-generation-cost.v1", providerId: data.id,
      model: data.model, provider: data.provider_name, actualMicro, rawCost: String(data.total_cost),
      retrievedAt: new Date().toISOString(), responseDigest: createHash("sha256").update(raw).digest("hex") } };
  } catch { return unavailable("receipt_lookup_unavailable"); }
  finally {
    clearTimeout(timer);
    args.signal.removeEventListener("abort", forwardAbort);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    if (reader) void reader.cancel().catch(() => undefined);
  }
}
