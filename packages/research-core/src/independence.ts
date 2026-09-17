import type { SourceIndependenceClass, StoredSource } from "./types.js";

const FIRST_PARTY = new Set(["vendor-docs", "vendor-matrix", "primary-docs", "catalog", "regulator", "official"]);
const SECONDARY = new Set(["review-summary", "blog", "wire", "news", "aggregator", "marketing"]);
const COMMUNITY = new Set(["community", "forum", "complaint"]);

export function classifySourceIndependence(source: StoredSource): SourceIndependenceClass {
  const type = source.sourceType ?? "";
  if (FIRST_PARTY.has(type)) return "first-party";
  if (COMMUNITY.has(type) || /forum|reddit|community/i.test(`${source.title} ${source.locator}`)) return "community";
  if (SECONDARY.has(type)) return "secondary";
  if (/reprint|syndicat|quotes the|pasted the/i.test(source.snippet ?? source.title)) return "derived";
  return "independent";
}

export function markDerivedCopies(sources: StoredSource[]): Map<string, SourceIndependenceClass> {
  const byCluster = new Map<string, StoredSource[]>();
  for (const s of sources) {
    const key = s.originCluster ?? `independent:${s.id}`;
    const list = byCluster.get(key) ?? [];
    list.push(s);
    byCluster.set(key, list);
  }
  const out = new Map<string, SourceIndependenceClass>();
  for (const [, group] of byCluster) {
    const firstParty = group.find((s) => classifySourceIndependence(s) === "first-party");
    for (const s of group) {
      let cls = classifySourceIndependence(s);
      if (group.length > 1 && firstParty && s.id !== firstParty.id && cls !== "first-party") {
        cls = "derived";
      } else if (group.length > 1 && !firstParty && s !== group[0]) {
        cls = "derived";
      }
      out.set(s.id, cls);
    }
  }
  return out;
}

/** Unique origin clusters. Syndicated copies of one work count as one confirmation. */
export function independentConfirmationCount(sources: StoredSource[]): number {
  const clusters = new Set<string>();
  for (const s of sources) {
    clusters.add(s.originCluster ?? `independent:${s.id}`);
  }
  return clusters.size;
}

export function isWeakSourceClass(source: StoredSource): boolean {
  const cls = classifySourceIndependence(source);
  if (cls === "derived" || cls === "secondary" || cls === "community") return true;
  if (source.accessLevel === "snippet" || source.accessLevel === "discovered") {
    return /blog|roundup|review|listicle|aggregator|wire|hype/i.test(`${source.title} ${source.locator} ${source.sourceType ?? ""}`);
  }
  return false;
}

export const PRIMARY_SOURCE_TYPES = FIRST_PARTY;
export const WEAK_SOURCE_TYPES = new Set([...SECONDARY, ...COMMUNITY]);
