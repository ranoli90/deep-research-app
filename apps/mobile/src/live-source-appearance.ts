import { publicSourceUrl } from "./source-view";
import type { ResearchEvent } from "./research-activity";

/** Domain pill shown only from a real public URL. Never invent hosts or favicons. */
export type LiveSourcePill = {
  key: string;
  domain: string;
  /** Raw locators are not on the consumer activity contract. */
  url: string | null;
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
 * Domain pills may appear only from typed activity.sourceDomain on a source_reading
 * event. Do not parse legacy publicSummary. Do not invent hosts or fetch favicon CDNs.
 */
/** Visible domain pills; overflow is a +N caption, never invented hosts. */
export const LIVE_SOURCE_PILL_LIMIT = 4;

export function visibleLiveSourcePills(pills: LiveSourcePill[], limit = LIVE_SOURCE_PILL_LIMIT): {
  visible: LiveSourcePill[];
  overflow: number;
} {
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : LIVE_SOURCE_PILL_LIMIT;
  return {
    visible: pills.slice(0, cap),
    overflow: Math.max(0, pills.length - cap),
  };
}

export function liveSourcePillsFromEvents(events: ResearchEvent[]): LiveSourcePill[] {
  const byDomain = new Map<string, LiveSourcePill>();
  for (const event of events.slice().sort((a, b) => a.sequence - b.sequence)) {
    if (event.activity?.kind !== "source_reading") continue;
    const domain = event.activity.sourceDomain?.trim() || null;
    if (!domain || byDomain.has(domain)) continue;
    byDomain.set(domain, { key: domain, domain, url: null, faviconUri: null });
  }
  return [...byDomain.values()];
}
