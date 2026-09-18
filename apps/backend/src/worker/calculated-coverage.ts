import {runModelVersions} from "../modules/run-model-policy.js";
import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import type { FencedSession } from "./fenced-session.js";
import type { SupportArgs } from "../modules/scoped-support.js";
import { assembleCalculatedDraft } from "../modules/calculated-draft.js";
import { persistCalculatedCoverage } from "../modules/calculated-coverage.js";
import { performModelOperation } from "./model-gateway.js";
export async function executeCalculatedCoverage(pool:pg.Pool,config:AppConfig,session:FencedSession,args:SupportArgs&{supportIntentId:string;fence:number}) {
 const basis=await session.write(async db=>assembleCalculatedDraft(db,args,await runModelVersions(db,args.runId)));
 const result=await performModelOperation(pool,config,session,{...args,...basis,operation:"review_calculated_coverage"});
 if(result.kind!=="result")return result;
 if(result.result.status!=="succeeded")return {kind:"blocked" as const,reason:`calculated_coverage_${result.result.status}`};
 const {coverage}=await session.write(async db=>persistCalculatedCoverage(db,{...args,modelIntentId:result.intentId},await runModelVersions(db,args.runId)));
 return {kind:"coverage" as const,intentId:result.intentId,coverage};
}
