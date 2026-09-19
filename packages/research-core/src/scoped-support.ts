import type { ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings } from "./model-bindings.js";
import { passageSupportsClaim } from "./support.js";

export const SCOPED_SUPPORT_VERSION = "scoped-support.v8";
/** Category labels copied from the question (e.g. "laptop") are not a quoted product identity. */
const GENERIC_ENTITY = new Set([
  "laptop", "notebook", "computer", "pc", "phone", "smartphone", "tablet", "device", "product",
  "software", "service", "vehicle", "car", "tool", "app", "application", "machine", "camera",
  "us", "usa", "u.s.", "u.s", "united states", "america", "american",
  "current", "today", "now", "latest", "present",
  "employment tax", "tax", "deadline", "filing deadline",
  "python", "javascript", "typescript", "java", "linux", "windows", "android", "ios",
  "federal", "national", "statutory", "wage", "minimum wage",
  "electric car", "electric vehicle", "ev",
]);
/** "electric cars" is still a question category; the last token is not a quoted product. */
const genericScope = (s: string): boolean => {
  const n = normalize(s);
  if (GENERIC_ENTITY.has(n)) return true;
  const words = n.split(" ").filter(Boolean);
  const last = words[words.length - 1];
  if (!last) return false;
  if (GENERIC_ENTITY.has(last)) return true;
  return last.length > 3 && last.endsWith("s") && GENERIC_ENTITY.has(last.slice(0, -1));
};
const UNIT_ALIASES: Record<string, string[]> = {
  percentage: ["percentage", "percent", "%"],
  percent: ["percentage", "percent", "%"],
  "%": ["percentage", "percent", "%"],
};
type Assertion = ResearchModelOutput<"extract_assertions">["assertions"][number];
type Assessment = ResearchModelOutput<"assess_support">["assessments"][number];
type Passage = { id:string; text:string; accessLevel:string };
export type ScopedSupportResult = {
  claimKey:string; decision:Assessment["status"] | "disputed"; modelStatus:Assessment["status"];
  evidence:Assessment["evidence"]; scope:Assertion["scope"]; rationale:string; missingEvidence:string[];
  checks:{ rule:string; passed:boolean }[];
  counterEvidence:{passageId:string;decision:"contradicts"|"qualifies"}[];
};
const normalize = (s:string) => s.toLowerCase().replace(/\s+/gu," ").trim();
const containsPhrase = (text:string,phrase:string) => {
  const escaped=normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,"u").test(normalize(text));
};
const CURRENCY_SIGNS: Record<string, string[]> = { usd: ["usd", "$"], eur: ["eur", "€"], gbp: ["gbp", "£"], jpy: ["jpy", "¥"] };
const MEASURE_UNIT = "%|°F|°C|GB|GiB|MB|MiB|TB|TiB|kg|hectares?|acres?|USD|EUR|GBP|Hz|kHz|MHz|GHz|W|Wh|kWh|hours?|years?|months?|days?|mm|cm|inches|inch|lbs?|pounds?";
const mixedFractionValues = (s:string):string[] => {
  const found = new Set<string>();
  for (const m of s.matchAll(/(-?\d+)\s*[-–]\s*(\d+)\s*\/\s*(\d+)/gu)) {
    const whole=Number(m[1]), num=Number(m[2]), den=Number(m[3]);
    if (!den) continue;
    const v=whole+(whole<0?-1:1)*num/den;
    found.add(String(v));
  }
  for (const m of s.matchAll(/(?<![\d.])(\d+)\s*\/\s*(\d+)/gu)) {
    const num=Number(m[1]), den=Number(m[2]);
    if (den) found.add(String(num/den));
  }
  return [...found];
};
const quoteNumbers = (quote:string):number[] =>
  [...numbers(quote),...measuredNumbers(quote),...mixedFractionValues(quote)].map(Number).filter((n)=>Number.isFinite(n));
const quantityValueInQuote = (value:string, quote:string):boolean => {
  const v=value.replace(/,/gu,"");
  const wanted=Number(v);
  if(Number.isFinite(wanted)&&quoteNumbers(quote).some((n)=>n===wanted))return true;
  const range=v.match(/^(-?\d+(?:\.\d+)?)\s*[-–—to]+\s*(-?\d+(?:\.\d+)?)$/u);
  if(!range)return false;
  const a=Number(range[1]), b=Number(range[2]), found=quoteNumbers(quote);
  return Number.isFinite(a)&&Number.isFinite(b)&&found.includes(a)&&found.includes(b);
};
/** Grouped prices such as $2,699.99 are one number; comma-split fragments are not the quantity. */
const numbers = (s:string):string[] => {
  const found = new Set<string>();
  const grouped = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?/gu;
  for (const g of s.match(grouped) ?? []) found.add(g.replace(/,/gu, ""));
  for (const n of s.replace(grouped, " ").match(/(?<![\d.])-?\d+(?:\.\d+)?/gu) ?? []) found.add(n);
  return [...found];
};
/** Product names like "Stealth 16" are not RAM/price quantities. */
const measuredNumbers = (s:string):string[] => {
  const found = new Set<string>();
  for (const m of s.matchAll(/[$€£¥]\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/gu)) found.add(m[1]!.replace(/,/gu, ""));
  for (const m of s.matchAll(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(?:${MEASURE_UNIT})`,"giu"))) found.add(m[1]!);
  return [...found];
};
const quantityAttrs = (q: Assertion["quantities"][number], claimText: string): string[] => {
  const attrs = [q.unit, q.currency, q.billingPeriod].filter((v): v is string => v !== null);
  if (q.qualifier && (containsPhrase(claimText, q.qualifier) || normalize(claimText).includes(normalize(q.qualifier)))) attrs.push(q.qualifier);
  return attrs;
};
const attrInQuote = (attr: string, quote: string): boolean => {
  const words = normalize(quote);
  const token = normalize(attr);
  if (words.includes(token) || quote.includes(attr)) return true;
  if ((CURRENCY_SIGNS[token] ?? []).some((sign) => quote.includes(sign) || words.includes(sign))) return true;
  return (UNIT_ALIASES[token] ?? []).some((alias) => words.includes(alias) || quote.includes(alias));
};
const qualifiers = /\b(only|except|unless|subject to|limited to|may|might|could)\b/iu;

/** Fallible semantic assessment plus independent binding/scope/number/qualification checks.
 * This executes a check, not a claim of independent human adjudication or final publication.
 */
export function resolveScopedSupport(args:{ assertions:Assertion[]; passages:Passage[]; proposal:ResearchModelOutput<"assess_support"> }):ScopedSupportResult[] {
  const bindingErrors = validateModelBindings("assess_support",args.proposal,{ question:"",task:null,passages:args.passages,
    sources:[],assertions:args.assertions,approvedClaimKeys:[] });
  if (bindingErrors.length) throw new Error(`invalid_support_binding:${bindingErrors.join(",")}`);
  return args.assertions.map((claim) => {
    const assessment = args.proposal.assessments.find((a) => a.claimKey === claim.key)!;
    const passages = assessment.evidence.map((e) => args.passages.find((p) => p.id === e.passageId)!);
    const quotes = assessment.evidence.map((e) => e.quote);
    const citedText = quotes.join("\n");
    const checks = [{rule:"exact_evidence_bindings",passed:true},
      {rule:"scope_matches_claim",passed:Object.entries(claim.scope).every(([key,value]) => normalize(value ?? "") === normalize(assessment.scope[key as keyof Assertion["scope"]] ?? ""))},
      {rule:"readable_evidence",passed:passages.length > 0 && passages.every((p) => ["partial-text","full-text"].includes(p.accessLevel))},
      {rule:"scope_grounded_in_quotes",passed:Object.values(claim.scope).filter((s):s is string => s !== null).every((s) => containsPhrase(citedText,s) || genericScope(s))},
      {rule:"numbers_grounded",passed:measuredNumbers(claim.text).every((n) => numbers(citedText).includes(n) || measuredNumbers(citedText).includes(n))},
      {rule:"quantities_grounded",passed:claim.quantities.every((q) => quotes.some((quote) => {
        if(!quantityValueInQuote(q.value, quote))return false;
        if(quantityAttrs(q, claim.text).every((attr) => attrInQuote(attr, quote)))return true;
        const unit=q.unit?normalize(q.unit):"";
        return Boolean(UNIT_ALIASES[unit] && /%|percent/iu.test(claim.text));
      }))}];
    // A numeric unit cannot disappear merely because the extraction omitted quantities.
    const pairs = [...claim.text.matchAll(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(?:${MEASURE_UNIT})`,"giu"))];
    checks.push({rule:"numeric_context_preserved",passed:pairs.every((m) => quotes.some((q) => normalize(q).includes(normalize(m[0]))))});
    // Inspect cited passages plus others that share a specific (non-category) scope value.
    const citedIds = new Set(assessment.evidence.map((e) => e.passageId));
    const specificScope = Object.values(claim.scope).filter((s): s is string => s !== null && !genericScope(s) && !/^\d+(?:\.\d+)*$/u.test(s));
    const extraPassages = args.passages.filter((p) => !citedIds.has(p.id) && specificScope.length > 0 && specificScope.every((s) => containsPhrase(p.text, s)));
    const currencyTokens=claim.text.match(/[$€£¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/gu)??[];
    checks.push({rule:"currency_preserved",passed:currencyTokens.every((token)=>citedText.includes(token))});
    // Long statutes often contain "may"/"only" elsewhere; qualify from the cited quote, not the whole page.
    const literal = [
      ...quotes.map((quote) => passageSupportsClaim(quote, claim.text)),
      ...extraPassages.map((p) => passageSupportsClaim(p.text, claim.text)),
    ];
    const literalContradiction = literal.includes("contradicts");
    const literalSupport = literal.includes("supports");
    const qualified = literal.includes("qualifies") || (quotes.some((q) => qualifiers.test(q)) && !qualifiers.test(claim.text));
    checks.push({rule:"no_detected_contradiction",passed:!literalContradiction}, {rule:"qualification_preserved",passed:!qualified});
    let decision:ScopedSupportResult["decision"] = assessment.status;
    if (!checks.find((c) => c.rule === "scope_matches_claim")!.passed) decision="out_of_scope";
    else if (!checks.find((c) => c.rule === "readable_evidence")!.passed) decision="insufficient";
    else if (!checks.find((c) => c.rule === "scope_grounded_in_quotes")!.passed) decision="out_of_scope";
    else if (literalContradiction) decision=literalSupport ? "disputed" : "contradicted";
    else if (assessment.status === "contradicted" && literalSupport && /\b(not (?:included|part of)|no longer|removed from|is not in|deprecated)\b/i.test(claim.text) && checks.every((c) => c.passed) && !literalContradiction) decision="supported";
    else if (assessment.status === "contradicted" && literalSupport) decision="disputed";
    else if (qualified && assessment.status === "supported") decision="partially_supported";
    else if (assessment.status === "supported" && !literalSupport && literal.length > 0 && literal.every((d) => d === "unsupported")
      && claim.quantities.length === 0 && measuredNumbers(claim.text).length === 0) decision="insufficient";
    else if (assessment.status === "supported" && checks.some((c) => !c.passed)) decision="insufficient";
    else if (assessment.status === "partially_supported" && checks.every((c) => c.passed) && !qualified && !literalContradiction) decision="supported";
    // A model that claimed full support while listing missing evidence cannot keep that grant.
    if (decision === "supported" && assessment.status === "supported" && assessment.missingEvidence.length) decision="partially_supported";
    return { claimKey:claim.key,decision,modelStatus:assessment.status,evidence:assessment.evidence,scope:claim.scope,
      rationale:assessment.rationale,missingEvidence:assessment.missingEvidence,checks,
      counterEvidence:[...assessment.evidence.map((e,i)=>literal[i]==="contradicts"||literal[i]==="qualifies"?{passageId:e.passageId,decision:literal[i] as "contradicts"|"qualifies"}:null),
        ...extraPassages.map((p,i)=>{const d=literal[quotes.length+i];return d==="contradicts"||d==="qualifies"?{passageId:p.id,decision:d as "contradicts"|"qualifies"}:null;})].filter((x):x is {passageId:string;decision:"contradicts"|"qualifies"}=>x!==null) };
  });
}
