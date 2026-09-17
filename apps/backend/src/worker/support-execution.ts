import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { loadSupportContext,persistScopedSupport,type SupportArgs } from "../modules/scoped-support.js";
import type { FencedSession } from "./fenced-session.js";
import { TASK_MODEL_VERSIONS } from "./research-task.js";
import { performModelOperation } from "./model-gateway.js";

/** Executes an evidence comparison, persists its typed result; no progress event substitutes for it. */
export async function executeAssertionSupport(pool:pg.Pool,config:AppConfig,session:FencedSession,args:SupportArgs & {fence:number}) {
  const basis=await session.write((db)=>loadSupportContext(db,args,TASK_MODEL_VERSIONS));
  const result=await performModelOperation(pool,config,session,{...args,...basis,operation:"assess_support"});
  if (result.kind!=="result") return result;
  if (result.result.status!=="succeeded") return {kind:"blocked" as const,reason:`support_${result.result.status}`};
  const checks=await session.write((db)=>persistScopedSupport(db,{...args,...basis,modelIntentId:result.intentId},TASK_MODEL_VERSIONS));
  return {kind:"support" as const,intentId:result.intentId,reused:result.reused,checks};
}
