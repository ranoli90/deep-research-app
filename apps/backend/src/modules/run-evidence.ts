import type { Queryable } from "../platform/db.js";
import { bumpEvidence } from "./runs.js";
import { CONSENT_POLICY_VERSION, CanonicalReportSchema, ResearchBriefSchema } from "@deep/contracts";
import { createHash } from "node:crypto";
import { currentConsent } from "./access.js";
import { claimedConversationScope } from "./guest-auth.js";
import { claimedCorrectionProofAllowed, guestExecutionAllowed } from "./guest-execution-control.js";
/** Caller holds the account/admission lock. Copy membership, never source bytes or old approvals. */
export async function inheritRunEvidence(db:Queryable,args:{runId:string;parentRunId:string;accountId:string}) {
 const owned=await db.query(`SELECT c.id FROM runs c JOIN runs p ON p.id=c.parent_run_id JOIN accounts a ON a.id=c.account_id
  WHERE c.id=$1 AND p.id=$2 AND c.account_id=$3 AND p.account_id=$3 AND a.deleted_at IS NULL AND c.lifecycle='queued'`,[args.runId,args.parentRunId,args.accountId]);
 if(owned.rowCount!==1)throw new Error("evidence_inheritance_owner_or_state_mismatch");
 const inserted=await db.query(`INSERT INTO run_evidence_membership(run_id,account_id,passage_id,source_version_id,origin_run_id,passage_digest,version_digest)
  SELECT $1,$3,p.id,p.source_version_id,original.run_id,p.content_hash,v.content_hash
  FROM authorized_run_passages p JOIN passages original ON original.id=p.id JOIN source_versions v ON v.id=p.source_version_id
  WHERE p.run_id=$2 AND p.account_id=$3 AND v.access_level IN ('partial-text','full-text') AND v.content_hash IS NOT NULL
  ON CONFLICT DO NOTHING RETURNING passage_id`,[args.runId,args.parentRunId,args.accountId]);
 if(inserted.rowCount)await bumpEvidence(db,args.runId);
 return inserted.rowCount??0;
}

const CLAIMED_CONTEXT_PREFIX = "Claimed conversation context v1 (not evidence): ";

/**
 * Bind a claimed continuation to the exact live guest parent before model preparation.
 * Guest-owned passages are deliberately not copied into the member's evidence view:
 * the prior answer is conversation context, and every child citation must be newly owned.
 */
export async function prepareClaimedResearchContext(db: Queryable, args: {
  runId: string; accountId: string; briefRevision: number;
}): Promise<{ parentRunId: string; parentOwnerId: string; parentReportId: string | null;
  approvedPublicContextTerms: string[] } | null> {
  const child = (await db.query<{ id: string; brief_id: string; claimed_parent_run_id: string | null;
    claimed_parent_conversation_id: string | null; claimed_control_binding_id: string | null;
    claimed_control_version: string | null; guest_pending_action_id: string | null;
    parent_run_id: string | null }>(`SELECT id,brief_id,claimed_parent_run_id,claimed_parent_conversation_id,
      claimed_control_binding_id,claimed_control_version,guest_pending_action_id,parent_run_id
      FROM runs WHERE id=$1 AND account_id=$2 AND brief_revision=$3 FOR UPDATE`,
    [args.runId,args.accountId,args.briefRevision])).rows[0];
  if (!child) throw new Error("claimed_context_child_unavailable");
  const claimFields = [child.claimed_parent_run_id,child.claimed_parent_conversation_id,
    child.claimed_control_binding_id,child.claimed_control_version];
  if (claimFields.every((field) => field == null) && !child.guest_pending_action_id) return null;
  if (claimFields.some((field) => field == null) || child.parent_run_id)
    throw new Error("claimed_context_identity_mismatch");
  const parentRunId = child.claimed_parent_run_id!;
  const scope = await claimedConversationScope(db,args.accountId,parentRunId);
  if (!scope || scope.conversationId !== child.claimed_parent_conversation_id ||
      scope.controlBindingId !== child.claimed_control_binding_id ||
      scope.controlVersion !== Number(child.claimed_control_version) ||
      !await guestExecutionAllowed(db,args.runId,args.accountId) ||
      !await guestExecutionAllowed(db,parentRunId,scope.parentExecutionOwnerId))
    throw new Error("claimed_context_control_unavailable");
  if (!child.guest_pending_action_id) {
    if (!await claimedCorrectionProofAllowed(db, { runId: args.runId, memberAccountId: args.accountId,
      parentRunId, parentConversationId: scope.conversationId,
      bindingId: scope.controlBindingId, bindingVersion: scope.controlVersion }))
      throw new Error("claimed_context_correction_proof_unavailable");
    // A correction is a fresh member-funded rerun of the patched full question.
    // It needs the control fence, not a copy of the guest answer in model context.
    return null;
  }
  const pending = (await db.query<{ kind: string; parent_run_id: string | null }>(
    `SELECT payload->>'kind' AS kind,payload->>'parentRunId' AS parent_run_id
       FROM guest_pending_actions WHERE submission_id=$1 AND member_run_id=$2
       AND member_account_id=$3 AND state='dispatched'`,
    [child.guest_pending_action_id,args.runId,args.accountId])).rows[0];
  if (!pending || !["new_research","follow_up","clarification"].includes(pending.kind) ||
      (pending.kind === "follow_up" && pending.parent_run_id !== parentRunId))
    throw new Error("claimed_context_action_mismatch");
  // A fresh third-question-style action remains independent despite carrying
  // the claim fence used for control and deletion. It has no parent answer basis.
  if (pending.kind === "new_research") return null;
  const ownerConsent = await currentConsent(db,scope.parentExecutionOwnerId);
  const memberConsent = await currentConsent(db,args.accountId);
  if (!ownerConsent || ownerConsent.revoked || ownerConsent.policyVersion !== CONSENT_POLICY_VERSION ||
      !memberConsent || memberConsent.revoked || memberConsent.policyVersion !== CONSENT_POLICY_VERSION)
    throw new Error("claimed_context_consent_unavailable");
  const parent = (await db.query<{ brief_id: string }>(`SELECT p.brief_id FROM runs p
    JOIN accounts a ON a.id=p.account_id AND a.deleted_at IS NULL
    WHERE p.id=$1 AND p.account_id=$2 AND p.conversation_id=$3
      AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=p.account_id
        AND t.object_kind='run' AND t.object_id=p.id AND t.reason='source_deletion')`,
    [parentRunId,scope.parentExecutionOwnerId,scope.conversationId])).rows[0];
  if (!parent) throw new Error("claimed_context_parent_unavailable");
  const parentBriefRow = (await db.query<{ payload: unknown }>(
    "SELECT payload FROM research_briefs WHERE id=$1 AND account_id=$2",[parent.brief_id,scope.parentExecutionOwnerId])).rows[0];
  const parentBrief = ResearchBriefSchema.safeParse(parentBriefRow?.payload);
  if (!parentBrief.success) throw new Error("claimed_context_parent_brief_unavailable");
  if (parentBrief.data.attachmentIds.length)
    throw new Error("claimed_context_parent_source_not_public");
  const reports = await db.query<{ id: string; version: number; blocks: unknown; source_access_summary: unknown;
    redacted_at: Date | null }>(`SELECT id,version,blocks,source_access_summary,redacted_at FROM reports
    WHERE run_id=$1 AND account_id=$2 ORDER BY version DESC LIMIT 1`,[parentRunId,scope.parentExecutionOwnerId]);
  const report = reports.rows[0] ?? null;
  if (report?.redacted_at) throw new Error("claimed_context_parent_report_unavailable");
  const parsed = report ? CanonicalReportSchema.pick({ blocks:true,sourceAccessSummary:true }).safeParse({
    blocks:report.blocks,sourceAccessSummary:report.source_access_summary,
  }) : null;
  if (report && !parsed?.success) throw new Error("claimed_context_parent_report_invalid");
  let approvedPublicContextTerms: string[] = [];
  if (parsed?.success) {
    const cited = [...new Set(parsed.data.blocks.flatMap((block) => block.citationIds))];
    const valid = await db.query<{ id: string; source_id: string; canonical_locator: string; final_locator: string;
      source_type: string; access_level: string; exact_text: string }>(`SELECT p.id,s.id AS source_id,s.canonical_locator,
      v.final_locator,s.source_type,v.access_level,p.exact_text FROM authorized_run_passages p
      JOIN source_versions v ON v.id=p.source_version_id AND v.account_id=$2
      JOIN sources s ON s.id=v.source_id AND s.account_id=$2
      WHERE p.run_id=$1 AND p.account_id=$2 AND p.id::text=ANY($3::text[])
        AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$2
          AND t.object_kind='source' AND t.object_id=s.id AND t.reason='source_deletion')`,
      [parentRunId,scope.parentExecutionOwnerId,cited]);
    if (valid.rowCount !== cited.length) throw new Error("claimed_context_parent_source_unavailable");
    const summarizedIds = parsed.data.sourceAccessSummary.map((source) => source.sourceId);
    const summarized = await db.query<{ id: string; canonical_locator: string; source_type: string }>(`SELECT s.id,s.canonical_locator,s.source_type
      FROM sources s WHERE s.id::text=ANY($1::text[]) AND s.account_id=$2 AND s.run_id=$3
        AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.account_id=$2
          AND t.object_kind='source' AND t.object_id=s.id AND t.reason='source_deletion')`,
      [summarizedIds,scope.parentExecutionOwnerId,parentRunId]);
    if (new Set(summarizedIds).size !== summarizedIds.length || summarized.rowCount !== summarizedIds.length ||
        valid.rows.some((passage) => !summarizedIds.includes(passage.source_id)) ||
        parsed.data.sourceAccessSummary.some((source) => !valid.rows.some((passage) =>
          passage.source_id === source.sourceId && passage.access_level === source.accessLevel)) ||
        [...valid.rows,...summarized.rows].some((source) => !/^https?:\/\//i.test(source.canonical_locator) ||
          source.source_type === "supplied-document") ||
        valid.rows.some((source) => !/^https?:\/\//i.test(source.final_locator)))
      throw new Error("claimed_context_parent_source_not_public");
    // Only words present in both a cited answer block and its exact public
    // passage can later enter a member child's public query. Uncited prose,
    // source titles and the model's desiredOutcome never grant query terms.
    const passageById = new Map(valid.rows.map((row) => [row.id,row.exact_text]));
    const terms = new Map<string,string>();
    for (const block of parsed.data.blocks) {
      const supported = new Set(block.citationIds.flatMap((id) =>
        passageById.get(id)?.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
      for (const word of block.text.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []) {
        const normalized = word.toLowerCase();
        if (supported.has(normalized) && !terms.has(normalized) &&
            (word.length > 1 || /^[A-Z0-9]$/.test(word))) terms.set(normalized,word);
      }
    }
    approvedPublicContextTerms = [...terms.values()].slice(0,16);
  }
  const childBriefRow = (await db.query<{ payload: unknown }>(
    "SELECT payload FROM research_briefs WHERE id=$1 AND account_id=$2 FOR UPDATE",[child.brief_id,args.accountId])).rows[0];
  const childBrief = ResearchBriefSchema.safeParse(childBriefRow?.payload);
  if (!childBrief.success) throw new Error("claimed_context_child_brief_unavailable");
  const context = {
    parentQuestion: parentBrief.data.originalQuestion,
    parentConstraints: parentBrief.data.constraints.filter((constraint) => constraint.origin === "confirmed")
      .map(({ field,value }) => ({ field,value })),
    priorAnswer: parsed?.success ? parsed.data.blocks.filter((block) => block.kind !== "heading" && block.citationIds.length > 0)
      .map((block) => block.text).join("\n").slice(0,6000) : null,
    priorSourceAccess: parsed?.success ? parsed.data.sourceAccessSummary.map((source) => ({
      title:source.title.slice(0,120),accessLevel:source.accessLevel,
    })).slice(0,10) : [],
  };
  const digest = createHash("sha256").update(JSON.stringify({ parentRunId,reportId:report?.id ?? null,context })).digest("hex");
  if (childBrief.data.desiredOutcome?.startsWith(CLAIMED_CONTEXT_PREFIX)) {
    if (!childBrief.data.desiredOutcome.startsWith(`${CLAIMED_CONTEXT_PREFIX}${digest}.`))
      throw new Error("claimed_context_snapshot_changed");
  } else {
    const used = await db.query(`SELECT 1 FROM model_operation_results WHERE run_id=$1 AND account_id=$2 LIMIT 1`,
      [args.runId,args.accountId]);
    if (used.rowCount) throw new Error("claimed_context_model_already_started");
    const outcome = `${CLAIMED_CONTEXT_PREFIX}${digest}. The submitted question is a follow-up to this prior research. `+
      `Use the prior answer only to identify the subject and unresolved aspects; it is not evidence or a citation. `+
      `Independently research and cite fresh member-owned sources for every factual child claim. `+
      `Prior context: ${JSON.stringify(context)}. Child objective: ${childBrief.data.desiredOutcome ?? childBrief.data.originalQuestion}`;
    await db.query("UPDATE research_briefs SET payload=$2 WHERE id=$1 AND account_id=$3",
      [child.brief_id,JSON.stringify({ ...childBrief.data,desiredOutcome:outcome }),args.accountId]);
  }
  return { parentRunId,parentOwnerId:scope.parentExecutionOwnerId,parentReportId:report?.id ?? null,
    approvedPublicContextTerms };
}
