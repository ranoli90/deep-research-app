import { persistScopeComparison,type ComparisonArgs } from "../modules/scope-comparisons.js";
import type { FencedSession } from "./fenced-session.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
/** Execute substantive scope comparison with exact revision/evidence bindings; no provider call. */
export async function executeScopeComparison(session:FencedSession,args:ComparisonArgs) {
 return session.write(db=>persistScopeComparison(db,args,TASK_MODEL_VERSIONS));
}
