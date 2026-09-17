import { passageSupportsClaim, type SupportDecision } from "./support.js";
import type { StoredClaim, StoredPassage, StoredSource } from "./types.js";
import type { ReportBlock } from "@deep/contracts";
import { deriveReportText, type ReportDerivationContext } from "./report-derivations.js";

// Only non-assertive section labels and application-owned abstentions may omit claim bindings.
const SECTION_LABELS = new Set(["Answer", "Evidence", "Sources", "Limitations", "Comparison", "Calculations", "Scope", "Uncertainty"]);
export function isReportSectionLabel(text:string):boolean { return SECTION_LABELS.has(text); }
export const UNRESOLVED_SECTION = "This section remains unresolved because its assertions could not be verified.";
export const UNRESOLVED_DISCONFIRMATION = "Disconfirmation remains unresolved. Absence of a recorded counterexample is not proof.";
const ABSTENTIONS = new Set([
  UNRESOLVED_SECTION,
  UNRESOLVED_DISCONFIRMATION,
  "No accessible evidence was obtained. This is not a claim that no such facts exist.",
  "The conclusion was withdrawn because verification removed an unsupported claim. Remaining evidence is listed with its limitations.",
]);

export type CitationValidation = {
  unknownIds: string[];
  unownedIds: string[];
  wrongVersion: { citationId: string; passageVersionId: string; expectedHint: string }[];
  unsupported: { claimId: string; passageId: string; decision: SupportDecision }[];
  overstrong: { claimId: string; reason: string }[];
  missingClaims: string[];
  unmappedBlocks: string[];
  duplicateClaims: string[];
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
  derivationContext?: ReportDerivationContext;
  scopedApprovals?: ReadonlyMap<string,{claimId:string;text:string;passageIds:string[]}>;
  rejectedScopedClaims?: ReadonlySet<string>;
  calculationApprovals?: ReadonlyMap<string,{claimId:string;text:string;passageIds:string[]}>;
}): CitationValidation {
  const known = new Set(args.passages.map((p) => p.id));
  const owned = args.runPassageIds ?? known;
  const passageById = new Map(args.passages.map((p) => [p.id, p]));
  const claimById = new Map(args.claims.map((c) => [c.id, c]));
  const counts = new Map<string, number>();
  for (const claim of args.claims) counts.set(claim.id, (counts.get(claim.id) ?? 0) + 1);
  const duplicateClaims = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
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
    const applicationText = (block.kind === "heading" && SECTION_LABELS.has(block.text)) ||
      (block.kind === "caveat" && ABSTENTIONS.has(block.text));
    if (!applicationText && block.text.trim() && !block.claimIds.length) {
      unmappedBlocks.push(block.id);
    }
    // A valid citation on one clause cannot authorize additional material prose.
    // Writers render mapped atomic claim text; deterministic derivations need their own claims.
    if (block.claimIds.length) {
      const normalized = (text: string) => text.replace(/\s+/gu, " ").trim();
      const mappedText = block.claimIds.map((id) => claimById.get(id)?.text ?? "").join(" ");
      if (normalized(mappedText) !== normalized(block.text)) unmappedBlocks.push(block.id);
    }
    for (const claimId of block.claimIds) {
      const claim = claimById.get(claimId);
      if (!claim) { missingClaims.push(claimId); continue; }
      if(args.rejectedScopedClaims?.has(claim.id)) unsupported.push({claimId,passageId:"",decision:"unsupported"});
      if (claim.derivation) {
        for (const pid of claim.passageIds) checkBinding(pid);
        if (!args.derivationContext || deriveReportText(claim.derivation, args.derivationContext, claim.passageIds) !== claim.text ||
            (claim.derivation !== "evidence-comparison" && claim.passageIds.length) || !claim.text.trim()) {
          unsupported.push({ claimId, passageId: "", decision: "unsupported" });
        }
        // A statement-class summary is only safe when its atomic inputs are independently checked too.
        if (claim.derivation === "statement-classes") {
          const mapped = new Set(args.blocks.flatMap((b) => b.claimIds));
          for (const dependency of args.derivationContext?.claims ?? []) {
            if (!dependency.derivation && dependency.supportStatus !== "withdrawn" &&
                (dependency.type === "external-fact" || dependency.type === "inference") && !mapped.has(dependency.id)) {
              missingClaims.push(dependency.id);
            }
          }
        }
        continue;
      }
      if (claim.passageIds.length === 0 && !(claim.type === "limitation" && ABSTENTIONS.has(claim.text))) {
        unsupported.push({ claimId, passageId: "", decision: "unsupported" });
        continue;
      }
      const calculation=claim.type==="calculation"?args.calculationApprovals?.get(claim.id):undefined;
      if(calculation&&claim.passageIds.some(id=>!block.citationIds.includes(id)))
        unsupported.push({claimId,passageId:"",decision:"unsupported"});
      const scoped=calculation??args.scopedApprovals?.get(claim.id);
      const scopedMatches=scoped?.claimId===claim.id && scoped.text===claim.text &&
        JSON.stringify([...new Set(scoped.passageIds)].sort())===JSON.stringify([...new Set(claim.passageIds)].sort());
      for (const pid of claim.passageIds) {
        checkBinding(pid);
        const passage = passageById.get(pid);
        if (!passage) {
          unknownIds.push(pid);
          continue;
        }
        if(scopedMatches) continue;
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
    duplicateClaims,
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
    v.unmappedBlocks.length > 0 ||
    v.duplicateClaims.length > 0
  );
}
