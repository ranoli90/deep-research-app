import { editorialSections } from "./report-hierarchy";
import type { ReportBlock } from "./state";

export type FollowUpSuggestion = { id: string; label: string; prompt: string };

/** Chip label length; stays scannable in the composer dock. */
export const FOLLOW_UP_LABEL_MAX = 36;
/** Draft fill length; never dump a full caveat or 10k-char block into the composer. */
export const FOLLOW_UP_PROMPT_MAX = 160;
export const FOLLOW_UP_MAX = 3;

function shorten(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trimEnd()}…`;
}

function decapitalize(text: string): string {
  if (!text) return text;
  if (/^[A-Z]{2,}/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function firstSentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const match = compact.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : compact).trim();
}

/** Research-process / fixture internals are not consumer follow-up questions. */
export function isProcessMetaFollowUp(text: string): boolean {
  return /spend counters|provider-internal|fixture or bounded|labeled demo|not an exhaustive|disconfirmation remains|absence of a recorded counterexample|app-level spend|later searches added no new source/i.test(text);
}

/** Turn unresolved/caveat/limitation prose into a short next-ask question. */
export function asFollowUpQuestion(text: string): string {
  let t = firstSentence(text);
  if (!t) return "";
  t = t.replace(/^(unresolved|caveat|limitation|note)\s*[:\-—]\s*/i, "");
  if (isProcessMetaFollowUp(t)) return "";
  if (/\?\s*$/.test(t)) return shorten(t, FOLLOW_UP_PROMPT_MAX);

  let m = t.match(/^(.+?)\s+(?:is|are|remains?)\s+unresolved\.?$/i);
  if (m) return shorten(`What is ${decapitalize(m[1].trim())}?`, FOLLOW_UP_PROMPT_MAX);

  m = t.match(/^(.+?)\s+(?:was|were)\s+not\s+(?:measured|checked|verified|inspected|tested|found|reviewed)\.?$/i);
  if (m) return shorten(`What about ${decapitalize(m[1].trim())}?`, FOLLOW_UP_PROMPT_MAX);

  m = t.match(/^Did not\s+(inspect|check|measure|verify|review|test)\s+(.+?)\.?$/i);
  if (m) return shorten(`${capitalize(m[1])} ${m[2].replace(/\.+$/, "")}?`, FOLLOW_UP_PROMPT_MAX);

  m = t.match(/^(.+?)\s+disagree(?:s)?\s+with\s+(.+?)\.?$/i);
  if (m) {
    return shorten(
      `Reconcile ${decapitalize(m[1].trim())} with ${decapitalize(m[2].trim())}?`,
      FOLLOW_UP_PROMPT_MAX,
    );
  }

  const stripped = t.replace(/[.!]+$/, "").trim();
  if (stripped.length < 12 || stripped.length > 80) return "";
  return shorten(`What about ${decapitalize(stripped)}?`, FOLLOW_UP_PROMPT_MAX);
}

/** Fill the composer from a chip; keeps replace_question lineage without dumping caveat prose. */
export function draftFromFollowUp(input: {
  prompt: string;
  originalQuestion?: string | null;
  replaceQuestion: boolean;
}): string {
  const prompt = shorten(input.prompt, FOLLOW_UP_PROMPT_MAX);
  if (input.replaceQuestion && input.originalQuestion?.trim()) {
    return `${input.originalQuestion.trim()} Also: ${prompt}`;
  }
  return prompt;
}

/**
 * Up to three suggested next asks from unresolved items, caveats, and named limitations.
 * Placement is the composer dock (above the field), not under the answer — chips stay
 * visible while the keyboard is open and rewrite the draft on tap.
 */
export function followUpSuggestions(input: {
  blocks: ReportBlock[];
  limitations?: string[];
}): FollowUpSuggestion[] {
  const sections = editorialSections(input.blocks);
  const unresolved = sections.find((section) => section.id === "unresolved")?.blocks ?? [];
  const caveats = sections.find((section) => section.id === "caveats")?.blocks ?? [];
  const items: { id: string; text: string }[] = [];
  for (const block of unresolved) items.push({ id: block.id, text: block.text.trim() });
  for (const block of caveats) items.push({ id: block.id, text: block.text.trim() });
  for (const [index, line] of (input.limitations ?? []).entries()) {
    const text = line.trim();
    if (text) items.push({ id: `limitation-${index}`, text });
  }
  const seen = new Set<string>();
  const out: FollowUpSuggestion[] = [];
  for (const item of items) {
    const question = asFollowUpQuestion(item.text);
    const key = question.toLowerCase();
    if (!question || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: item.id,
      label: shorten(question, FOLLOW_UP_LABEL_MAX),
      prompt: question,
    });
    if (out.length === FOLLOW_UP_MAX) break;
  }
  return out;
}
