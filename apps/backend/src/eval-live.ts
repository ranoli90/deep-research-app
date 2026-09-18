import { parseArgs } from "node:util";
import { readFile,mkdir,open,readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type pg from "pg";
import { STRUCTURED_MODEL_POLICY,STRUCTURED_CALL_RESERVE_MICRO } from "./ports/model-policy.js";
import PgBoss from "pg-boss";
import { authorize,registeredPlan,sha256 } from "./evaluation/authorization.js";
import { runMatched,stepsFor } from "./evaluation/runner.js";
import { productionDriver } from "./evaluation/production-driver.js";
import { createPool } from "./platform/db.js";
import { loadConfig } from "./platform/config.js";

/** Operator attestation is a gate, not proof that an arbitrary file was approved by the user.
 * This command requires a separately obtained current explicit budget/scope authorization.
 * No defaults grant spending; credentials alone cannot execute anything.
 */
async function main(){
 const {values}=parseArgs({options:{execute:{type:"boolean"},"operator-confirms-user-approval":{type:"boolean"},authorization:{type:"string"},sha256:{type:"string"},"approval-id":{type:"string"},output:{type:"string"}},strict:true});
 if(!values.execute||!values["operator-confirms-user-approval"]||!values.authorization||!values.sha256||!values["approval-id"]||!values.output)throw new Error("explicit_current_approval_required");
 const raw=await readFile(values.authorization,"utf8");const grant=authorize(raw,{execute:values.execute,operatorConfirmsUserApproval:values["operator-confirms-user-approval"],approvalId:values["approval-id"],sha256:values.sha256});
 const root=fileURLToPath(new URL("../../../",import.meta.url));const base=resolve(root,"evals/matched-pipeline");
 const [protocol,freeze,tasks,sources]=await Promise.all(["model-protocol.json","FREEZE.json","tasks.json","sources.json"].map(f=>readFile(resolve(base,f),"utf8")));
 const plan=registeredPlan(grant,{protocol:protocol!,freeze:freeze!,tasks:tasks!,sources:sources!});
 const token=process.env.EVAL_SESSION_TOKEN;
 await mkdir(resolve(values.output)); // No overwrite/resume: unknown admissions cannot be resent.
 const file=await open(resolve(values.output,"receipts.jsonl"),"wx",0o600);
 const secrets=[token,process.env.OPENROUTER_API_KEY].filter((v):v is string=>!!v);
 let journalTail=Promise.resolve();
 const journal=(record:Record<string,unknown>)=>{const line=JSON.stringify(record,(_key,value)=>typeof value==="string"?secrets.reduce((text,secret)=>text.split(secret).join("[redacted]"),value):value);const write=journalTail.then(async()=>{await file.write(line+"\n");await file.sync();});journalTail=write;return write;};
 let enteredRunner=false;
 let pool:ReturnType<typeof createPool>|undefined,boss:PgBoss|undefined,lock:pg.PoolClient|undefined,driver:Awaited<ReturnType<typeof productionDriver>>|undefined;
 try{
  const pins=["apps/backend/src/adapters/model/prompts.ts","apps/backend/src/ports/model-policy.ts","packages/contracts/src/research-model.ts","packages/research-core/src/scoped-support.ts","apps/backend/extraction/extract.py","apps/backend/src/evaluation/authorization.ts","apps/backend/src/evaluation/runner.ts","apps/backend/src/evaluation/production-driver.ts","apps/backend/src/eval-live.ts"];
  async function sourceFiles(directory:string):Promise<string[]>{const entries=await readdir(resolve(root,directory),{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?sourceFiles(`${directory}/${e.name}`):Promise.resolve([`${directory}/${e.name}`])))).flat();}
  const completeSourcePaths=(await Promise.all(["apps/backend/src","apps/backend/extraction","apps/backend/migrations","packages/contracts/src","packages/research-core/src"].map(sourceFiles))).flat().sort();
  const completeSourceHashes=await Promise.all(completeSourcePaths.map(async path=>({path,sha256:sha256(await readFile(resolve(root,path)))})));
  const sourceStatus=execFileSync("git",["status","--porcelain=v1","--untracked-files=all","--","apps/backend/src","apps/backend/extraction","packages/contracts/src","packages/research-core/src"],{cwd:root,encoding:"utf8"});
  await journal({event:"environment",sourceTreeDigest:sha256(JSON.stringify(completeSourceHashes)),sourceFiles:completeSourceHashes,sourceTreeDirty:!!sourceStatus.trim(),sourceStatusHash:sha256(sourceStatus),modelPolicy:STRUCTURED_MODEL_POLICY,perCallReserveMicro:STRUCTURED_CALL_RESERVE_MICRO,operatorAttestationOnly:true,commit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),node:process.version,authorizationHash:sha256(raw),sourceHashes:await Promise.all(pins.map(async path=>({path,sha256:sha256(await readFile(resolve(root,path)))}))),providerCapCertification:"not established by this runner; application caps and receipt/unknown accounting only"});
  await journal({event:"registered_scope",steps:stepsFor(plan),unselectedTaskIds:plan.unselectedTaskIds,expectedSelectedSteps:stepsFor(plan).length});
  if(grant.sourceMode!=="live_discovery"){
   const never=async():Promise<never>=>{throw new Error("unsupported_source_mode");};enteredRunner=true;await runMatched(plan,{exposure:never,admit:never,execute:never},journal);process.exitCode=2;return;
  }
  const config=loadConfig();if(!token)throw new Error("dedicated_existing_session_required");
  await journal({event:"effective_configuration",config:{openRouterModel:config.openRouterModel,structuredModelEnabled:config.structuredModelEnabled,structuredDiscoveryEnabled:config.structuredDiscoveryEnabled,liveRetrievalEnabled:config.liveRetrievalEnabled,fixtureRouteAllowed:config.fixtureRouteAllowed,leaseMs:config.leaseMs,strategyArms:["iterative-baseline.v1","criterion-adaptive.v1"],challengeEnabled:!!config.structuredChallengeEnabled,projectCapMicro:Math.min(config.liveSpendCapMicro,grant.budgetMicro),keyCapMicro:Math.min(config.liveKeySpendCapMicro??0,grant.budgetMicro),consentPolicyVersion:config.consentPolicyVersion}});
  pool=createPool(config.databaseUrl);lock=await pool.connect();
  if(!(await lock.query("SELECT pg_try_advisory_lock(hashtextextended('matched-evaluation-runner',0)) AS locked")).rows[0].locked)throw new Error("evaluation_runner_already_active");
  // Schema/queue provisioning is a separate authorized setup step; never migrate here.
  let queueFailed=false;
  boss=new PgBoss({connectionString:config.databaseUrl,migrate:false});boss.on("error",()=>{queueFailed=true;void journal({event:"queue_error",reason:"queue_unavailable",rawMessageOmitted:true}).catch(()=>{queueFailed=true;});});await boss.start();
  driver=await productionDriver(pool,boss,config,grant,token);
  const activeDriver=driver;
  enteredRunner=true;
  const result=await runMatched(plan,{...driver,exposure:()=>{if(queueFailed)throw new Error("queue_unavailable");return activeDriver.exposure();}},journal);if(result.halted)process.exitCode=2;
 }catch{if(!enteredRunner)for(const step of stepsFor(plan))await journal({event:"unrun",stepId:step.id,reason:"preflight_unavailable"});await journal({event:"fatal",reason:"evaluation_stopped_unconfirmed_or_unavailable",semanticScores:null});process.exitCode=2;}
 finally{
  const cleanup=await Promise.allSettled([driver?.close(),boss?.stop({graceful:false,timeout:2000})]);
  if(lock){try{await lock.query("SELECT pg_advisory_unlock(hashtextextended('matched-evaluation-runner',0))");}catch{process.exitCode=2;}finally{lock.release();}}
  const ended=await Promise.allSettled([pool?.end(),journalTail]);
  await file.close();if([...cleanup,...ended].some(r=>r.status==="rejected")){process.stderr.write("Evaluation cleanup or durable receipt finalization failed; inspect retained records before any retry.\n");process.exitCode=2;}
 }
}
void main().catch(()=>{process.stderr.write("eval:live blocked or stopped: explicit current approval, registered scope, existing dedicated account/database and verified budget are required. No implicit authorization or automatic retry.\n");process.exitCode=2;});
