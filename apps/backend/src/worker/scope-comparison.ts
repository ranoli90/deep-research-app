import {runModelVersions} from "../modules/run-model-policy.js";
import { persistScopeComparison,type ComparisonArgs } from "../modules/scope-comparisons.js";
import type { FencedSession } from "./fenced-session.js";
/** Execute substantive scope comparison with exact revision/evidence bindings; no provider call. */
export async function executeScopeComparison(session:FencedSession,args:ComparisonArgs) {
 return session.write(async db=>persistScopeComparison(db,args,await runModelVersions(db,args.runId)));
}
