import { passageSupportsClaim, type SupportDecision } from "./support.js";
import type { StoredClaim, StoredPassage, StoredSource } from "./types.js";
import type { ReportBlock } from "@deep/contracts";

export type CitationValidation = {
  unknownIds: string[];
  unownedIds: string[];
  wrongVersion: { citationId: string; passageVersionId: string; expectedHint: string }[];
  unsupported: { claimId: string; passageId: string; decision: SupportDecision }[];
  overstrong: { claimId: string; reason: string }[];
  missingClaims: string[];
  unmappedBlocks: string[];
};

/**
 * Material citation checks: exists, owned by this run, points at the stored source version,
 * actually supports the claim, and is not stronger than the evidence.
 */
export function validateMaterialCitations(args: {
  blocks: ReportBlock[];
  claims: StoredClaim[];
  passages: StoredPassage[];
  sources?: StoredSource[];
  runPassageIds?: Set<string>;
  currentVersionBySource?: Map<string, string>;
}): CitationValidation {
  const known = new Set(args.passages.map((p) => p.id));
  const owned = args.runPassageIds ?? known;
  const passageById = new Map(args.passages.map((p) => [p.id, p]));
  const claimById = new Map(args.claims.map((c) => [c.id, c]));
  const unknownIds: string[] = [];
  const unownedIds: string[] = [];
  const wrongVersion: CitationValidation["wrongVersion"] = [];
  const unsupported: CitationValidation["unsupported"] = [];
  const overstrong: CitationValidation["overstrong"] = [];
  const missingClaims: string[] = [];
  const unmappedBlocks: string[] = [];

  function checkBinding(id: string) {
    if (!known.has(id)) unknownIds.push(id);
    else if (!owned.has(id)) unownedIds.push(id);
    const passage = passageById.get(id);
    const current = passage && args.currentVersionBySource?.get(passage.sourceId);
    if (passage && current && current !== passage.sourceVersionId) {
      wrongVersion.push({ citationId: id, passageVersionId: passage.sourceVersionId, expectedHint: current });
    }
  }

  for (const block of args.blocks) {
    for (const id of block.citationIds) {
      checkBinding(id);
    }
  }

  for (const block of args.blocks) {
    if (block.kind !== "heading" && block.kind !== "caveat" && block.text.trim() && !block.claimIds.length) {
      unmappedBlocks.push(block.id);
    }
    for (const claimId of block.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) { missingClaims.push(claimId); continue; }
      if (claim.passageIds.length === 0 && (claim.type === "external-fact" || claim.type === "conditional-conclusion")) {
        unsupported.push({ claimId, passageId: "", decision: "unsupported" });
        continue;
      }
      for (const pid of claim.passageIds) {
        checkBinding(pid);
        const passage = passageById.get(pid);
        if (!passage) {
          unknownIds.push(pid);
          continue;
        }
        const decision = passageSupportsClaim(passage.exactText, claim.text);
        if (decision === "unsupported" || decision === "context-only" || decision === "contradicts") {
          unsupported.push({ claimId, passageId: pid, decision });
        }
        if (decision === "qualifies") {
          overstrong.push({ claimId, reason: "claim is stronger than the scoped passage" });
        }
      }
    }
  }

  return {
    unknownIds: [...new Set(unknownIds)],
    unownedIds: [...new Set(unownedIds)],
    wrongVersion,
    unsupported,
    overstrong,
    missingClaims: [...new Set(missingClaims)],
    unmappedBlocks: [...new Set(unmappedBlocks)],
  };
}

export function citationValidationFails(v: CitationValidation): boolean {
  return (
    v.unknownIds.length > 0 ||
    v.unownedIds.length > 0 ||
    v.wrongVersion.length > 0 ||
    v.unsupported.length > 0 ||
    v.overstrong.length > 0 ||
    v.missingClaims.length > 0 ||
    v.unmappedBlocks.length > 0
  );
}
