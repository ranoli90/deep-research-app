export const SOURCE_POLICY_VERSION = "source-policy.v1";

export type SourcePolicyMode = "open_web" | "prefer_primary" | "trusted_domains" | "allowed_domains" | "excluded_domains";

export type SourcePolicy = {
  version: typeof SOURCE_POLICY_VERSION;
  mode: SourcePolicyMode;
  trustedDomains: string[];
  allowedDomains: string[];
  excludedDomains: string[];
  userSuppliedUrls: string[];
};

export function defaultSourcePolicy(): SourcePolicy {
  return {
    version: SOURCE_POLICY_VERSION,
    mode: "open_web",
    trustedDomains: [],
    allowedDomains: [],
    excludedDomains: [],
    userSuppliedUrls: [],
  };
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return null;
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Government and intergovernmental hosts for "only official sources" / prefer_primary. */
export function isOfficialPrimaryHost(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  return (
    h.endsWith(".gov") ||
    h.endsWith(".mil") ||
    h === "gov.uk" ||
    h.endsWith(".gov.uk") ||
    h === "gc.ca" ||
    h.endsWith(".gc.ca") ||
    h === "europa.eu" ||
    h.endsWith(".europa.eu") ||
    h === "who.int" ||
    h.endsWith(".who.int") ||
    h === "un.org" ||
    h.endsWith(".un.org") ||
    h === "oecd.org" ||
    h.endsWith(".oecd.org") ||
    h === "imf.org" ||
    h.endsWith(".imf.org") ||
    h === "worldbank.org" ||
    h.endsWith(".worldbank.org")
  );
}

export function applySourcePolicy(policy: SourcePolicy, locator: string): "admit" | "prefer" | "exclude" {
  const host = hostOf(locator);
  if (!host) return "exclude";
  if (policy.excludedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return "exclude";
  if (policy.mode === "allowed_domains") {
    return policy.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`)) ? "admit" : "exclude";
  }
  if (policy.trustedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return "prefer";
  if (policy.mode === "prefer_primary") return isOfficialPrimaryHost(host) ? "prefer" : "exclude";
  return "admit";
}

export function parseDirectUrls(text: string): string[] {
  const found: string[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const host = hostOf(m[0].replace(/[),.;]+$/, ""));
    if (host) found.push(m[0].replace(/[),.;]+$/, ""));
  }
  return [...new Set(found)];
}

export function encodeSourcePolicy(policy: SourcePolicy): string[] {
  const rows = [`mode:${policy.mode}`];
  for (const d of policy.trustedDomains) rows.push(`trusted:${d}`);
  for (const d of policy.allowedDomains) rows.push(`allow:${d}`);
  for (const d of policy.excludedDomains) rows.push(`exclude:${d}`);
  for (const u of policy.userSuppliedUrls) rows.push(`url:${u}`);
  return rows;
}

export function policyFromRestrictions(restrictions: readonly string[] | undefined): SourcePolicy {
  const policy = defaultSourcePolicy();
  for (const raw of restrictions ?? []) {
    const [kind, ...rest] = raw.split(":");
    const value = rest.join(":").trim();
    if (!value) continue;
    if (kind === "mode" && ["open_web", "prefer_primary", "trusted_domains", "allowed_domains", "excluded_domains"].includes(value)) {
      policy.mode = value as SourcePolicyMode;
    } else if (kind === "trusted") policy.trustedDomains.push(value.toLowerCase());
    else if (kind === "allow") policy.allowedDomains.push(value.toLowerCase());
    else if (kind === "exclude") policy.excludedDomains.push(value.toLowerCase());
    else if (kind === "url") policy.userSuppliedUrls.push(value);
  }
  policy.trustedDomains = [...new Set(policy.trustedDomains)];
  policy.allowedDomains = [...new Set(policy.allowedDomains)];
  policy.excludedDomains = [...new Set(policy.excludedDomains)];
  policy.userSuppliedUrls = [...new Set(policy.userSuppliedUrls)];
  return policy;
}

export function mergeSteeringIntoPolicy(policy: SourcePolicy, message: string): SourcePolicy {
  const urls = parseDirectUrls(message);
  const next: SourcePolicy = {
    ...policy,
    userSuppliedUrls: [...new Set([...policy.userSuppliedUrls, ...urls])],
  };
  if (/\bonly use official|official sources|primary sources only\b/i.test(message)) {
    next.mode = "prefer_primary";
  }
  const exclude = message.match(/\bexclude\s+([a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (exclude?.[1]) next.excludedDomains = [...new Set([...next.excludedDomains, exclude[1].toLowerCase()])];
  return next;
}
