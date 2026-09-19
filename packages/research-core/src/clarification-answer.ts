import type { Constraint } from "@deep/contracts";
import { parseBudgetCeiling } from "./brief.js";
import { MATERIAL_CLARIFICATION_FIELDS, type MaterialClarificationField } from "./clarification-fields.js";
import { extractNamedGeography } from "./geography.js";
import { provenanceFromOrigin } from "./provenance.js";

const TYPED_CLARIFICATION_FIELDS = [...MATERIAL_CLARIFICATION_FIELDS, "currency"] as const;
export type TypedClarificationField = (typeof TYPED_CLARIFICATION_FIELDS)[number];

export type ClarificationAnswerResult =
  | { ok: true; constraint: Constraint }
  | { ok: false; reason: "unsupported_field" | "invalid_value" };

const PLATFORM_CANONICAL: { test: RegExp; value: string }[] = [
  { test: /\b(iphone|ios)\b/i, value: "iPhone" },
  { test: /\bandroid\b/i, value: "Android" },
  { test: /\blinux\b/i, value: "Linux" },
  { test: /\bwindows\b/i, value: "Windows" },
  { test: /\b(macos|mac os|os x)\b/i, value: "macOS" },
];

function confirmed(partial: Omit<Constraint, "origin" | "explanation" | "provenance"> & { explanation?: string }): Constraint {
  return {
    ...partial,
    origin: "confirmed",
    explanation: partial.explanation ?? "Supplied after clarification",
    provenance: provenanceFromOrigin("confirmed"),
  };
}

function parseBudgetAnswer(value: string): Constraint | null {
  const parsed = parseBudgetCeiling(value) ?? parseBudgetCeiling(`under ${value}`);
  if (parsed) {
    return confirmed({
      id: "confirmed-budget",
      field: "budget",
      operator: parsed.operator,
      value: parsed.value,
      ...(parsed.units ? { units: parsed.units } : {}),
      importance: "hard",
    });
  }
  const bare = value.match(/^(?:under|below|at most|less than|<=)?\s*(\$|€|£)?\s*(\d+(?:[.,]\d+)?)([kK])?\s*(USD|EUR|GBP)?$/i);
  if (!bare) return null;
  const n = Number(bare[2]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const amount = bare[3] ? String(Math.round(n * 1000)) : String(n);
  const symbol = bare[1] ?? bare[4];
  const units = symbol === "$" || /^usd$/i.test(symbol ?? "") ? "USD"
    : symbol === "€" || /^eur$/i.test(symbol ?? "") ? "EUR"
    : symbol === "£" || /^gbp$/i.test(symbol ?? "") ? "GBP"
    : undefined;
  return confirmed({
    id: "confirmed-budget",
    field: "budget",
    operator: "lte",
    value: amount,
    ...(units ? { units } : {}),
    importance: "hard",
  });
}

function parseCurrencyAnswer(value: string): Constraint | null {
  const trimmed = value.trim();
  if (/^(\$|USD)$/i.test(trimmed)) {
    return confirmed({ id: "confirmed-currency", field: "currency", operator: "eq", value: "USD", importance: "hard" });
  }
  if (/^(€|EUR)$/i.test(trimmed)) {
    return confirmed({ id: "confirmed-currency", field: "currency", operator: "eq", value: "EUR", importance: "hard" });
  }
  if (/^(£|GBP)$/i.test(trimmed)) {
    return confirmed({ id: "confirmed-currency", field: "currency", operator: "eq", value: "GBP", importance: "hard" });
  }
  return null;
}

function parseTimeframeAnswer(value: string): Constraint | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    return confirmed({ id: "confirmed-timeframe", field: "timeframe", operator: "eq", value: trimmed, importance: "hard" });
  }
  const range = trimmed.match(/^(\d{4})\s*(?:-|–|to)\s*(\d{4})$/iu);
  if (range) {
    return confirmed({
      id: "confirmed-timeframe",
      field: "timeframe",
      operator: "between",
      value: `${range[1]}-${range[2]}`,
      importance: "hard",
    });
  }
  if (/^\d{4}$/u.test(trimmed) || /^(?:as of\s+)?[A-Za-z]{3,9}\s+\d{4}$/u.test(trimmed) || /^Q[1-4]\s+\d{4}$/u.test(trimmed)) {
    return confirmed({ id: "confirmed-timeframe", field: "timeframe", operator: "eq", value: trimmed, importance: "hard" });
  }
  if (trimmed.length < 2 || trimmed.length > 80) return null;
  if (!/[A-Za-z0-9]/.test(trimmed)) return null;
  return confirmed({ id: "confirmed-timeframe", field: "timeframe", operator: "eq", value: trimmed, importance: "hard" });
}

function parsePlatformAnswer(value: string): Constraint | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  const known = PLATFORM_CANONICAL.find((row) => row.test.test(trimmed));
  if (known) {
    return confirmed({ id: "confirmed-platform", field: "platform", operator: "eq", value: known.value, importance: "hard" });
  }
  if (!/[A-Za-z]/.test(trimmed)) return null;
  return confirmed({ id: "confirmed-platform", field: "platform", operator: "eq", value: trimmed, importance: "hard" });
}

function parsePrivateSearchAnswer(value: string): Constraint | null {
  const trimmed = value.trim();
  if (/^(y|yes|true|allow|allowed)$/i.test(trimmed)) {
    return confirmed({ id: "confirmed-private-search", field: "private_search", operator: "eq", value: "yes", importance: "hard" });
  }
  if (/^(n|no|false|deny|denied)$/i.test(trimmed)) {
    return confirmed({ id: "confirmed-private-search", field: "private_search", operator: "eq", value: "no", importance: "hard" });
  }
  return null;
}

function parseGeographyAnswer(value: string): Constraint | null {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return null;
  const named = extractNamedGeography(trimmed);
  const resolved = named?.value ?? trimmed;
  if (!/[A-Za-z]/.test(resolved)) return null;
  return confirmed({
    id: `confirmed-geography-${resolved.replace(/\s+/g, "-").slice(0, 40)}`,
    field: "geography",
    operator: "eq",
    value: resolved,
    importance: "hard",
  });
}

function parseTextAnswer(field: MaterialClarificationField, value: string): Constraint | null {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 200) return null;
  return confirmed({
    id: `confirmed-${field}`,
    field,
    operator: "eq",
    value: trimmed,
    importance: "hard",
  });
}

export function isTypedClarificationField(field: string): field is TypedClarificationField {
  return (TYPED_CLARIFICATION_FIELDS as readonly string[]).includes(field);
}

/** Field-specific schemas for /continue answers. Never generic lowercase hard eq. */
export function constraintFromClarificationAnswer(field: string, value: string): ClarificationAnswerResult {
  const trimmedField = field.trim();
  const trimmedValue = value.trim();
  if (!trimmedField || !isTypedClarificationField(trimmedField)) return { ok: false, reason: "unsupported_field" };
  if (!trimmedValue) return { ok: false, reason: "invalid_value" };
  let constraint: Constraint | null = null;
  if (trimmedField === "geography") constraint = parseGeographyAnswer(trimmedValue);
  else if (trimmedField === "budget") constraint = parseBudgetAnswer(trimmedValue);
  else if (trimmedField === "currency") constraint = parseCurrencyAnswer(trimmedValue);
  else if (trimmedField === "timeframe") constraint = parseTimeframeAnswer(trimmedValue);
  else if (trimmedField === "platform") constraint = parsePlatformAnswer(trimmedValue);
  else if (trimmedField === "private_search") constraint = parsePrivateSearchAnswer(trimmedValue);
  else constraint = parseTextAnswer(trimmedField, trimmedValue);
  if (!constraint) return { ok: false, reason: "invalid_value" };
  return { ok: true, constraint };
}
