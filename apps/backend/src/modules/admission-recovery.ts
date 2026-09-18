import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { withTx } from "../platform/db.js";
import { findRunByIdempotency } from "./runs.js";

/** Exact key bytes match existing admission identity; no private question is retained. */
export const admissionKeyHash = (key:string) => createHash("sha256").update(key).digest("hex");

/** Resolve-or-withdraw is atomic with admission. It never schedules or cancels a run. */
export async function resolveAdmission(pool:pg.Pool,accountId:string,key:string) {
  if (!z.string().uuid().safeParse(key).success) throw new Error("invalid_admission_key");
  return withTx(pool,async db=>{
    const account=await db.query("SELECT id FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[accountId]);
    if(!account.rows[0])return null;
    const run=await findRunByIdempotency(db,accountId,key);
    if(run)return {status:"accepted" as const,run:{runId:run.id,lifecycle:run.lifecycle,phase:run.phase,labeledDemo:run.route_mode==="fixture"}};
    await db.query("INSERT INTO admission_withdrawals(account_id,key_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",[accountId,admissionKeyHash(key)]);
    return {status:"withdrawn" as const};
  });
}
