import { createHash } from "node:crypto";
import type { CanonicalReport } from "@deep/contracts";
import { SCOPED_SUPPORT_VERSION, passageSupportsClaim, type StoredClaim, type StoredPassage, type ReportDerivationContext } from "@deep/research-core";
import type { Queryable } from "../platform/db.js";

export const SUPPORT_CHECKER_VERSION = "literal-scope-v4";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Called in the publication transaction only after authoritative evidence validation.
 * This records the check actually performed; literal support is not general semantic verification.
 */
export async function persistCheckedClaims(db: Queryable, args: {
  accountId: string; report: CanonicalReport; claims: StoredClaim[]; passages: StoredPassage[];
  derivationContext: ReportDerivationContext;
  scopedApprovals?:ReadonlyMap<string,{claimId:string;text:string;passageIds:string[]}>;
}): Promise<CanonicalReport> {
  const referenced = new Set(args.report.blocks.flatMap((block) => block.claimIds));
  const ids = new Map<string, string>();
  const passages = new Map(args.passages.map((p) => [p.id, p]));
  for (const claim of args.claims.filter((c) => referenced.has(c.id))) {
    if (ids.has(claim.id)) throw new Error("duplicate_claim_identity");
    const scoped=args.scopedApprovals?.get(claim.id);
    if(scoped) {
      if(scoped.text!==claim.text || JSON.stringify([...new Set(scoped.passageIds)].sort())!==JSON.stringify([...new Set(claim.passageIds)].sort())) throw new Error("scoped_claim_binding_mismatch");
      const updated=await db.query("UPDATE claims SET support_status=CASE WHEN type='inference' THEN 'inference' ELSE 'direct' END WHERE id=$1 AND account_id=$2 AND run_id=$3 AND text=$4",[claim.id,args.accountId,args.report.runId,claim.text]);
      if(updated.rowCount!==1) throw new Error("scoped_claim_owner_mismatch");
      ids.set(claim.id,claim.id);
      for(const passageId of scoped.passageIds) await db.query(`INSERT INTO claim_evidence(claim_id,passage_id,relation,checker_version,decision,explanation)
        VALUES($1,$2,'supports',$3,'supports','Current scoped support result revalidated at publication') ON CONFLICT DO NOTHING`,[claim.id,passageId,SCOPED_SUPPORT_VERSION]);
      continue;
    }
    const id = crypto.randomUUID(), revisionId = crypto.randomUUID();
    ids.set(claim.id, id);
    const scope = { briefRevision: args.report.basis.briefRevision, evidenceRevision: args.report.basis.evidenceRevision,
      sourceVersions: claim.passageIds.map((pid) => passages.get(pid)?.sourceVersionId ?? "missing").sort(),
      semanticScope: "not_independently_extracted" };
    await db.query(`INSERT INTO claims(id,run_id,account_id,text,type,support_status) VALUES($1,$2,$3,$4,$5,$6)`,
      [id,args.report.runId,args.accountId,claim.text,claim.type,claim.supportStatus]);
    await db.query(`INSERT INTO claim_revisions(id,claim_id,account_id,run_id,revision,text,text_digest,scope) VALUES($1,$2,$3,$4,1,$5,$6,$7)`,
      [revisionId,id,args.accountId,args.report.runId,claim.text,digest(claim.text),JSON.stringify(scope)]);
    if (claim.derivation) {
      const inputs = JSON.stringify(claim.derivation === "supplied-constraints" ? args.derivationContext.constraints
        : claim.derivation === "source-counts" ? args.derivationContext.sources.map((s) => ({ id: s.id, originCluster: s.originCluster }))
        : claim.derivation === "statement-classes" ? args.derivationContext.claims.filter((c) => !c.derivation)
        : { constraints: args.derivationContext.constraints,
          passages: args.derivationContext.passages.filter((p) => claim.derivation !== "evidence-comparison" || claim.passageIds.includes(p.id))
            .map((p) => ({ id: p.id, sourceVersionId: p.sourceVersionId, digest: digest(p.exactText) })),
          sources: args.derivationContext.sources });
      await db.query(`INSERT INTO report_derivations(claim_revision_id,account_id,run_id,kind,checker_version,inputs,input_digest,output_digest)
        VALUES($1,$2,$3,$4,'report-derivation-v1',$5,$6,$7)`, [revisionId,args.accountId,args.report.runId,claim.derivation,inputs,digest(inputs),digest(claim.text)]);
    }
    for (const passageId of new Set(claim.derivation ? [] : claim.passageIds)) {
      const passage = passages.get(passageId);
      if (!passage) throw new Error("missing_passage");
      const decision = passageSupportsClaim(passage.exactText, claim.text);
      await db.query(`INSERT INTO support_assessments(claim_revision_id,passage_id,account_id,run_id,evidence_digest,scope_digest,checker_version,decision)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [revisionId,passageId,args.accountId,args.report.runId,
        digest(passage.exactText),digest(JSON.stringify(scope)),SUPPORT_CHECKER_VERSION,decision]);
      await db.query(`INSERT INTO claim_evidence(claim_id,passage_id,relation,checker_version,decision,explanation)
        VALUES($1,$2,$3,$4,$3,$5)`, [id,passageId,decision,SUPPORT_CHECKER_VERSION,"Persisted literal/scope check; semantic coverage remains limited."]);
    }
  }
  return { ...args.report, claimIds: [...ids.values()], blocks: args.report.blocks.map((b) => ({ ...b,
    claimIds: b.claimIds.map((id) => { const saved = ids.get(id); if (!saved) throw new Error("missing_claim"); return saved; }) })) };
}
