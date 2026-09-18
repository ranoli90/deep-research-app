import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { RequestedVerificationRequestSchema } from "@deep/contracts";
export const VerificationRecoverySchema=z.object({parentRunId:z.string().uuid(),request:RequestedVerificationRequestSchema}).strict();
import { withTx } from "../platform/db.js";
import { findRunByIdempotency } from "./runs.js";

/** Exact key bytes match existing admission identity; no private question is retained. */
export const admissionKeyHash = (key:string) => createHash("sha256").update(key).digest("hex");

/** Resolve-or-withdraw is atomic with admission. It never schedules or cancels a run. */
export async function resolveAdmission(pool:pg.Pool,accountId:string,key:string,verification?:z.infer<typeof VerificationRecoverySchema>) {
  if (!z.string().uuid().safeParse(key).success) throw new Error("invalid_admission_key");
  if(verification){verification=VerificationRecoverySchema.parse(verification);if(verification.request.idempotencyKey!==key)throw Object.assign(new Error("verification_recovery_key_mismatch"),{statusCode:400});}
  return withTx(pool,async db=>{
    const account=await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[accountId]);
    if(!account.rows[0])return null;
    const run=await findRunByIdempotency(db,accountId,key);
    if(run&&verification){
      const {requestedVerificationDigest,loadVerification}=await import("./requested-verification.js");
      const digest=requestedVerificationDigest(verification.parentRunId,verification.request);
      const stored=(await db.query("SELECT request_digest FROM runs WHERE id=$1",[run.id])).rows[0];
      if(run.parent_run_id!==verification.parentRunId||stored?.request_digest!==digest)throw Object.assign(new Error("verification_recovery_conflict"),{statusCode:409});
      let saved;
      try{saved=await loadVerification(db,{runId:run.id,accountId,briefRevision:run.brief_revision});}
      catch(error){if(error instanceof Error&&(/verification_|Required/.test(error.message)||error.name==="ZodError"))throw Object.assign(new Error("verification_recovery_proof_unavailable"),{statusCode:409});throw error;}
      if(saved.request_digest!==digest||saved.parent_run_id!==verification.parentRunId)throw Object.assign(new Error("verification_recovery_conflict"),{statusCode:409});
    }
    if(run)return {status:"accepted" as const,run:{runId:run.id,lifecycle:run.lifecycle,phase:run.phase,labeledDemo:run.route_mode==="fixture"}};
    await db.query("INSERT INTO admission_withdrawals(account_id,key_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",[accountId,admissionKeyHash(key)]);
    return {status:"withdrawn" as const};
  });
}
