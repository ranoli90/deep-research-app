import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MAX_FETCH_BYTES } from "@deep/contracts";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"]);

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

export function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (v === "::1") return true;
  const o = ipv4Octets(v);
  if (o) {
    const [a, b] = o;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    return false;
  }
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  return false;
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.username || url.password) throw new Error("credential_url_blocked");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme_blocked");
  if (BLOCKED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("host_blocked");
  if (isIP(url.hostname) && isBlockedIp(url.hostname)) throw new Error("ip_blocked");
  const resolved = await lookup(url.hostname, { all: true, verbatim: true });
  for (const r of resolved) {
    if (isBlockedIp(r.address)) throw new Error("resolved_ip_blocked");
  }
  return url;
}

export async function safeFetch(raw: string, init: RequestInit = {}): Promise<{ url: string; body: string; status: number }> {
  const url = await assertSafeUrl(raw);
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(12_000) });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error("redirect_missing");
    const next = new URL(loc, url);
    await assertSafeUrl(next.toString());
    return safeFetch(next.toString(), init);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH_BYTES) throw new Error("response_too_large");
  return { url: url.toString(), body: buf.toString("utf8"), status: res.status };
}
