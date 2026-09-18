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
  return independentConfirmationCountFromClusters(sources);
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

export const ORIGIN_RELATIONS = ["same-document", "syndicated", "quotes", "derived-from", "independent-unknown"] as const;
export type OriginRelation = (typeof ORIGIN_RELATIONS)[number];

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*[-|:]\s*(reuters|ap|pr newswire|business wire|techcrunch|the verge|blog)\s*$/u, "")
    .replace(/[^ \p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function snippetKey(snippet: string | undefined): string {
  return (snippet ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").slice(0, 120);
}

/**
 * Cluster syndicated copies of one announcement. Domain names alone do not
 * create independent confirmations. PostgreSQL-friendly: returns assigned cluster ids.
 */
export function clusterSourceOrigins(sources: StoredSource[]): Map<string, { cluster: string; relation: OriginRelation }> {
  const out = new Map<string, { cluster: string; relation: OriginRelation }>();
  const groups = new Map<string, StoredSource[]>();
  for (const s of sources) {
    const explicit = s.originCluster?.trim() ?? "";
    const title = normalizeTitle(s.title);
    const snippet = snippetKey(s.snippet);
    const key =
      explicit && !/^https?:\/\//i.test(explicit)
        ? explicit
        : title
          ? `title:${title}`
          : snippet
            ? `snippet:${snippet}`
            : `independent:${s.id}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  for (const [key, group] of groups) {
    const firstParty = group.find((s) => classifySourceIndependence(s) === "first-party");
    for (const s of group) {
      const cls = classifySourceIndependence(s);
      let relation: OriginRelation = "independent-unknown";
      if (group.length === 1) relation = "independent-unknown";
      else if (firstParty && s.id === firstParty.id) relation = "same-document";
      else if (firstParty && (cls === "secondary" || cls === "derived")) relation = "syndicated";
      else if (cls === "derived" || /quotes the|according to/i.test(s.snippet ?? s.title)) relation = "quotes";
      else if (group.length > 1) relation = "derived-from";
      out.set(s.id, { cluster: key, relation });
    }
  }
  return out;
}

/** Syndicated copies of one announcement count as one confirmation. */
export function independentConfirmationCountFromClusters(sources: StoredSource[]): number {
  const clustered = clusterSourceOrigins(sources);
  const clusters = new Set<string>();
  for (const s of sources) clusters.add(clustered.get(s.id)?.cluster ?? s.originCluster ?? `independent:${s.id}`);
  return clusters.size;
}
