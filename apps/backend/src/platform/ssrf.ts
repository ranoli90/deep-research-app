import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MAX_FETCH_BYTES } from "@deep/contracts";
import * as transport from "./pinned-http.js";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"]);

export function isBlockedIp(ip: string): boolean {
  const value = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(value) === 4) {
    const [a, b, c] = value.split(".").map(Number) as [number, number, number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113);
  }
  // Global unicast only, excluding special/transition/documentation ranges.
  // Reject mapped addresses entirely, including hexadecimal IPv4 spellings.
  if (isIP(value) !== 6) return true;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  return !/^[23][0-9a-f]{3}:/.test(normalized) || /^2001:(?:0:|db8:|[01]?[0-9a-f]{1,2}:)/.test(normalized) || /^(?:2002|3fff):/.test(normalized);
}

async function resolveSafe(raw: string, signal?: AbortSignal): Promise<{ url: URL; address: { address: string; family: number } }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("invalid_url"); }
  if (url.username || url.password) throw new Error("credential_url_blocked");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme_blocked");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("port_blocked");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) throw new Error("host_blocked");
  const family = isIP(host);
  if (family && isBlockedIp(host)) throw new Error("ip_blocked");
  const resolved = family ? [{ address: host, family }] : await boundedLookup(host, signal);
  if (!resolved.length || resolved.some((r) => isBlockedIp(r.address))) throw new Error("resolved_ip_blocked");
  url.hash = "";
  return { url, address: resolved[0]! };
}

async function boundedLookup(host: string, signal?: AbortSignal) {
  const query = lookup(host, { all: true, verbatim: true });
  if (!signal) return query;
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const canceled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([query, canceled]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function assertSafeUrl(raw: string): Promise<URL> { return (await resolveSafe(raw)).url; }

export async function safeFetch(raw: string, init: { signal?: AbortSignal } = {}): Promise<{
  url: string; body: string; bytes: Buffer; status: number; mime: string; redirectChain: string[];
}> {
  const deadline = AbortSignal.timeout(12_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const visited = new Set<string>();
  let next = raw;
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    const { url, address } = await resolveSafe(next, signal);
    signal.throwIfAborted();
    if (visited.has(url.href)) throw new Error("redirect_loop");
    visited.add(url.href);
    const res = await transport.pinnedRequest(url, address, signal, MAX_FETCH_BYTES);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) throw new Error("redirect_missing");
      next = new URL(location, url).href;
      continue;
    }
    return { url: url.href, body: res.bytes.toString("utf8"), bytes: res.bytes, status: res.status,
      mime: res.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream",
      redirectChain: [...visited] };
  }
  throw new Error("redirect_limit");
}
