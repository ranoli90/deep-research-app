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

export function applySourcePolicy(policy: SourcePolicy, locator: string): "admit" | "prefer" | "exclude" {
  const host = hostOf(locator);
  if (!host) return "exclude";
  if (policy.excludedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return "exclude";
  if (policy.mode === "allowed_domains") {
    return policy.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`)) ? "admit" : "exclude";
  }
  if (policy.trustedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return "prefer";
  if (policy.mode === "prefer_primary") return "admit";
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
