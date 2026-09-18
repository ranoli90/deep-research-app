import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { createHash } from "node:crypto";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { createDevSession, deleteAccount, grantConsent } from "../src/modules/access.js";
import { insertBrief, insertConversation, insertRun, claimLease, renewLease, markTerminal } from "../src/modules/runs.js";
import { reserveAllowance } from "../src/modules/billing.js";
import { reserveLiveAttempt } from "../src/modules/live-spend.js";
import { fencedSession } from "../src/worker/fenced-session.js";
import { loadConfig } from "../src/platform/config.js";
let pool: pg.Pool;
beforeAll(async () => { pool=createPool(process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test");await migrate(pool); });
afterAll(async()=>{await pool.end();});
async function setup(){
 const accountId=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s.accountId;});
 const runId=crypto.randomUUID(),owner=crypto.randomUUID(),key=`nonbillable-clock-${crypto.randomUUID()}`,scope=crypto.randomUUID();
 const config=loadConfig({DATABASE_URL:"postgres://localhost/test",OPENROUTER_API_KEY:key,LIVE_BUDGET_SCOPE:scope,LIVE_SPEND_CAP_MICRO:"1000000",LIVE_KEY_SPEND_CAP_MICRO:"1000000000"});
 await withTx(pool,async db=>{
  const conversationId=await insertConversation(db,accountId,"Lease expiry control"),briefId=crypto.randomUUID();
  await insertBrief(db,{id:briefId,conversationId,originalQuestion:"Lease expiry control",language:"en",attachmentIds:[],sourceRestrictions:[],nonGoals:[],constraints:[],assumptions:[],budgetPolicyId:"default",consentPolicyVersion:CONSENT_POLICY_VERSION,revision:1},accountId);
  await insertRun(db,{id:runId,accountId,conversationId,briefId,routeMode:"controlled-research",briefRevision:1,consentEpoch:1,idempotencyKey:crypto.randomUUID(),budgetMicro:100000});
  await reserveAllowance(db,accountId,runId,100000);
 });
 const fence=(await claimLease(pool,runId,owner,60000))!;
 // Disable renewal during this controlled short expiry without stopping/aborting the session.
 const session=fencedSession(pool,{runId,accountId,owner,fence,briefRevision:1,leaseMs:300000});
 return {accountId,runId,owner,key,scope,config,fence,session};
}
async function delayed(x:Awaited<ReturnType<typeof setup>>,lock:(db:pg.PoolClient)=>Promise<unknown>,action:()=>Promise<unknown>){
 const blocker=await pool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query("BEGIN");const pid=Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  await pool.query("UPDATE run_leases SET expires_at=clock_timestamp()+interval '1 second' WHERE run_id=$1",[x.runId]);
  await lock(blocker);
  pending=action().then(value=>({value}),error=>({error:error instanceof Error?error.message:String(error)}));
  let waiting=false;
  for(let i=0;i<100;i++){
   waiting=Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[pid])).rowCount);
   if(waiting)break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(waiting,"operation must really be waiting on our database lock").toBe(true);
  await blocker.query("SELECT pg_sleep(1.1)");
  expect((await pool.query("SELECT expires_at<clock_timestamp() AS expired FROM run_leases WHERE run_id=$1",[x.runId])).rows[0].expired).toBe(true);
  await blocker.query("COMMIT");
  return await pending;
 }finally{await blocker.query("ROLLBACK");blocker.release();if(pending)await pending;}
}
for(const mutation of ["semantic","terminal"] as const)it(`W02 rejects expired ${mutation} mutation after account lock wait`,async()=>{
 const x=await setup();try{
  const result=await delayed(x,db=>db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[x.accountId]),()=>x.session.write(async db=>{
   if(mutation==="terminal")await markTerminal(db,x.runId,"failed");
   else await db.query("UPDATE runs SET phase='writing' WHERE id=$1",[x.runId]);
  }));
  expect(result).toEqual({error:"stale_worker"});
  expect((await pool.query("SELECT lifecycle,phase FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({lifecycle:"running",phase:"preparing"});
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});
for(const boundary of ["account","legacy","key","project"] as const)it(`W02 rejects provider issuance when lease expires waiting for ${boundary} lock`,async()=>{
 const x=await setup();try{
  const keyScope=createHash("sha256").update(`openrouter:${x.key}`).digest("hex");
  const lock=boundary==="legacy"?"provider-budget-legacy":boundary==="key"?`provider-key-budget:${keyScope}`:`provider-budget:${x.scope}`;
  const result=await delayed(x,db=>boundary==="account"?db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[x.accountId]):db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[lock]),()=>reserveLiveAttempt(pool,x.config,{runId:x.runId,fence:x.fence,briefRevision:1,kind:"brief",route:"openrouter:nonbillable-clock",requestDigest:"f".repeat(64),reserveMicro:20000,logicalKey:"lease-clock"}));
  expect(result).toEqual({error:"stale_or_unauthorized_attempt"});
  expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM run_actions WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});
for(const mutation of ["semantic","terminal"] as const)it(`W02 rolls back ${mutation} mutation whose transaction callback outlives its lease`,async()=>{
 const x=await setup();try{
  await pool.query("UPDATE run_leases SET expires_at=clock_timestamp()+interval '1 second' WHERE run_id=$1",[x.runId]);
  await expect(x.session.write(async db=>{
   if(mutation==="terminal")await markTerminal(db,x.runId,"failed");
   else await db.query("UPDATE runs SET phase='writing' WHERE id=$1",[x.runId]);
   await db.query("SELECT pg_sleep(1.1)");
  })).rejects.toThrow("stale_worker");
  expect((await pool.query("SELECT lifecycle,phase FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({lifecycle:"running",phase:"preparing"});
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});
it("W02 permits current fenced writes and provider reservation",async()=>{
 const x=await setup();try{
  await x.session.write(db=>db.query("UPDATE runs SET phase='researching' WHERE id=$1",[x.runId]));
  const attempt=await reserveLiveAttempt(pool,x.config,{runId:x.runId,fence:x.fence,briefRevision:1,kind:"brief",route:"openrouter:nonbillable-clock",requestDigest:"e".repeat(64),reserveMicro:20000,logicalKey:"valid-clock"});
  expect(attempt.issue).toBe(true);
  expect((await pool.query("SELECT phase FROM runs WHERE id=$1",[x.runId])).rows[0].phase).toBe("researching");
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});

it("W02 renewal cannot revive a lease after waiting for its row lock",async()=>{
 const x=await setup();try{
  const result=await delayed(x,db=>db.query("SELECT run_id FROM run_leases WHERE run_id=$1 FOR UPDATE",[x.runId]),()=>renewLease(pool,x.runId,x.owner,x.fence,60000));
  expect(result).toEqual({value:false});
  expect((await pool.query("SELECT expires_at<clock_timestamp() AS expired FROM run_leases WHERE run_id=$1",[x.runId])).rows[0].expired).toBe(true);
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});
it("W02 a newly claimed lease starts after its run lock wait",async()=>{
 const x=await setup();try{
  const result=await delayed(x,db=>db.query("SELECT id FROM runs WHERE id=$1 FOR UPDATE",[x.runId]),()=>claimLease(pool,x.runId,"replacement-owner",1000));
  expect(result).toEqual({value:x.fence+1});
  const current=(await pool.query("SELECT owner,expires_at>clock_timestamp()+interval '500 milliseconds' AS current FROM run_leases WHERE run_id=$1",[x.runId])).rows[0];
  expect(current).toEqual({owner:"replacement-owner",current:true});
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});
it("W02 rolls back provider issuance if the intent INSERT lock wait outlives its lease",async()=>{
 const x=await setup();try{
  const result=await delayed(x,db=>db.query("LOCK TABLE provider_intents IN SHARE MODE"),()=>reserveLiveAttempt(pool,x.config,{runId:x.runId,fence:x.fence,briefRevision:1,kind:"brief",route:"openrouter:nonbillable-clock",requestDigest:"d".repeat(64),reserveMicro:20000,logicalKey:"insert-wait-clock"}));
  expect(result).toEqual({error:"stale_or_unauthorized_attempt"});
  expect((await pool.query("SELECT count(*)::int AS n FROM provider_intents WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM run_actions WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
  // The original admitted allowance remains intact; failed issuance creates no liability or refund.
  expect((await pool.query("SELECT amount_micro::text,state FROM reservations WHERE run_id=$1",[x.runId])).rows).toEqual([{amount_micro:"100000",state:"reserved"}]);
  expect((await pool.query("SELECT reserved_micro::text,settled_micro::text FROM allowance_accounts WHERE account_id=$1",[x.accountId])).rows[0]).toEqual({reserved_micro:"100000",settled_micro:"0"});
 }finally{x.session.stop();await deleteAccount(pool,x.accountId);}
});
