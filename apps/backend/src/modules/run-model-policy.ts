import type { Queryable } from "../platform/db.js";
import { modelPolicy,MODEL_PROMPT_VERSION } from "../ports/model-policy.js";
/** Server-owned immutable admission policy; never inferred from model output or current environment. */
export async function runModelPolicy(db:Queryable,runId:string) {
 const row=(await db.query("SELECT model_policy_id FROM runs WHERE id=$1",[runId])).rows[0];
 if(!row)throw Error("model_policy_run_unavailable");
 return modelPolicy(row.model_policy_id);
}
export async function runModelVersions(db:Queryable,runId:string) {
 return {promptVersion:MODEL_PROMPT_VERSION,policyId:(await runModelPolicy(db,runId)).id};
}
