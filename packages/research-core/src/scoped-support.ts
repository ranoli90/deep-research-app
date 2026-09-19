import type { ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings } from "./model-bindings.js";
import { passageSupportsClaim } from "./support.js";

export const SCOPED_SUPPORT_VERSION = "scoped-support.v4";
/** Category labels copied from the question (e.g. "laptop") are not a quoted product identity. */
const GENERIC_ENTITY = new Set([
  "laptop", "notebook", "computer", "pc", "phone", "smartphone", "tablet", "device", "product",
  "software", "service", "vehicle", "car", "tool", "app", "application", "machine", "camera",
]);
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
/** Grouped prices such as $2,699.99 are one number; comma-split fragments are not the quantity. */
const numbers = (s:string):string[] => {
  const found = new Set<string>();
  const grouped = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?/gu;
  for (const g of s.match(grouped) ?? []) found.add(g.replace(/,/gu, ""));
  for (const n of s.replace(grouped, " ").match(/-?\d+(?:\.\d+)?/gu) ?? []) found.add(n);
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
  return (CURRENCY_SIGNS[token] ?? []).some((sign) => quote.includes(sign) || words.includes(sign));
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
      {rule:"scope_grounded_in_quotes",passed:Object.values(claim.scope).filter((s):s is string => s !== null).every((s) => containsPhrase(citedText,s) || GENERIC_ENTITY.has(normalize(s)))},
      {rule:"numbers_grounded",passed:numbers(claim.text).every((n) => numbers(citedText).includes(n))},
      {rule:"quantities_grounded",passed:claim.quantities.every((q) => quotes.some((quote) =>
        numbers(quote).includes(q.value.replace(/,/gu, "")) && quantityAttrs(q, claim.text).every((attr) => attrInQuote(attr, quote))))}];
    // A numeric unit cannot disappear merely because the extraction omitted quantities.
    const pairs = [...claim.text.matchAll(/(-?\d+(?:\.\d+)?)\s*(%|[\p{L}]+)(?=\s|[.,;:!?)]|$)/gu)];
    checks.push({rule:"numeric_context_preserved",passed:pairs.every((m) => quotes.some((q) => normalize(q).includes(normalize(m[0]))))});
    // Inspect cited passages plus others that share a specific (non-category) scope value.
    const citedIds = new Set(assessment.evidence.map((e) => e.passageId));
    const specificScope = Object.values(claim.scope).filter((s): s is string => s !== null && !GENERIC_ENTITY.has(normalize(s)));
    const scopedPassages = args.passages.filter((p) => {
      if (citedIds.has(p.id)) return true;
      return specificScope.length > 0 && specificScope.every((s) => containsPhrase(p.text, s));
    });
    const currencyTokens=claim.text.match(/[$€£¥]|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF)\b/gu)??[];
    checks.push({rule:"currency_preserved",passed:currencyTokens.every((token)=>citedText.includes(token))});
    const literal = scopedPassages.map((p) => passageSupportsClaim(p.text,claim.text));
    const literalContradiction = literal.includes("contradicts");
    const literalSupport = literal.includes("supports");
    const qualified = literal.includes("qualifies") || (quotes.some((q) => qualifiers.test(q)) && !qualifiers.test(claim.text));
    checks.push({rule:"no_detected_contradiction",passed:!literalContradiction}, {rule:"qualification_preserved",passed:!qualified});
    let decision:ScopedSupportResult["decision"] = assessment.status;
    if (!checks.find((c) => c.rule === "scope_matches_claim")!.passed) decision="out_of_scope";
    else if (!checks.find((c) => c.rule === "readable_evidence")!.passed) decision="insufficient";
    else if (!checks.find((c) => c.rule === "scope_grounded_in_quotes")!.passed) decision="out_of_scope";
    else if (literalContradiction) decision=literalSupport ? "disputed" : "contradicted";
    else if (assessment.status === "contradicted" && literalSupport) decision="disputed";
    else if (qualified && assessment.status === "supported") decision="partially_supported";
    else if (assessment.status === "supported" && checks.some((c) => !c.passed)) decision="insufficient";
    // A checker reporting missing decisive evidence cannot simultaneously grant full support.
    if (decision === "supported" && assessment.missingEvidence.length) decision="partially_supported";
    return { claimKey:claim.key,decision,modelStatus:assessment.status,evidence:assessment.evidence,scope:claim.scope,
      rationale:assessment.rationale,missingEvidence:assessment.missingEvidence,checks,
      counterEvidence:scopedPassages.flatMap((p,i)=>literal[i]==="contradicts"||literal[i]==="qualifies"?[{passageId:p.id,decision:literal[i] as "contradicts"|"qualifies"}]:[]) };
  });
}
