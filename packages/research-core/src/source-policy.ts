export const SOURCE_POLICY_VERSION = "source-policy.v2";

export type SourcePolicyMode = "open_web" | "primary_only" | "prefer_primary" | "trusted_domains" | "allowed_domains" | "excluded_domains";

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
    primarySourceEntity(`https://${h}`) !== null ||
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

/** Curated host/entity bindings are application policy, never inferred from source claims. */
const PRIMARY_ENTITIES = [
  {hosts:["ietf.org","rfc-editor.org"],entity:"ietf",terms:/\b(ietf|rfc|http|internet|protocol)\b/i,sourceType:"primary-docs"},
  {hosts:["w3.org"],entity:"w3c",terms:/\b(w3c|web|html|css|accessibility)\b/i,sourceType:"primary-docs"},
  {hosts:["iso.org","iec.ch"],entity:"iso-iec",terms:/\b(iso|iec|standard)\b/i,sourceType:"primary-docs"},
  {hosts:["python.org"],entity:"python",terms:/\bpython\b/i,sourceType:"official"},
  {hosts:["sqlite.org"],entity:"sqlite",terms:/\bsqlite\b/i,sourceType:"official"},
  {hosts:["kernel.org"],entity:"linux",terms:/\b(linux|kernel)\b/i,sourceType:"official"},
  {hosts:["microsoft.com"],entity:"microsoft",terms:/\b(microsoft|windows|azure|surface|office)\b/i,sourceType:"vendor-docs"},
  {hosts:["apple.com"],entity:"apple",terms:/\b(apple|iphone|ipad|mac|macbook|ios)\b/i,sourceType:"vendor-docs"},
  {hosts:["nvidia.com"],entity:"nvidia",terms:/\b(nvidia|cuda|geforce|rtx|gpu)\b/i,sourceType:"vendor-docs"},
  {hosts:["amd.com"],entity:"amd",terms:/\b(amd|radeon|ryzen|rocm|gpu)\b/i,sourceType:"vendor-docs"},
  {hosts:["intel.com"],entity:"intel",terms:/\b(intel|xeon|processor|cpu)\b/i,sourceType:"vendor-docs"},
  {hosts:["openai.com"],entity:"openai",terms:/\b(openai|chatgpt|gpt|codex)\b/i,sourceType:"vendor-docs"},
] as const;
export function primarySourceEntity(locator:string, question?:string): {entity:string;sourceType:string}|null {
  const host=hostOf(locator);
  if(!host)return null;
  const match=PRIMARY_ENTITIES.find(item=>item.hosts.some(domain=>host===domain||host.endsWith(`.${domain}`))&&(!question||item.terms.test(question)));
  return match?{entity:match.entity,sourceType:match.sourceType}:null;
}

/** Explicit user URLs are fetched unless the host is excluded or the locator is invalid. prefer_primary does not drop them. */
export function admitUserSuppliedUrl(policy: SourcePolicy, locator: string): boolean {
  const host = hostOf(locator);
  if (!host) return false;
  if (policy.excludedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  return policy.userSuppliedUrls.includes(locator);
}

export function applySourcePolicy(policy: SourcePolicy, locator: string, question?: string): "admit" | "prefer" | "exclude" {
  const host = hostOf(locator);
  if (!host) return "exclude";
  if (policy.excludedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return "exclude";
  if (policy.mode === "allowed_domains") {
    return policy.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`)) ? "admit" : "exclude";
  }
  if (policy.trustedDomains.some((d) => host === d || host.endsWith(`.${d}`))) return "prefer";
  const primary = isOfficialPrimaryHost(host) && (!primarySourceEntity(locator) || !!primarySourceEntity(locator,question));
  if (policy.mode === "primary_only") return primary ? "prefer" : "exclude";
  if (policy.mode === "prefer_primary") return primary ? "prefer" : "admit";
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
    if (kind === "mode" && ["open_web", "primary_only", "prefer_primary", "trusted_domains", "allowed_domains", "excluded_domains"].includes(value)) {
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
    next.mode = /only/i.test(message) ? "primary_only" : "prefer_primary";
  }
  const exclude = message.match(/\bexclude\s+([a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (exclude?.[1]) next.excludedDomains = [...new Set([...next.excludedDomains, exclude[1].toLowerCase()])];
  return next;
}

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|msclkid$|mc_eid$|mc_cid$|igshid$|yclid$|_hsenc$|_hsmi$|twclid$)/i;

/** Strip only known tracking fields; query order and semantic parameters remain intact. */
export function canonicalSourceUrl(locator: string): string {
  let url: URL;
  try { url = new URL(locator); }
  catch { throw new Error("invalid_source_url"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_source_url");
  url.hash = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  if (![...url.searchParams.keys()].length) url.search = "";
  return url.href;
}

/** User-supplied URL exceptions remain exact; redirects never inherit that exception. */
export function sourcePolicyAllows(policy:SourcePolicy,locator:string,question?:string):boolean {
  try {
    const canonical=canonicalSourceUrl(locator);
    const direct=policy.userSuppliedUrls.some(url=>admitUserSuppliedUrl(policy,url)&&canonicalSourceUrl(url)===canonical);
    return direct||applySourcePolicy(policy,locator,question)!=="exclude";
  } catch { return false; }
}
