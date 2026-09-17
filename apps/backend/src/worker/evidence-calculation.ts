import { persistEvidenceCalculation,type CalculationArgs } from "../modules/evidence-calculations.js";
import type { FencedSession } from "./fenced-session.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
/** No network/model call; each input is revalidated under the run's current lease and evidence basis. */
export function executeEvidenceCalculation(session:FencedSession,args:CalculationArgs) {
 return session.write(db=>persistEvidenceCalculation(db,args,TASK_MODEL_VERSIONS));
}
