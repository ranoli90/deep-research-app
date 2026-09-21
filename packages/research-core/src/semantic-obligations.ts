import type { ResearchModelOutput } from "@deep/contracts";

type Assertion = ResearchModelOutput<"extract_assertions">["assertions"][number];

export type CriterionObligationInput = {
  key: string;
  description?: string | null;
  field?: string | null;
  scope?: { entity?: string | null } | null;
  provenance?: { quote: string } | null;
  operator?: string | null;
  groupOperator?: string | null;
  unresolvedAlternatives?: ReadonlyArray<string> | null;
};
export type QuestionObligationInput = { key: string; text: string; criterionKeys: ReadonlyArray<string> };

export const SEMANTIC_OBLIGATION_VERSION = "requested-obligations.v2";

export type RequestedFactKind =
  | "availability"
  | "birth"
  | "compatibility"
  | "expansion"
  | "founding"
  | "outbreak"
  | "price"
  | "treaty_signature"
  | "war"
  | "workforce";

export type RequestedCriterionObligations = {
  version: typeof SEMANTIC_OBLIGATION_VERSION;
  criterionKey: string;
  questionKeys: string[];
  entities: string[];
  facts: RequestedFactKind[];
  bindings: RequestedObligationBinding[];
};

export type RequestedObligationBinding = {
  questionKey: string | null;
  entity: string;
  fact: RequestedFactKind;
};

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const NON_ENTITY_LEAD = new Set([
  "compare", "date", "dates", "explain", "find", "founding", "give", "how", "in", "list", "provide",
  "report", "state", "tell", "the", "what", "when", "where", "which", "who", "why",
]);
const NON_ENTITY_VALUE = new Set([
  "answer", "availability", "birth", "company", "current", "date", "dates", "employee", "employees",
  "expansion", "firmware", "founding", "headcount", "history", "latest", "now", "price", "staff",
  "today", "version", "war", "workforce", "year", "years",
]);
const NAMED_PHRASE = /\p{Lu}[\p{L}\p{N}'’.-]*(?:\s+(?:(?:of|the|de|la|van|von)\s+)?\p{Lu}[\p{L}\p{N}'’.-]*)*/gu;

/** Conservative named-subject extraction. Unknown/lowercase subjects do not prove atomicity. */
export function requestedNamedEntities(text: string): string[] {
  const found = new Map<string, string>();
  for (const match of text.matchAll(NAMED_PHRASE)) {
    const words = match[0].trim().split(/\s+/u);
    while (words.length && NON_ENTITY_LEAD.has(normalize(words[0]!))) words.shift();
    const value = words.join(" ").replace(/[.,:;!?]+$/u, "").trim();
    const key = normalize(value);
    if (!key || NON_ENTITY_VALUE.has(key) || /^(?:q[1-4]|fy)(?:\s*(?:19|20)\d{2})?$/iu.test(value)) continue;
    if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december)$/iu.test(value)) continue;
    found.set(key, value);
  }
  return [...found.values()];
}

const FACT_PATTERNS: ReadonlyArray<readonly [RequestedFactKind, RegExp]> = [
  ["founding", /\b(?:found(?:ed|ing)|establish(?:ed|ment)|incorporat(?:ed|ion)|charter(?:ed|ing)|commenc(?:e|ed|ement) operations|began operations|started operations)\b/iu],
  ["birth", /\b(?:born|birth)\b/iu],
  ["treaty_signature", /\b(?:treaty|signed|signature)\b/iu],
  ["outbreak", /\boutbreak\b/iu],
  ["war", /\bwar\b/iu],
  ["expansion", /\b(?:expand(?:ed|s|ing)?|expansion|growth strateg(?:y|ies))\b/iu],
  ["workforce", /\b(?:employees?|staff|headcount|workforce|workers?|team size|number of people)\b/iu],
  ["price", /\b(?:price|pricing|cost)\b/iu],
  ["availability", /\b(?:availability|available|in stock)\b/iu],
  ["compatibility", /\b(?:compatib(?:le|ility)|firmware|supported versions?|works? with)\b/iu],
];

export function requestedFactKinds(text: string): RequestedFactKind[] {
  return FACT_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

const unique = (values: readonly string[]) => {
  const out = new Map<string, string>();
  for (const value of values) {
    const key = normalize(value);
    if (key) out.set(key, value.trim());
  }
  return [...out.values()];
};

/** Derive obligations from the persisted criterion and its persisted linked research questions. */
export function requestedCriterionObligations(args: {
  originalQuestion: string;
  criterion: CriterionObligationInput;
  questions?: ReadonlyArray<QuestionObligationInput>;
}): RequestedCriterionObligations {
  const linked = (args.questions ?? []).filter((question) => question.criterionKeys.includes(args.criterion.key));
  const linkedText = linked.map((question) => question.text);
  const scopedEntity = args.criterion.scope?.entity?.trim();
  let entities = unique([
    ...(scopedEntity ? [scopedEntity] : []),
    ...linkedText.flatMap(requestedNamedEntities),
  ]);
  if (!entities.length) entities = unique(requestedNamedEntities(args.criterion.provenance?.quote ?? ""));
  if (!entities.length) entities = unique(requestedNamedEntities(args.originalQuestion));

  let facts = [...new Set(linkedText.flatMap(requestedFactKinds))];
  if (!facts.length) {
    facts = [...new Set(requestedFactKinds([
      args.criterion.field ?? "",
      args.criterion.description ?? "",
      args.criterion.provenance?.quote ?? "",
    ].join(" ")))];
  }
  if (!facts.length) facts = requestedFactKinds(args.originalQuestion);
  const bindings: RequestedObligationBinding[] = [];
  const bind = (questionKey: string | null, boundEntities: readonly string[], boundFacts: readonly RequestedFactKind[]) => {
    for (const entity of boundEntities) {
      for (const fact of boundFacts) bindings.push({ questionKey, entity, fact });
    }
  };
  if (linked.length) {
    for (const question of linked) {
      let questionEntities = unique([
        ...(scopedEntity ? [scopedEntity] : []),
        ...requestedNamedEntities(question.text),
      ]);
      if (!questionEntities.length && entities.length === 1) questionEntities = entities;
      const questionFacts = requestedFactKinds(question.text);
      bind(question.key, questionEntities, questionFacts.length ? questionFacts : facts);
    }
  } else {
    bind(null, entities, facts);
  }
  const uniqueBindings = new Map<string, RequestedObligationBinding>();
  for (const binding of bindings) {
    uniqueBindings.set(`${binding.questionKey ?? ""}\0${normalize(binding.entity)}\0${binding.fact}`, binding);
  }
  return {
    version: SEMANTIC_OBLIGATION_VERSION,
    criterionKey: args.criterion.key,
    questionKeys: linked.map((question) => question.key),
    entities,
    facts,
    bindings: [...uniqueBindings.values()],
  };
}

export function criterionObligationIsAtomic(args: {
  originalQuestion: string;
  criterion: CriterionObligationInput;
  questions?: ReadonlyArray<QuestionObligationInput>;
}): boolean {
  if (args.criterion.operator === "compare" || args.criterion.groupOperator === "any") return false;
  if ((args.criterion.unresolvedAlternatives?.length ?? 0) > 0) return false;
  const obligations = requestedCriterionObligations(args);
  return obligations.questionKeys.length <= 1
    && obligations.entities.length === 1
    && obligations.facts.length === 1
    && obligations.bindings.length === 1;
}

export function assertionCoversRequestedEntity(assertion: Pick<Assertion, "text" | "scope">, entity: string): boolean {
  const wanted = normalize(entity);
  return !!wanted && normalize(assertion.scope.entity ?? "") === wanted;
}

export function assertionCoversRequestedFact(assertion: Pick<Assertion, "text">, fact: RequestedFactKind): boolean {
  return requestedFactKinds(assertion.text).includes(fact);
}

export function assertionCoversRequestedBinding(
  assertion: Pick<Assertion, "text" | "scope">,
  binding: Pick<RequestedObligationBinding, "entity" | "fact">,
): boolean {
  return assertionCoversRequestedEntity(assertion, binding.entity)
    && assertionCoversRequestedFact(assertion, binding.fact);
}
