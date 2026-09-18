/** Explicit local probe: actual Fastify auth/settings/upload/admission + mobile helper, no worker/model calls. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const repo=process.env.PREFLIGHT_REPO;
if(!repo||!process.env.TEST_DATABASE_URL?.endsWith("/deep_research_lease_clock_v6"))throw Error("isolated_probe_environment_required");
const load=(p:string)=>import(pathToFileURL(`${repo}/${p}`).href);
const [{createPool,migrate,withTx},{loadConfig},{buildApp},{createQueue},{createDevSession,grantConsent,deleteAccount},{prepareAdmission,submitAdmission}]=await Promise.all([
 load("apps/backend/src/platform/db.ts"),load("apps/backend/src/platform/config.ts"),load("apps/backend/src/api/app.ts"),load("apps/backend/src/adapters/queue.ts"),load("apps/backend/src/modules/access.ts"),load("apps/mobile/src/admission-retry.ts")]);
const db=process.env.TEST_DATABASE_URL,pool=createPool(db);let boss:any;const apps:any[]=[],accounts:string[]=[];
const digest=async(bytes:Uint8Array)=>new Uint8Array(createHash("sha256").update(bytes).digest());
const file={filename:"synthetic-preflight.txt",mime:"text/plain",text:"Synthetic preflight document."};
const results:any[]=[];
try{
 await migrate(pool);boss=await createQueue(db);
 for(const enabled of [false,true]){
  const app=await buildApp({pool,boss,config:loadConfig({DATABASE_URL:db,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:String(enabled),DEV_ALLOW_FIXTURE_ROUTE:String(enabled),OPENROUTER_API_KEY:"nonbillable-local-preflight",LIVE_SPEND_CAP_MICRO:"1000000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000000"})});apps.push(app);
  const owner=await withTx(pool,async(db:any)=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s;});accounts.push(owner.accountId);
  const headers={authorization:`Bearer ${owner.token}`};
  assert.equal((await app.inject({method:"GET",url:"/v1/settings"})).statusCode,401);
  const session=await app.inject({method:"GET",url:"/v1/session",headers});assert.equal(session.statusCode,200);assert.deepEqual(Object.keys(session.json()).sort(),["accountId","authMode"]);
  const settings=await app.inject({method:"GET",url:"/v1/settings",headers});assert.equal(settings.statusCode,200);assert.equal(settings.json().liveRouteEnabled,enabled);assert.equal(settings.json().fixtureRouteAllowed,enabled);
  for(const mode of ["controlled-research","fixture"]){
   const draft=await prepareAdmission("Explain this synthetic document",mode,[file],()=>crypto.randomUUID(),digest);let saves=0,uploads=0,admissions=0,checks=0;
   const request=submitAdmission(draft,[file],{digest,current:()=>true,progress:()=>{},preflight:async()=>{checks++;const response=await app.inject({method:"GET",url:"/v1/settings",headers});assert.equal(response.statusCode,200);return response.json();},save:async()=>{saves++;},upload:async(f:any,key:string)=>{uploads++;const response=await app.inject({method:"POST",url:"/v1/attachments",headers:{...headers,"idempotency-key":key},payload:{filename:f.filename,mime:f.mime,text:f.text}});assert.equal(response.statusCode,200);return response.json();},admit:async(d:any,ids:string[])=>{admissions++;const response=await app.inject({method:"POST",url:"/v1/runs",headers:{...headers,"idempotency-key":d.key},payload:{question:d.question,routeMode:d.routeMode,attachmentIds:ids}});assert.equal(response.statusCode,200);return response.json();}});
   if(enabled){const accepted=await request;assert.equal(accepted.lifecycle,"queued");assert.equal(uploads,1);assert.equal(admissions,1);assert.equal(saves,2);
    const disabled=apps[0];const resolution=await disabled.inject({method:"POST",url:"/v1/run-requests/resolve",headers,payload:{idempotencyKey:draft.key}});assert.equal(resolution.statusCode,200);assert.equal(resolution.json().status,"accepted");assert.equal(resolution.json().run.runId,accepted.runId);
   }else{await assert.rejects(request,/mode is disabled/);assert.equal(saves,0);assert.equal(uploads,0);assert.equal(admissions,0);}
   assert.equal(checks,1);results.push({enabled,mode,checks,saves,uploads,admissions});
  }
  const financial=await pool.query("SELECT count(*)::int AS n FROM provider_intents i JOIN runs r ON r.id=i.run_id WHERE r.account_id=$1",[owner.accountId]);assert.equal(financial.rows[0].n,0);
 }
 console.log(JSON.stringify({evidenceClass:"actual local Fastify auth/settings/upload/admission and real PostgreSQL plus mobile helper; no worker/providers",checks:results,providerIntents:0,sessionFlagsAbsent:true,settingsFlagsBoolean:true,unauthenticatedSettingsRejected:true,acceptedRecoveryWithDisabledFlags:true},null,2));
}finally{for(const account of accounts)await deleteAccount(pool,account);for(const app of apps)await app.close();if(boss)await boss.stop({graceful:false,timeout:2000});await pool.end();}
