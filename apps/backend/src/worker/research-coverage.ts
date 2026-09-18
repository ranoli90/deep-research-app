import {runModelVersions} from "../modules/run-model-policy.js";
import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { loadCoverageContext,persistResearchCoverage,type CoverageArgs } from "../modules/research-coverage.js";
import type { FencedSession } from "./fenced-session.js";
import { performModelOperation } from "./model-gateway.js";

export async function executeCoverageReview(pool:pg.Pool,config:AppConfig,session:FencedSession,args:CoverageArgs&{fence:number}) {
  const basis=await session.write(async (db)=>loadCoverageContext(db,args,await runModelVersions(db,args.runId)));
  const result=await performModelOperation(pool,config,session,{...args,...basis,operation:"review_coverage"});
  if(result.kind!=="result")return result;
  if(result.result.status!=="succeeded")return {kind:"blocked" as const,reason:`coverage_${result.result.status}`};
  const coverage=await session.write(async (db)=>persistResearchCoverage(db,{...args,modelIntentId:result.intentId},await runModelVersions(db,args.runId)));
  return {kind:"coverage" as const,intentId:result.intentId,reused:result.reused,coverage};
}
