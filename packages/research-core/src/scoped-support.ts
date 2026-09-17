import type { ResearchModelOutput } from "@deep/contracts";
import { validateModelBindings } from "./model-bindings.js";
import { passageSupportsClaim } from "./support.js";

export const SCOPED_SUPPORT_VERSION = "scoped-support.v2";
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
const numbers = (s:string):string[] => s.match(/-?\d+(?:\.\d+)?/gu) ?? [];
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
      {rule:"scope_grounded_in_quotes",passed:Object.values(claim.scope).filter((s):s is string => s !== null).every((s) => containsPhrase(citedText,s))},
      {rule:"numbers_grounded",passed:numbers(claim.text).every((n) => numbers(citedText).includes(n))},
      {rule:"quantities_grounded",passed:claim.quantities.every((q) => quotes.some((quote) => {
        const words = normalize(quote);
        return numbers(quote).includes(q.value) && [q.unit,q.currency,q.billingPeriod,q.qualifier].filter((v):v is string => v !== null)
          .every((v) => words.includes(normalize(v)));
      }))}];
    // A numeric unit cannot disappear merely because the extraction omitted quantities.
    const pairs = [...claim.text.matchAll(/(-?\d+(?:\.\d+)?)\s*(%|[\p{L}]+)(?=\s|[.,;:!?)]|$)/gu)];
    checks.push({rule:"numeric_context_preserved",passed:pairs.every((m) => quotes.some((q) => normalize(q).includes(normalize(m[0]))))});
    // Inspect all selected in-scope passages, including counterevidence omitted by the model.
    const scopedPassages=args.passages.filter((p)=>Object.values(claim.scope).filter((s):s is string=>s!==null).every((s)=>containsPhrase(p.text,s)));
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
