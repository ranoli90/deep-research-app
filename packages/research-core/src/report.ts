import type { CanonicalReport, ReportBlock, TerminalOutcome } from "@deep/contracts";
import { independentClusterCount } from "./policy.js";
import { citationIdsExist, passageSupportsClaim } from "./support.js";
import type { ControllerState, StoredClaim, StoredPassage } from "./types.js";

export type CitationProblem = {
  unknownIds: string[];
  unsupported: { claimId: string; passageId: string; decision: string }[];
};

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

export function composeReport(state: ControllerState, reportId: string): CanonicalReport {
  const constraintsLine = state.constraints
    .map((c) => `${c.field}=${c.value}${c.units ? " " + c.units : ""}`)
    .join("; ");

  const falsePremise = state.passages.find((p) =>
    /does not exist|no such (product|feature)|not a real product/i.test(p.exactText),
  );

  const injection = state.passages.find((p) => /ignore previous instructions|reveal .{0,12}key/i.test(p.exactText));

  const claims: StoredClaim[] = [...state.claims];
  const blocks: ReportBlock[] = [];

  if (falsePremise) {
    const claim = {
      id: "claim-false-premise",
      text: falsePremise.exactText.slice(0, 400),
      type: "limitation",
      supportStatus: "direct",
      passageIds: [falsePremise.id],
    };
    claims.push(claim);
    blocks.push({
      id: "answer",
      kind: "text",
      text: `${claim.text} The named premise is rejected rather than invented.`,
      claimIds: [claim.id],
      citationIds: [falsePremise.id],
    });
  } else if (state.passages.length === 0) {
    const claim = {
      id: "claim-no-evidence",
      text: "No accessible evidence was obtained. This is not a claim that no such facts exist.",
      type: "limitation",
      supportStatus: "unverified",
      passageIds: [],
    };
    claims.push(claim);
    blocks.push({
      id: "answer",
      kind: "text",
      text: claim.text,
      claimIds: [claim.id],
      citationIds: [],
    });
  } else {
    const primary = state.passages[0]!;
    const summary = primary.exactText.slice(0, 400);
    const claim = {
      id: "claim-primary",
      text: summary,
      type: "external-fact",
      supportStatus: "direct",
      passageIds: [primary.id],
    };
    claims.push(claim);
    blocks.push({
      id: "answer",
      kind: "text",
      text: summary,
      claimIds: [claim.id],
      citationIds: [primary.id],
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

  const limitations: string[] = [];
  if (falsePremise) limitations.push("Named premise was not found in accessed sources.");
  if (state.searches.some((s) => s.newFamilies === 0)) {
    limitations.push("Later searches added no new source families.");
  }
  if (state.passages.length === 0) limitations.push("No inspected passages.");
  limitations.push("Fixture or bounded live route; not an exhaustive literature review.");

  const outcome: TerminalOutcome =
    falsePremise || state.passages.length === 0 ? "completed_with_limitations" : "completed";

  // Keep claims on state for later support checks by using the composed claims list.
  state.claims = claims;

  return {
    reportId,
    version: 1,
    runId: state.runId,
    basis: state.basis,
    outcome,
    blocks,
    claimIds: claims.map((c) => c.id),
    limitations,
    sourceAccessSummary: state.sources.map((s) => ({
      sourceId: s.id,
      title: s.title,
      accessLevel: s.accessLevel,
      originCluster: s.originCluster,
    })),
    routeMode: state.brief.desiredOutcome === "hosted" ? "hosted-baseline" : "fixture",
  };
}

export { citationIdsExist };
