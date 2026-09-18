import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import type { FencedSession } from "./fenced-session.js";
import type { SupportArgs } from "../modules/scoped-support.js";
import { assembleCalculatedDraft } from "../modules/calculated-draft.js";
import { persistCalculatedCoverage } from "../modules/calculated-coverage.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
import { performModelOperation } from "./model-gateway.js";
export async function executeCalculatedCoverage(pool:pg.Pool,config:AppConfig,session:FencedSession,args:SupportArgs&{supportIntentId:string;fence:number}) {
 const basis=await session.write(db=>assembleCalculatedDraft(db,args,TASK_MODEL_VERSIONS));
 const result=await performModelOperation(pool,config,session,{...args,...basis,operation:"review_calculated_coverage"});
 if(result.kind!=="result")return result;
 if(result.result.status!=="succeeded")return {kind:"blocked" as const,reason:`calculated_coverage_${result.result.status}`};
 const {coverage}=await session.write(db=>persistCalculatedCoverage(db,{...args,modelIntentId:result.intentId},TASK_MODEL_VERSIONS));
 return {kind:"coverage" as const,intentId:result.intentId,coverage};
}
