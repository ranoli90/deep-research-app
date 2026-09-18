import {runModelVersions} from "../modules/run-model-policy.js";
import { loadAssertionEvidence } from "../modules/assertion-evidence.js";
import type pg from "pg";
import type { ResearchModelOutput } from "@deep/contracts";
import type { AppConfig } from "../platform/config.js";
import type { FencedSession } from "./fenced-session.js";
import { performModelOperation } from "./model-gateway.js";

type Outcome = { kind:"extraction"; intentId:string; taskId:string; evidenceRevision:number; reused:boolean;
  output:ResearchModelOutput<"extract_assertions"> }
  | { kind:"pending"; intentId:string } | { kind:"blocked"; reason:string };

/** Executes extraction on explicitly selected whole passages. No fixture catalog or model-owned authority. */
export async function extractEvidenceAssertions(pool:pg.Pool, config:AppConfig, session:FencedSession, args:{
  runId:string; accountId:string; fence:number; briefRevision:number; taskId:string; passageIds:string[]; selectionId?:string;
}):Promise<Outcome> {
  const basis = await session.write(async (db) => loadAssertionEvidence(db,args,await runModelVersions(db,args.runId)));
  if (basis.kind === "blocked") return { kind:"blocked",reason:basis.blocked };
  const result = await performModelOperation(pool,config,session,{ ...args,...basis,operation:"extract_assertions" });
  if (result.kind !== "result") return result;
  if (result.result.status !== "succeeded") return { kind:"blocked",reason:`extraction_${result.result.status}` };
  return { kind:"extraction",intentId:result.intentId,taskId:args.taskId,evidenceRevision:basis.evidenceRevision,reused:result.reused,output:result.result.output };
}
