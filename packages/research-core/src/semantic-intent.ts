import type { TaskFamily } from "@deep/contracts";
import { extractNamedGeography } from "./geography.js";

const TASK_FAMILIES: readonly TaskFamily[] = [
  "underspecified_purchase",
  "legal_jurisdiction",
  "current_fact",
  "technical_comparison",
  "open_ended_research",
  "relocation_decision",
  "other",
];

const ALLOWED_FIELDS = new Set([
  "geography",
  "budget",
  "use_case",
  "population",
  "timeframe",
  "platform",
  "private_search",
  "product",
  "destination",
  "subject",
  "date",
  "dose",
  "preference",
  "exclusion",
]);

const FORBIDDEN_FIELD = /^(public_query|permission|consent|tool|processor|instructions|budget_increase|grant)/i;

export type SemanticGoalAct =
  | "decide"
  | "relocate"
  | "compare"
  | "lookup"
  | "explain"
  | "comply"
  | "purchase";

export type SemanticConstraintDraft = {
  field: string;
  value: string;
  quote: string;
  importance: "hard" | "preference";
};

export type SemanticIntentOverlay = {
  compiler: "structured_semantic.v1";
  goalAct: SemanticGoalAct | null;
  taskFamily: TaskFamily | null;
  familyQuote: string | null;
  constraints: SemanticConstraintDraft[];
  rejected: string[];
};

function quoteInQuestion(question: string, quote: string): boolean {
  const q = quote.trim();
  if (q.length < 2) return false;
  return question.toLowerCase().includes(q.toLowerCase());
}

function firstMatch(question: string, re: RegExp): string | null {
  const m = question.match(re);
  return m?.[0] ?? null;
}

function detectGoalAct(question: string): { act: SemanticGoalAct; quote: string } | null {
  const relocate = firstMatch(question, /\b(move to|relocat(?:e|ing|ion)|immigrat(?:e|ing|ion)|live in)\b/i);
  if (relocate) return { act: "relocate", quote: relocate };
  const comply = firstMatch(
    question,
    /\b(filing deadline|employment tax|employment law|overtime rule|gdpr|statutes?|regulations?|which law applies|legal status|jurisdiction)\b/i,
  );
  if (comply) return { act: "comply", quote: comply };
  const purchase = firstMatch(question, /\b(buy|purchase|cheapest|best (?:laptop|phone|notebook|headphones))\b/i);
  if (purchase) return { act: "purchase", quote: purchase };
  const compare = firstMatch(
    question,
    /\b(compare|vs\.?|versus|switching from|work(?:s)? with|difference between|compatib(?:le|ility))\b/i,
  );
  if (compare) return { act: "compare", quote: compare };
  const lookup = firstMatch(question, /\b(current|latest|as of now|right now|today)\b/i);
  if (lookup && /\b(rate|price|score|population|number|who is|what is the)\b/i.test(question)) {
    return { act: "lookup", quote: lookup };
  }
  const explain = firstMatch(question, /\b(why|how does|explain|what is known|causes? of)\b/i);
  if (explain) return { act: "explain", quote: explain };
  const decide = firstMatch(question, /\b(should i|should we|is it worth|take the .{0,24}offer)\b/i);
  if (decide) return { act: "decide", quote: decide };
  return null;
}

function familyFromAct(act: SemanticGoalAct, question: string, geography: string | null): TaskFamily | null {
  if (act === "relocate") return "relocation_decision";
  if (act === "comply") return "legal_jurisdiction";
  if (act === "purchase") return "underspecified_purchase";
  if (act === "compare") return "technical_comparison";
  if (act === "lookup") return "current_fact";
  if (act === "explain") return "open_ended_research";
  if (act === "decide") {
    if (geography && /\b(offer|job|salary|school|kids|cost of living|live|relocat|move)\b/i.test(question)) {
      return "relocation_decision";
    }
    if (/\b(laptop|phone|notebook|headphones|buy)\b/i.test(question)) return "underspecified_purchase";
    return "open_ended_research";
  }
  return null;
}

function constraintIfQuoted(
  question: string,
  field: string,
  value: string,
  quote: string,
  importance: "hard" | "preference",
): SemanticConstraintDraft | null {
  if (!quoteInQuestion(question, quote) || !quoteInQuestion(question, value)) return null;
  if (!ALLOWED_FIELDS.has(field) || FORBIDDEN_FIELD.test(field)) return null;
  return { field, value, quote, importance };
}

function extractSemanticConstraints(question: string): SemanticConstraintDraft[] {
  const found: SemanticConstraintDraft[] = [];
  const push = (row: SemanticConstraintDraft | null) => {
    if (!row) return;
    if (found.some((c) => c.field === row.field && c.value.toLowerCase() === row.value.toLowerCase())) return;
    found.push(row);
  };

  const geo = extractNamedGeography(question);
  if (geo) push(constraintIfQuoted(question, "geography", geo.value, geo.value, "hard"));

  const use = question.match(/\bfor\s+((?:a|an|the)\s+)?([a-z][a-z0-9\s-]{2,40}?)(?:\b(?:under|in|with|on)\b|[?.!]|$)/i);
  if (use?.[2] && !/^(running|local|my|this|that)\b/i.test(use[2])) {
    push(constraintIfQuoted(question, "use_case", use[2].trim(), use[0], "preference"));
  }

  const population = firstMatch(
    question,
    /\b(kids|children|family|small businesses?|seniors|students|employees)\b/i,
  );
  if (population) push(constraintIfQuoted(question, "population", population, population, "preference"));

  const timeframe = firstMatch(
    question,
    /\b(next year|this (?:year|quarter|month)|by 20\d{2}|over \d+ years?|as of [A-Za-z0-9- ]{2,20})\b/i,
  );
  if (timeframe) push(constraintIfQuoted(question, "timeframe", timeframe, timeframe, "preference"));

  const platform = firstMatch(question, /\b(ios|android|windows|macos|linux|usb4)\b/i);
  if (platform) push(constraintIfQuoted(question, "platform", platform, platform, "preference"));

  const priv = firstMatch(question, /\b(my notes|my documents|attached files|uploaded documents?)\b/i);
  if (priv) push(constraintIfQuoted(question, "private_search", priv, priv, "hard"));

  return found;
}

/** Local structured semantic overlay. Every kept field is a substring of the question. */
export function compileSemanticOverlay(question: string): SemanticIntentOverlay {
  const goal = detectGoalAct(question);
  const geo = extractNamedGeography(question);
  const mapped = goal ? familyFromAct(goal.act, question, geo?.value ?? null) : null;
  const familyQuote = goal?.quote && quoteInQuestion(question, goal.quote) ? goal.quote : null;
  return {
    compiler: "structured_semantic.v1",
    goalAct: goal?.act ?? null,
    taskFamily: mapped && familyQuote ? mapped : null,
    familyQuote,
    constraints: extractSemanticConstraints(question),
    rejected: [],
  };
}

export function needsSemanticCompilation(taskFamily: TaskFamily, question: string): boolean {
  if (taskFamily === "other") return true;
  if (taskFamily === "open_ended_research" && /\b(should i|offer|job|company)\b/i.test(question)) return true;
  return false;
}

function asFamily(value: unknown): TaskFamily | null {
  return typeof value === "string" && (TASK_FAMILIES as readonly string[]).includes(value)
    ? (value as TaskFamily)
    : null;
}

/**
 * Accept a model- or rules-produced overlay only when every quote is in the
 * original question and no privilege field is present. Fail closed.
 */
export function applyExternalSemanticOverlay(question: string, draft: unknown): SemanticIntentOverlay {
  const rejected: string[] = [];
  if (draft == null || typeof draft !== "object") {
    return { compiler: "structured_semantic.v1", goalAct: null, taskFamily: null, familyQuote: null, constraints: [], rejected: ["overlay_not_object"] };
  }
  const raw = draft as Record<string, unknown>;
  const blob = JSON.stringify(raw).toLowerCase();
  if (/\b(grant (a )?tool|increase budget|change consent|public.query permission|ignore previous instructions)\b/.test(blob)) {
    return {
      compiler: "structured_semantic.v1",
      goalAct: null,
      taskFamily: null,
      familyQuote: null,
      constraints: [],
      rejected: ["privilege_escalation"],
    };
  }
  const family = asFamily(raw.taskFamily);
  if (raw.taskFamily != null && !family) rejected.push("unknown_task_family");
  const familyQuote = typeof raw.familyQuote === "string" ? raw.familyQuote : null;
  if (family && familyQuote && !quoteInQuestion(question, familyQuote)) {
    rejected.push("family_quote_not_in_question");
  }
  const constraints: SemanticConstraintDraft[] = [];
  const rows = Array.isArray(raw.constraints) ? raw.constraints : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      rejected.push("constraint_not_object");
      continue;
    }
    const item = row as Record<string, unknown>;
    const field = typeof item.field === "string" ? item.field : "";
    const value = typeof item.value === "string" ? item.value : "";
    const quote = typeof item.quote === "string" ? item.quote : "";
    const importance = item.importance === "preference" ? "preference" : "hard";
    if (FORBIDDEN_FIELD.test(field) || !ALLOWED_FIELDS.has(field)) {
      rejected.push(`forbidden_field:${field || "empty"}`);
      continue;
    }
    if (!quoteInQuestion(question, quote) || !quoteInQuestion(question, value)) {
      rejected.push(`ungrounded:${field}`);
      continue;
    }
    constraints.push({ field, value, quote, importance });
  }
  const goalAct = typeof raw.goalAct === "string" && ["decide", "relocate", "compare", "lookup", "explain", "comply", "purchase"].includes(raw.goalAct)
    ? (raw.goalAct as SemanticGoalAct)
    : null;
  return {
    compiler: "structured_semantic.v1",
    goalAct,
    taskFamily: family && (familyQuote == null || quoteInQuestion(question, familyQuote)) ? family : null,
    familyQuote: familyQuote && quoteInQuestion(question, familyQuote) ? familyQuote : null,
    constraints,
    rejected,
  };
}

export function validateSemanticOverlay(question: string, overlay: SemanticIntentOverlay): SemanticIntentOverlay {
  return applyExternalSemanticOverlay(question, overlay);
}

export function pickTaskFamily(deterministic: TaskFamily, overlay: SemanticIntentOverlay): TaskFamily {
  if (deterministic !== "other") return deterministic;
  if (overlay.taskFamily && overlay.taskFamily !== "other") return overlay.taskFamily;
  return deterministic;
}
