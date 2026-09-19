import type {
  Assumption,
  ConsequentialUnknown,
  DerivedRequirement,
  ExpectedOutput,
  FreshnessRequirement,
  IntentConstraint,
  IntentExclusion,
  MaterialAmbiguity,
  ResearchIntent,
} from "@deep/contracts";
import { RESEARCH_INTENT_COMPILER_VERSION } from "@deep/contracts";
import { extractConstraints, parseBudgetCeiling } from "./brief.js";
import { evaluateClarificationValue } from "./clarification-value.js";
import { inferTaskFamily } from "./intent-taxonomy.js";
import { provenanceFromOrigin } from "./provenance.js";
import {
  compileSemanticOverlay,
  pickTaskFamily,
  validateSemanticOverlay,
} from "./semantic-intent.js";

function freezeQuestion(question: string): string {
  return String(question);
}

function spanFor(question: string, quote: string): { start: number; end: number; quote: string } | null {
  const start = question.toLowerCase().indexOf(quote.toLowerCase());
  if (start < 0) return null;
  return { start, end: start + quote.length, quote: question.slice(start, start + quote.length) };
}

function asIntentConstraint(c: import("@deep/contracts").Constraint, stated: boolean): IntentConstraint {
  return {
    ...c,
    provenance: c.provenance ?? provenanceFromOrigin(c.origin),
    statedInQuestion: stated,
  };
}

function namedProducts(question: string): string[] {
  const found: string[] = [];
  const re = /\b(postgres(?:ql)?|mysql|sqlite|react native|flutter|python|node\.?js|iphone|android|linux|windows|macos)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(question))) {
    const v = m[1]!.toLowerCase();
    if (!found.includes(v)) found.push(v);
  }
  return found;
}

function namedVersions(question: string): string[] {
  const found: string[] = [];
  const withoutDates = question.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  const re =
    /\b(v\d+(?:\.\d+){0,2}|(?:postgres(?:ql)?|postgis|mysql|sqlite|python|node(?:\.?js)?|ios|android)\s+\d+(?:\.\d+){0,2}|\d+\.\d+(?:\.\d+)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutDates))) {
    const token = m[1]!.replace(/^(postgres(?:ql)?|postgis|mysql|sqlite|python|node(?:\.?js)?|ios|android)\s+/i, "");
    if (/^20\d{2}/.test(token)) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

function expectedOutputFor(family: ResearchIntent["taskFamily"], question: string): ExpectedOutput {
  const statedComparison = /\bcompare|vs\.?|versus|alternatives?\b/i.test(question);
  const statedRecommend = /\bbest|should i buy|recommend\b/i.test(question);
  if (family === "underspecified_purchase") {
    return {
      kind: statedComparison ? "comparison" : "recommendation",
      summary: statedRecommend
        ? "A decision-useful recommendation that respects stated hard constraints."
        : "A comparison of eligible options under the stated constraints.",
      statedInQuestion: statedRecommend || statedComparison,
    };
  }
  if (family === "legal_jurisdiction") {
    return { kind: "legal_rule", summary: "The applicable rule in the confirmed jurisdiction as of the relevant date.", statedInQuestion: true };
  }
  if (family === "current_fact") {
    return { kind: "current_fact", summary: "The current value with dated primary evidence.", statedInQuestion: true };
  }
  if (family === "technical_comparison") {
    return {
      kind: statedComparison ? "comparison" : "compatibility",
      summary: "Compatibility or difference under the named versions, with primary documentation.",
      statedInQuestion: statedComparison || /\bcompatib|works with\b/i.test(question),
    };
  }
  if (family === "open_ended_research") {
    return { kind: "explanation", summary: "An evidence-backed explanation of the asked phenomenon, with uncertainty preserved.", statedInQuestion: true };
  }
  if (family === "relocation_decision") {
    return { kind: "recommendation", summary: "A decision-useful assessment of relocating to the named place, with tradeoffs and uncertainty.", statedInQuestion: true };
  }
  return { kind: "unknown", summary: "Answer the stated question with inspectable evidence.", statedInQuestion: true };
}

function freshnessFor(family: ResearchIntent["taskFamily"], question: string): FreshnessRequirement {
  const datedAsOf = /\bas of\s+(?!now\b)/i.test(question);
  const stated = /\b(current|latest|as of now|today|right now|this week)\b/i.test(question);
  if (datedAsOf && !stated) {
    return { required: true, summary: "Honor the stated as-of date; do not substitute a different snapshot.", statedInQuestion: true };
  }
  if (family === "current_fact" || stated) {
    return { required: true, summary: "Requires dated, current primary evidence; stale snapshots are insufficient.", statedInQuestion: stated };
  }
  if (family === "underspecified_purchase") {
    return { required: true, summary: "Market prices and hardware availability change; prefer current vendor/list evidence.", statedInQuestion: false };
  }
  if (family === "legal_jurisdiction") {
    return { required: true, summary: "Legal rules are date-sensitive; record the as-of date of each source.", statedInQuestion: stated };
  }
  return { required: stated, summary: stated ? "Question asks for current/latest evidence." : "No explicit freshness window; prefer the most recent reliable source without rewriting the question.", statedInQuestion: stated };
}

/**
 * Compile one natural-language question into a structured research objective.
 * The original question string is copied and never rewritten.
 */
export function compileResearchIntent(
  question: string,
  options: { knownConstraints?: import("@deep/contracts").Constraint[] } = {},
): ResearchIntent {
  const originalQuestion = freezeQuestion(question);
  const deterministicFamily = inferTaskFamily(originalQuestion);
  const overlay = validateSemanticOverlay(originalQuestion, compileSemanticOverlay(originalQuestion));
  const family = pickTaskFamily(deterministicFamily, overlay);
  const extracted = extractConstraints(originalQuestion);
  const merged = [...extracted];
  for (const extra of options.knownConstraints ?? []) {
    const idx = merged.findIndex((row) => row.field === extra.field && row.operator === extra.operator);
    if (idx >= 0) merged[idx] = extra;
    else merged.push(extra);
  }
  const hard: IntentConstraint[] = [];
  const soft: IntentConstraint[] = [];
  const seen = new Set<string>();

  const consider = (c: IntentConstraint) => {
    const key = `${c.field}:${c.operator}:${c.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (c.importance === "preference") soft.push(c);
    else hard.push(c);
  };

  for (const c of merged) {
    consider(asIntentConstraint(c, extracted.some((e) => e.field === c.field && String(e.value) === String(c.value))));
  }
  const compact = parseBudgetCeiling(originalQuestion);
  if (compact && !hard.some((c) => c.field === "budget")) consider(asIntentConstraint(compact, true));

  for (const row of overlay.constraints) {
    consider(asIntentConstraint({
      id: `semantic-${row.field}-${row.value.replace(/\s+/g, "-").slice(0, 32)}`,
      field: row.field,
      operator: "eq",
      value: row.value,
      origin: "explicit",
      importance: row.importance === "preference" ? "preference" : "hard",
      explanation: `Stated in the question as “${row.quote}”.`,
      provenance: provenanceFromOrigin("explicit"),
    }, true));
  }

  if (/\bbest\b/i.test(originalQuestion) && !soft.some((c) => c.field === "preference")) {
    consider({
      id: "preference-best",
      field: "preference",
      operator: "eq",
      value: "best among eligible options",
      origin: "explicit",
      importance: "preference",
      explanation: "“Best” is a ranking preference, not a hard eligibility rule.",
      provenance: provenanceFromOrigin("explicit"),
      statedInQuestion: true,
    });
  }

  const derived: DerivedRequirement[] = [];
  const assumptions: Assumption[] = [];
  const ambiguities: MaterialAmbiguity[] = [];
  const unknowns: ConsequentialUnknown[] = [];
  const exclusions: IntentExclusion[] = [];

  for (const c of hard.filter((x) => x.field === "exclusion")) {
    exclusions.push({ id: c.id, text: String(c.value), statedInQuestion: true });
  }

  if (family === "underspecified_purchase") {
    if (/\b(laptop|notebook)\b/i.test(originalQuestion)) {
      derived.push({
        id: "form-factor-laptop",
        text: "Eligible products are portable computers, not desktops or cloud-only instances.",
        because: "The question names a laptop.",
        reversible: false,
      });
    }
    if (/\brun(?:ning)?\s+ai\b|\blocal ai\b|\bllm\b/i.test(originalQuestion)) {
      derived.push({
        id: "local-ai-capability",
        text: "Investigate machines that can run local AI/LLM workloads (memory, GPU/NPU, thermals), not only cloud-API laptops.",
        because: "“Running AI” on a purchased laptop usually means on-device capability.",
        reversible: true,
      });
      assumptions.push({
        id: "assume-local-ai",
        value: "“Running AI” means local inference is in scope; cloud-API-only laptops are a documented branch, not a silent replacement.",
        reversibility: "reversible",
        impact: "Changes the hardware search universe (GPU/NPU/RAM vs cheap cloud-client laptops).",
        userConfirmationState: "unconfirmed",
      });
      ambiguities.push({
        id: "local-vs-cloud-ai",
        unknown: "Whether “running AI” means local models or cloud APIs",
        whyItMightMatter: "Local inference changes eligible hardware; cloud-API use does not.",
        materialChangeKinds: ["search_universe", "eligibility", "ranking"],
        handling: "branch",
      });
      unknowns.push({
        id: "local-vs-cloud-ai",
        unknown: "Local vs cloud AI workload",
        materialChangeKinds: ["search_universe", "eligibility", "ranking"],
        defaultHandling: "branch",
      });
    }
    if (hard.some((c) => c.field === "budget" && !c.units)) {
      assumptions.push({
        id: "assume-budget-currency",
        value: "The compact budget (for example “2k”) is 2000 currency units; market currency was not named.",
        reversibility: "reversible",
        impact: "Currency and market change list prices and eligibility.",
        userConfirmationState: "unconfirmed",
      });
      ambiguities.push({
        id: "currency-market",
        unknown: "Currency and purchase market",
        whyItMightMatter: "List prices and tax/availability differ by market.",
        materialChangeKinds: ["eligibility", "ranking"],
        handling: "assume",
      });
      unknowns.push({
        id: "currency-market",
        unknown: "Currency and purchase market",
        materialChangeKinds: ["eligibility", "ranking"],
        defaultHandling: "assume",
      });
    }
  }

  if (family === "legal_jurisdiction" && !merged.some((c) => c.field === "geography")) {
    ambiguities.push({
      id: "jurisdiction",
      unknown: "Applicable jurisdiction",
      whyItMightMatter: "Filing deadlines and governing law are jurisdiction-specific.",
      materialChangeKinds: ["jurisdiction", "source_requirements", "final_conclusion"],
      handling: "ask",
    });
    unknowns.push({
      id: "jurisdiction",
      unknown: "Applicable jurisdiction",
      materialChangeKinds: ["jurisdiction", "source_requirements", "final_conclusion"],
      defaultHandling: "ask",
    });
  }

  if (family === "technical_comparison") {
    for (const product of namedProducts(originalQuestion)) {
      derived.push({
        id: `named-${product.replace(/\s+/g, "-")}`,
        text: `Compare or check the named product “${product}” rather than a substituted analogue.`,
        because: "The question names this product.",
        reversible: false,
      });
    }
    const versions = namedVersions(originalQuestion);
    if (versions.length === 0) {
      assumptions.push({
        id: "assume-documented-version",
        value: "When a version is unnamed, evaluate the current vendor-documented release and record that assumption.",
        reversibility: "reversible",
        impact: "Compatibility matrices differ by version.",
        userConfirmationState: "unconfirmed",
      });
      ambiguities.push({
        id: "unnamed-version",
        unknown: "Exact software versions",
        whyItMightMatter: "Support can differ across major versions.",
        materialChangeKinds: ["eligibility", "final_conclusion"],
        handling: "assume",
      });
    }
  }

  if (family === "open_ended_research") {
    assumptions.push({
      id: "assume-stated-scope",
      value: "Research the phenomenon as asked; do not narrow it into an unstated specialty without recording the narrowing.",
      reversibility: "reversible",
      impact: "Over-narrowing would silently change the user's question.",
      userConfirmationState: "unconfirmed",
    });
  }

  if (family === "relocation_decision") {
    derived.push({
      id: "relocation-objective",
      text: "Investigate whether relocating to the named place is a good fit given stated constraints, with costs, law, and quality-of-life evidence.",
      because: "The question asks whether to move.",
      reversible: false,
    });
    assumptions.push({
      id: "assume-named-destination",
      value: "The named place is the destination under consideration; do not substitute a different jurisdiction.",
      reversibility: "reversible",
      impact: "A different destination would change the research universe.",
      userConfirmationState: "unconfirmed",
    });
  }

  const spans = [
    spanFor(originalQuestion, originalQuestion.slice(0, Math.min(originalQuestion.length, 80))),
  ].filter((s): s is NonNullable<typeof s> => s !== null);

  const clarificationDecision = evaluateClarificationValue({
    originalQuestion,
    knownConstraints: [...hard, ...soft],
    taskFamily: family,
    materialAmbiguities: ambiguities,
    consequentialUnknowns: unknowns,
  });

  return {
    compilerVersion: RESEARCH_INTENT_COMPILER_VERSION,
    originalQuestion,
    taskFamily: family,
    explicitlyStated: { text: originalQuestion, spans },
    hardConstraints: hard,
    softPreferences: soft,
    derivedResearchRequirements: derived,
    assumptions,
    materialAmbiguities: ambiguities,
    exclusions,
    expectedOutput: expectedOutputFor(family, originalQuestion),
    freshnessRequirements: freshnessFor(family, originalQuestion),
    consequentialUnknowns: unknowns,
    clarificationDecision,
  };
}

export { evaluateClarificationValue, clarificationPrompts, isCosmeticClarification } from "./clarification-value.js";
export { inferTaskFamily } from "./intent-taxonomy.js";
export { RESEARCH_INTENT_COMPILER_VERSION };
