import {runModelVersions} from "../modules/run-model-policy.js";
import { persistEvidenceCalculation,type CalculationArgs } from "../modules/evidence-calculations.js";
import type { FencedSession } from "./fenced-session.js";
/** No network/model call; each input is revalidated under the run's current lease and evidence basis. */
export function executeEvidenceCalculation(session:FencedSession,args:CalculationArgs) {
 return session.write(async db=>persistEvidenceCalculation(db,args,await runModelVersions(db,args.runId)));
}
