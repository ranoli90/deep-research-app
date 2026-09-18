import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { loadCoverageContext,persistResearchCoverage,type CoverageArgs } from "../modules/research-coverage.js";
import type { FencedSession } from "./fenced-session.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
import { performModelOperation } from "./model-gateway.js";

export async function executeCoverageReview(pool:pg.Pool,config:AppConfig,session:FencedSession,args:CoverageArgs&{fence:number}) {
  const basis=await session.write((db)=>loadCoverageContext(db,args,TASK_MODEL_VERSIONS));
  const result=await performModelOperation(pool,config,session,{...args,...basis,operation:"review_coverage"});
  if(result.kind!=="result")return result;
  if(result.result.status!=="succeeded")return {kind:"blocked" as const,reason:`coverage_${result.result.status}`};
  const coverage=await session.write((db)=>persistResearchCoverage(db,{...args,modelIntentId:result.intentId},TASK_MODEL_VERSIONS));
  return {kind:"coverage" as const,intentId:result.intentId,reused:result.reused,coverage};
}
