/** Fabricated native UI controller only. Never imported by production runtime. */
import { createHash } from "node:crypto";
import { ModelContextSchema } from "../src/ports/model.js";
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
export const FIRMWARE = "Ardent supports offline recording only on firmware 4.2.";
export const CARD = "Ardent requires a FAT32 card for offline recording.";
export const UNDERWATER = "Ardent does not support underwater recording.";
export function nativeDocumentAssertions(input: unknown) {
  const context = ModelContextSchema.parse(input);
  const ids = new Set<string>();
  for (const p of context.passages) {
    if (ids.has(p.id) || createHash("sha256").update(p.text).digest("hex") !== p.digest) throw new Error("Native control passage identity mismatch");
    ids.add(p.id);
  }
  const primary = context.question.includes("firmware") ? FIRMWARE : UNDERWATER;
  const sentences = [primary];
  // An optional extra fact is emitted only from supplied, actually parsed text.
  if (primary === FIRMWARE && context.passages.some(p => p.text.includes(CARD))) sentences.push(CARD);
  return { candidates: [], assertions: sentences.map((sentence, index) => {
    const passage = context.passages.find(p => p.text.includes(sentence));
    if (!passage) throw new Error("Actual extraction did not contain the synthetic native control statement");
    const start = passage.text.indexOf(sentence);
    return { key: index === 0 ? "recording" : "card", candidateKey: null, criterionKeys: ["recording"], text: sentence, scope, quantities: [],
      evidence: [{ passageId: passage.id, start, end: start + sentence.length, quote: sentence }] };
  }), limitations: [] };
}
export function nativeDocumentReport(input: unknown) {
  const context = ModelContextSchema.parse(input);
  const approved = context.assertions.filter(a => context.approvedClaimKeys.includes(a.key));
  if (!approved.length) throw new Error("Native control has no approved assertion to write");
  return { title: "Document finding", sections: [{ heading: "Evidence", paragraphs: approved.map(a => ({ text: a.text, claimKeys: [a.key] })) }], unresolvedQuestionKeys: [], limitations: [] };
}
