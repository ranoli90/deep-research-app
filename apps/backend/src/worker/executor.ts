import { EvidenceSelectionProofError } from "../modules/evidence-selections.js";
import { processRequestedVerification } from "./requested-verification.js";
import type pg from "pg";
import type { AppConfig } from "../platform/config.js";
import { settleRun } from "../modules/billing.js";
import { getRun, emitEvent, markTerminal } from "../modules/runs.js";
import { processStructuredResearch } from "./structured-research.js";
import { executeLeasedRun, prepareRunStep } from "./run-lifecycle.js";
import type { ProcessOptions } from "./execution-options.js";

/** Production executor: no fixture or legacy controller fallback. */
export async function processRun(pool:pg.Pool,config:AppConfig,runId:string,opts:ProcessOptions={}) {
  const peek=await getRun(pool,runId);
  if(!peek || peek.route_mode!=="controlled-research")return;
  await executeLeasedRun(pool,config,runId,opts,async(fence,session)=>{
    const run=await prepareRunStep(pool,runId,fence,session);
    if(!run)return;
    if(!config.liveRouteEnabled || !config.structuredModelEnabled) {
      await session.write(async(db)=>{
        await emitEvent(db,{runId,accountId:run.account_id,type:"research_unresolved",phase:run.phase,
          summary:"Research processing is disabled. No fallback research was performed.",payload:{reason:"structured_route_disabled"}});
        await markTerminal(db,runId,"failed");await settleRun(db,run.account_id,runId,run.spent_micro);
      });
      return;
    }
    const verification=(await pool.query("SELECT verification_required_revision IS NOT NULL OR EXISTS(SELECT 1 FROM requested_verifications WHERE run_id=r.id) AS required FROM runs r WHERE id=$1",[runId])).rows[0]?.required;
    try {
    if(verification)return await processRequestedVerification(pool,config,session,{runId,accountId:run.account_id,briefRevision:run.brief_revision,fence});
    await processStructuredResearch(pool,config,session,{runId,accountId:run.account_id,briefRevision:run.brief_revision,fence},opts);
    } catch(error) {
      if(!(error instanceof EvidenceSelectionProofError))throw error;
      await session.write(async db=>{
        await emitEvent(db,{runId,accountId:run.account_id,type:"research_unresolved",phase:"researching",summary:"The saved evidence selection could not be restored. No research conclusion was published.",payload:{reason:error.message}});
        const current=await getRun(db,runId);await markTerminal(db,runId,"failed");await settleRun(db,run.account_id,runId,current!.spent_micro);
      });
    }
  });
}
