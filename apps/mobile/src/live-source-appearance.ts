import { publicSourceUrl, sourceDomain } from "./source-view";
import type { ResearchEvent } from "./research-activity";

/** Domain pill shown only from a real public URL. Never invent hosts or favicons. */
export type LiveSourcePill = {
  key: string;
  domain: string;
  url: string;
  /** Owned icon bytes/uri only. Third-party favicon CDNs are forbidden (query leakage + fake icons). */
  faviconUri: string | null;
};

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]},]+/gi;

/** First safe public http(s) URL in free text, or null. */
export function extractPublicUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = publicSourceUrl(match[0].replace(/[.,;:!?)]+$/u, ""));
    if (url) return url;
  }
  return null;
}

/**
 * During-search source pills.
 * Public events today expose type + publicSummary only (no payload locators).
 * Show a domain pill only when that summary (or a future related URL field) contains
 * a safe public URL. Do not parse titles into hosts. Do not animate a favicon strip
 * of arriving domains. Do not fetch third-party favicon CDNs.
 */
export function liveSourcePillsFromEvents(events: ResearchEvent[]): LiveSourcePill[] {
  const byDomain = new Map<string, LiveSourcePill>();
  for (const event of events.slice().sort((a, b) => a.sequence - b.sequence)) {
    const type = event.type.toLowerCase();
    if (type !== "opened_source" && type !== "source_read") {
      continue;
    }
    const url = extractPublicUrl(event.publicSummary);
    if (!url) continue;
    const domain = sourceDomain(url);
    if (!domain) continue;
    if (byDomain.has(domain)) continue;
    byDomain.set(domain, { key: domain, domain, url, faviconUri: null });
  }
  return [...byDomain.values()];
}
