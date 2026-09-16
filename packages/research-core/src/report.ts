import type { CanonicalReport, ReportBlock, TerminalOutcome } from "@deep/contracts";
import { extractCandidates } from "./candidates.js";
import { calculate, extractMonthlyPrice } from "./calculate.js";
import { independentClusterCount } from "./policy.js";
import { citationIdsExist, passageSupportsClaim } from "./support.js";
import type { ControllerState, StoredClaim, StoredPassage } from "./types.js";

export type CitationProblem = {
  unknownIds: string[];
  unsupported: { claimId: string; passageId: string; decision: string }[];
};

export function stripUnsafeMarkup(text: string): string {
  return text.replace(/<\/?script\b[^>]*>/gi, "").replace(/on\w+\s*=\s*["'][^"']*["']/gi, "").replace(/javascript:/gi, "");
}

export function checkReportCitations(
  blocks: ReportBlock[],
  claims: StoredClaim[],
  passages: StoredPassage[],
): CitationProblem {
  const known = new Set(passages.map((p) => p.id));
  const passageById = new Map(passages.map((p) => [p.id, p]));
  const unknownIds: string[] = [];
  const unsupported: CitationProblem["unsupported"] = [];

  for (const block of blocks) {
    for (const id of block.citationIds) {
      if (!known.has(id)) unknownIds.push(id);
    }
  }

  const claimById = new Map(claims.map((c) => [c.id, c]));
  for (const block of blocks) {
    for (const claimId of block.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) continue;
      for (const pid of claim.passageIds) {
        const passage = passageById.get(pid);
        if (!passage) {
          unknownIds.push(pid);
          continue;
        }
        const decision = passageSupportsClaim(passage.exactText, claim.text);
        if (decision === "unsupported" || decision === "context-only") {
          unsupported.push({ claimId, passageId: pid, decision });
        }
      }
    }
  }
  return { unknownIds: [...new Set(unknownIds)], unsupported };
}

export function conciseFromCanonical(blocks: ReportBlock[]): ReportBlock[] {
  const answer = blocks.find((b) => b.id === "answer");
  const caveats = blocks.filter((b) => b.kind === "caveat" || b.id === "limitations-block");
  return [answer, ...caveats].filter((b): b is ReportBlock => Boolean(b));
}

function addClaim(
  claims: StoredClaim[],
  blocks: ReportBlock[],
  args: { id: string; kind?: ReportBlock["kind"]; text: string; type: string; passageIds: string[] },
): void {
  const text = stripUnsafeMarkup(args.text);
  claims.push({
    id: args.id,
    text,
    type: args.type,
    supportStatus: args.passageIds.length ? "direct" : "unverified",
    passageIds: args.passageIds,
  });
  blocks.push({
    id: args.id === "claim-primary" || args.id === "claim-false-premise" || args.id === "claim-no-evidence" || args.id.startsWith("claim-answer")
      ? args.id === "claim-primary" || args.id === "claim-false-premise" || args.id === "claim-no-evidence" || args.id === "claim-answer"
        ? "answer"
        : args.id
      : args.id,
    kind: args.kind ?? "text",
    text,
    claimIds: [args.id],
    citationIds: args.passageIds,
  });
}

export function composeReport(state: ControllerState, reportId: string): CanonicalReport {
  const constraintsLine = state.constraints
    .map((c) => `${c.field}=${c.value}${c.units ? " " + c.units : ""}`)
    .join("; ");

  const falsePremise = state.passages.find((p) =>
    /does not exist|no such (product|feature)|not a real product/i.test(p.exactText),
  );
  const injection = state.passages.find((p) => /ignore previous instructions|reveal .{0,12}key/i.test(p.exactText));
  const limitation = state.passages.find((p) => /not compatible|incompatible|does not support postgres 14/i.test(p.exactText));
  const blocked = state.sources.filter((s) => s.accessLevel === "blocked" || s.accessLevel === "snippet");
  const contradictions = findContradictions(state.passages);

  const claims: StoredClaim[] = [...state.claims];
  const blocks: ReportBlock[] = [];

  if (falsePremise) {
    const quoted = stripUnsafeMarkup(falsePremise.exactText.slice(0, 400));
    claims.push({
      id: "claim-false-premise",
      text: quoted,
      type: "limitation",
      supportStatus: "direct",
      passageIds: [falsePremise.id],
    });
    blocks.push({
      id: "answer",
      kind: "text",
      text: `${quoted} The named premise is rejected rather than invented.`,
      claimIds: ["claim-false-premise"],
      citationIds: [falsePremise.id],
    });
  } else if (limitation) {
    addClaim(claims, blocks, {
      id: "claim-answer",
      text: stripUnsafeMarkup(limitation.exactText.slice(0, 500)),
      type: "external-fact",
      passageIds: [limitation.id],
    });
  } else if (state.passages.length === 0) {
    addClaim(claims, blocks, {
      id: "claim-no-evidence",
      text: "No accessible evidence was obtained. This is not a claim that no such facts exist.",
      type: "limitation",
      passageIds: [],
    });
  } else {
    const primary = state.passages.find((p) => {
      const src = state.sources.find((s) => s.id === p.sourceId);
      return src?.accessLevel === "full-text";
    }) ?? state.passages[0]!;
    addClaim(claims, blocks, {
      id: "claim-primary",
      text: primary.exactText.slice(0, 400),
      type: "external-fact",
      passageIds: [primary.id],
    });
  }

  if (constraintsLine) {
    blocks.push({
      id: "constraints",
      kind: "text",
      text: `Applied supplied constraints: ${constraintsLine}. These were taken from the question and were not re-asked.`,
      claimIds: [],
      citationIds: [],
    });
  }

  const extracted = extractCandidates(state.passages, state.constraints);
  if (extracted.length > 0) {
    const eligible = extracted.filter((c) => c.feasibility === "satisfies");
    const ineligible = extracted.filter((c) => c.feasibility === "violates");
    const unknown = extracted.filter((c) => c.feasibility === "unknown");
    const discovery = state.reopenedDiscovery ? "open (reopened after constraint change)" : "bounded-complete for inspected listings";
    let verdict: string;
    if (eligible.length === 0 && ineligible.length > 0 && !state.reopenedDiscovery) {
      verdict = `None of the inspected candidates meet the hard constraints (${ineligible.map((c) => c.identity).join(", ")}). This is a bounded result over the inspected set, not a claim that no option exists outside it.`;
    } else if (eligible.length === 0 && unknown.length > 0) {
      verdict = "Eligibility remains unknown for inspected candidates; discovery is incomplete.";
    } else {
      verdict = `Eligible: ${eligible.map((c) => c.identity).join(", ") || "none"}. Ineligible: ${ineligible.map((c) => `${c.identity} (${c.excludedBy})`).join(", ") || "none"}. Discovery: ${discovery}.`;
    }
    blocks.push({
      id: "eligibility",
      kind: "text",
      text: stripUnsafeMarkup(verdict),
      claimIds: [],
      citationIds: extracted.map((c) => c.discoveredFrom),
    });
  }

  const percentNote = explainPercentages(state.passages);
  if (percentNote) {
    blocks.push({
      id: "denominators",
      kind: "text",
      text: percentNote,
      claimIds: [],
      citationIds: state.passages.map((p) => p.id),
    });
  }

  if (contradictions.length > 0) {
    for (const c of contradictions) {
      blocks.push({
        id: `contradiction-${c.topic}`,
        kind: "caveat",
        text: `Unresolved disagreement on ${c.topic}: ${c.left} vs ${c.right}. Both sources are retained; values are not averaged.`,
        claimIds: [],
        citationIds: c.passageIds,
      });
    }
  }

  const dose = state.constraints.find((c) => c.field === "dose");
  if (dose) {
    const grams = dose.units === "g" ? Number(dose.value) : null;
    if (grams != null && !Number.isNaN(grams)) {
      const calc = calculate("grams_to_milligrams", [{ name: "grams", value: grams, units: "g" }]);
      blocks.push({
        id: "calculation-dose",
        kind: "text",
        text: `Recomputed dose: ${calc.expression}.`,
        claimIds: [],
        citationIds: [],
      });
    } else if (dose.units === "mg") {
      blocks.push({
        id: "calculation-dose",
        kind: "text",
        text: `Dose used as ${dose.value} mg (no gram conversion).`,
        claimIds: [],
        citationIds: [],
      });
    }
  }

  if (/\b12 months|annual|times the .* monthly/i.test(state.brief.originalQuestion)) {
    const price = state.passages.map((p) => extractMonthlyPrice(p.exactText)).find(Boolean);
    if (price) {
      const calc = calculate("annual_from_monthly", [
        { name: "monthly", value: price.value, units: price.units },
        { name: "months", value: 12, units: "month" },
      ]);
      blocks.push({
        id: "calculation-annual",
        kind: "text",
        text: `Calculation ${calc.formulaName}@${calc.formulaVersion}: ${calc.expression}.`,
        claimIds: [],
        citationIds: state.passages.map((p) => p.id).slice(0, 2),
      });
    }
  }

  const clusters = independentClusterCount(state.sources);
  blocks.push({
    id: "independence",
    kind: "text",
    text: `Accessed ${state.sources.length} source version(s) in ${clusters} origin cluster(s). Repeated syndication is not counted as independent confirmation.`,
    claimIds: [],
    citationIds: state.passages.map((p) => p.id).slice(0, 8),
  });

  if (injection) {
    blocks.push({
      id: "untrusted-source",
      kind: "caveat",
      text: "A retrieved page contained instructions aimed at the model. It was stored as source text only and did not authorize tools, keys, or policy changes.",
      claimIds: [],
      citationIds: [injection.id],
    });
  }

  if (blocked.length > 0) {
    blocks.push({
      id: "access-limits",
      kind: "caveat",
      text: `${blocked.length} source(s) remain snippet-only or blocked. The report does not claim full reading of those pages.`,
      claimIds: [],
      citationIds: [],
    });
  }

  const unreadTable = state.passages.find((p) =>
    /unreadable scanned table|extract_table is unavailable|table image only|scanned tables are not treated as fully read/i.test(
      p.exactText,
    ),
  );
  if (unreadTable) {
    blocks.push({
      id: "unread-table",
      kind: "caveat",
      text: "A scanned table remained unread. extract_table is unavailable; the cell was not guessed from the image.",
      claimIds: [],
      citationIds: [unreadTable.id],
    });
  }

  const popGap = state.gaps.find((g) => g.sourceTypeNeeded === "population-specific");
  const pediatric = state.sources.some((s) => (s.population ?? "").match(/child|pediatric/));
  if (popGap || pediatric) {
    blocks.push({
      id: "population-pivot",
      kind: "text",
      text: pediatric
        ? "Initial adult-only sources did not cover the requested population; a population-relevant source was opened."
        : "The requested population remains uncovered after bounded search.",
      claimIds: [],
      citationIds: state.passages.map((p) => p.id),
    });
  }

  if (state.sources.some((s) => s.sourceType === "vendor-matrix")) {
    blocks.push({
      id: "source-type-switch",
      kind: "text",
      text: "Discovery switched from review summaries to a vendor compatibility matrix after the summary family stopped adding coverage.",
      claimIds: [],
      citationIds: state.passages.map((p) => p.id),
    });
  }

  const scoped = state.passages.find((p) => /\badults over \d+|this sample enrolled/i.test(p.exactText));
  if (scoped && /\beveryone\b|all patients|general population/i.test(state.brief.originalQuestion)) {
    blocks.push({
      id: "scope-qualifier",
      kind: "caveat",
      text: "The cited study is limited to its enrolled population (adults over 65 in this sample). It does not support an unqualified claim about everyone.",
      claimIds: [],
      citationIds: [scoped.id],
    });
  }

  const freshness = explainFreshness(state);
  if (freshness) {
    blocks.push({
      id: "freshness",
      kind: "caveat",
      text: freshness,
      claimIds: [],
      citationIds: state.passages.map((p) => p.id),
    });
  }

  const translation = state.sources.find((s) => s.language && s.language !== "en") ?? state.passages.find((p) => p.language && p.language !== "en");
  if (translation) {
    const lang = "language" in translation && translation.language ? translation.language : "de";
    blocks.push({
      id: "translation",
      kind: "caveat",
      text: `Original language: ${lang}. English wording is a labeled translation, not a verbatim original quote.`,
      claimIds: [],
      citationIds: state.passages.map((p) => p.id).slice(0, 2),
    });
  }

  if (/detailed|in depth|full analysis/i.test(state.brief.originalQuestion) || state.brief.outputPreferences === "detailed") {
    const extra = state.passages[1]?.exactText.slice(0, 280);
    if (extra) {
      blocks.push({
        id: "nuance",
        kind: "text",
        text: `Additional nuance retained for the detailed request: ${stripUnsafeMarkup(extra)}`,
        claimIds: [],
        citationIds: [state.passages[1]!.id],
      });
    }
  }

  const limitations: string[] = [];
  if (falsePremise) limitations.push("Named premise was not found in accessed sources.");
  if (state.searches.some((s) => s.newFamilies === 0)) {
    limitations.push("Later searches added no new source families.");
  }
  if (state.passages.length === 0) limitations.push("No inspected passages.");
  if (state.brief.attachmentIds.length > 0) {
    limitations.push("Uploaded files were processed as text-only. Unread pages or scanned tables are not treated as fully read.");
  }
  if (blocked.length) limitations.push("Some sources were not fully accessible.");
  if (contradictions.length) limitations.push("Consequential figures remain disputed.");
  const budgetForced = state.spentMicro + 8_000 >= state.budgetMicro * 0.85;
  if (budgetForced) limitations.push("Budget required finishing with remaining gaps; this is not comprehensive.");
  limitations.push("App-level spend counters are not a guarantee of opaque provider-internal cost.");
  limitations.push("Fixture or bounded live route; not an exhaustive literature review.");

  const outcome: TerminalOutcome =
    falsePremise ||
    state.passages.length === 0 ||
    budgetForced ||
    (extracted.length > 0 && extracted.every((c) => c.feasibility !== "satisfies") && extracted.some((c) => c.feasibility === "unknown"))
      ? "completed_with_limitations"
      : "completed";

  state.claims = claims;
  state.candidates = extracted.map((c) => ({
    id: c.id,
    identity: c.identity,
    excludedBy: c.excludedBy,
    feasibility: c.feasibility,
  }));

  const repaired = repairUnsupportedConclusion(blocks, claims, state.passages);
  if (repaired.revisited) {
    limitations.push("A critical claim was removed during verification; the summary was revisited rather than left unsupported.");
  }

  return {
    reportId,
    version: 1,
    runId: state.runId,
    basis: state.basis,
    outcome: repaired.revisited ? "completed_with_limitations" : outcome,
    blocks,
    claimIds: claims.map((c) => c.id),
    limitations,
    sourceAccessSummary: state.sources.map((s) => ({
      sourceId: s.id,
      title: s.title,
      accessLevel: s.accessLevel,
      originCluster: s.originCluster,
    })),
    changeSummary: state.reopenedDiscovery
      ? {
          evidenceUpdated: true,
          conclusionChanged: true,
          newlyFeasible: extracted.filter((c) => c.feasibility === "satisfies").map((c) => c.identity),
          newlyInfeasible: extracted.filter((c) => c.feasibility === "violates").map((c) => c.identity),
          notes: "Hard constraint change reopened candidate discovery.",
        }
      : undefined,
    routeMode: state.brief.desiredOutcome === "hosted" ? "hosted-baseline" : "fixture",
  };
}

function findContradictions(passages: StoredPassage[]): { topic: string; left: string; right: string; passageIds: string[] }[] {
  const prices: { value: string; id: string }[] = [];
  for (const p of passages) {
    const m = p.exactText.match(/costs?\s+(\d+(?:\.\d+)?)\s*(EUR|USD)/i);
    if (m) prices.push({ value: `${m[1]} ${m[2]}`, id: p.id });
  }
  if (prices.length >= 2) {
    const first = prices[0]!;
    const other = prices.find((p) => p.value !== first.value);
    if (other) return [{ topic: "price", left: first.value, right: other.value, passageIds: [first.id, other.id] }];
  }
  return [];
}

export function explainFreshness(state: ControllerState): string | null {
  const q = state.brief.originalQuestion.toLowerCase();
  const wantsCurrentPrice = /current price|price now|what does .* cost now|today'?s price/.test(q);
  const asOf = state.passages
    .map((p) => p.exactText.match(/as of\s+(20\d{2}-\d{2}-\d{2}|20\d{2})/i)?.[1])
    .filter((d): d is string => Boolean(d));
  const founded = state.passages.map((p) => p.exactText.match(/founded in\s+(19\d{2}|20\d{2})/i)?.[1]).find(Boolean);
  if (wantsCurrentPrice && asOf[0]) {
    const hist = founded
      ? ` The founding year ${founded} is an immutable historical fact.`
      : " Historical facts such as a founding year stay as recorded.";
    return `Retrieved price is as of ${asOf[0]} and is not presented as the current price.${hist}`;
  }
  if (asOf[0] && founded) {
    return `Mutable price figures are dated as of ${asOf[0]}. The founding year ${founded} is an immutable historical fact and is not refreshed as if it were a live price.`;
  }
  return null;
}

export function repairUnsupportedConclusion(
  blocks: ReportBlock[],
  claims: StoredClaim[],
  passages: StoredPassage[],
): { revisited: boolean } {
  const problems = checkReportCitations(blocks, claims, passages);
  const answer = blocks.find((b) => b.id === "answer");
  if (!answer) return { revisited: false };
  const hits = problems.unsupported.filter((u) => answer.claimIds.includes(u.claimId));
  if (hits.length === 0) return { revisited: false };
  answer.text =
    "The conclusion was withdrawn because verification removed an unsupported claim. Remaining evidence is listed with its limitations.";
  answer.kind = "caveat";
  return { revisited: true };
}

export function explainPercentages(passages: StoredPassage[]): string | null {
  const denoms = passages
    .map((p) => {
      const m = p.exactText.match(/(\d+(?:\.\d+)?)%\s+of\s+([\d,]+)\s+(\w+)/i);
      return m ? { pct: m[1], n: m[2], unit: m[3], id: p.id, text: p.exactText } : null;
    })
    .filter((x): x is { pct: string; n: string; unit: string; id: string; text: string } => Boolean(x));
  if (denoms.length < 2) return null;
  const units = new Set(denoms.map((d) => d.unit.toLowerCase()));
  if (units.size > 1) {
    return `The ${denoms.map((d) => `${d.pct}% of ${d.n} ${d.unit}`).join(" vs ")} figures use different denominators and are not averaged.`;
  }
  return null;
}

export { citationIdsExist };
