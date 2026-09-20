import { afterAll,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { createDevSession,grantConsent,deleteAccount } from "../src/modules/access.js";
import { insertConversation,insertBrief,insertRun,emitEvent,finishCancellationIfIdle,getRun } from "../src/modules/runs.js";
import { createQueue } from "../src/adapters/queue.js";
import { loadConfig } from "../src/platform/config.js";
import { buildApp } from "../src/api/app.js";
let pool:pg.Pool,boss:PgBoss,app:FastifyInstance;
const url=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
beforeAll(async()=>{pool=createPool(url);await migrate(pool);boss=await createQueue(url);app=await buildApp({pool,boss,config:loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development"})});});
afterAll(async()=>{await app.close();await boss.stop({graceful:false,timeout:2000});await pool.end();});
async function setup(){return withTx(pool,async db=>{
 const owner=await createDevSession(db);await grantConsent(db,owner.accountId);
 const conversationId=await insertConversation(db,owner.accountId,"Cancellation atomicity"),briefId=crypto.randomUUID(),runId=crypto.randomUUID();
 await insertBrief(db,{id:briefId,conversationId,originalQuestion:"Cancellation atomicity",language:"en",attachmentIds:[],sourceRestrictions:[],nonGoals:[],constraints:[],assumptions:[],budgetPolicyId:"default",consentPolicyVersion:CONSENT_POLICY_VERSION,revision:1},owner.accountId);
 await insertRun(db,{id:runId,accountId:owner.accountId,conversationId,briefId,routeMode:"controlled-research",briefRevision:1,consentEpoch:1,idempotencyKey:crypto.randomUUID(),budgetMicro:100000});
 return {...owner,runId};
});}
function cancel(x:Awaited<ReturnType<typeof setup>>){return app.inject({method:"POST",url:`/v1/runs/${x.runId}/cancel`,headers:{authorization:`Bearer ${x.token}`}});}
async function until(check:()=>Promise<boolean>){for(let n=0;n<200;n++){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error("expected_database_barrier_not_reached");}
async function trigger(runId:string,fail=false){
 const name=`cancel_test_${crypto.randomUUID().replaceAll("-","")}`,key=crypto.randomUUID();
 // Identifiers/SQL literals below are generated UUIDs only, never request/source data.
 await withTx(pool,async db=>{
  await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.run_id::text=TG_ARGV[0] AND NEW.type='cancel_requested' THEN ${fail?"RAISE EXCEPTION 'synthetic_cancel_event_failure';":"PERFORM pg_advisory_xact_lock(hashtextextended(TG_ARGV[1],0));"} END IF; RETURN NEW; END $$`);
  await db.query(`CREATE TRIGGER ${name} BEFORE INSERT ON run_events FOR EACH ROW EXECUTE FUNCTION ${name}('${runId}','${key}')`);
 });
 return {key,cleanup:()=>withTx(pool,async db=>{await db.query(`DROP TRIGGER ${name} ON run_events`);await db.query(`DROP FUNCTION ${name}()`);})};
}
async function blocker(key:string){const db=await pool.connect();await db.query("BEGIN");await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);const pid=Number((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);return {pid,release:async()=>{await db.query("ROLLBACK");db.release();}};}
it("W02 concurrent cancellation API requests atomically preserve distinct event sequences",async()=>{
 const x=await setup(),gate=await trigger(x.runId),lock=await blocker(gate.key);let pending:Promise<unknown>|undefined,released=false;
 try{
  const first=cancel(x);pending=Promise.resolve(first);await until(async()=>Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[lock.pid])).rowCount));
  const second=cancel(x);pending=Promise.all([first,second]);
  await until(async()=>Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")).rows[0].n)>=2);
  await lock.release();released=true;
  const responses=await Promise.all([first,second]);expect(responses.map(r=>r.statusCode)).toEqual([200,200]);
  expect((await pool.query("SELECT sequence::int,type FROM run_events WHERE run_id=$1 ORDER BY sequence",[x.runId])).rows).toEqual([
    {sequence:1,type:"cancel_requested"},
    {sequence:2,type:"cancelled"},
    {sequence:3,type:"cancel_requested"},
  ]);
  expect((await pool.query("SELECT lifecycle,terminal_outcome,cancellation_epoch::int FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({
    lifecycle:"terminal",terminal_outcome:"cancelled",cancellation_epoch:2,
  });
 }finally{if(!released)await lock.release();if(pending)await pending;await gate.cleanup();await deleteAccount(pool,x.accountId);}
});
it("W02 cancellation cannot recreate events after account deletion races its event insertion",async()=>{
 const x=await setup(),gate=await trigger(x.runId),lock=await blocker(gate.key);let pending:Promise<unknown>|undefined,released=false;
 try{
  const request=cancel(x);pending=Promise.resolve(request);await until(async()=>Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[lock.pid])).rowCount));
  let deletionDone=false,deletionPid=0;
  const deletion=withTx(pool,async db=>{deletionPid=Number((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);await deleteAccount(db,x.accountId);}).then(()=>{deletionDone=true;});
  pending=Promise.all([request,deletion]);
  await until(async()=>deletionDone||(deletionPid!==0&&Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND cardinality(pg_blocking_pids(pid))>0",[deletionPid])).rowCount)));
  await lock.release();released=true;await pending;
  expect((await request).statusCode).toBe(200);
  expect((await pool.query("SELECT count(*)::int AS n FROM run_events WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
  expect((await pool.query("SELECT deleted_at IS NOT NULL AS deleted FROM accounts WHERE id=$1",[x.accountId])).rows[0].deleted).toBe(true);
 }finally{if(!released)await lock.release();if(pending)await pending;await gate.cleanup();await deleteAccount(pool,x.accountId);}
});
it("W02 event insertion failure rolls cancellation back rather than acknowledging a partial mutation",async()=>{
 const x=await setup(),gate=await trigger(x.runId,true);try{
  expect((await cancel(x)).statusCode).toBe(500);
  expect((await pool.query("SELECT lifecycle,cancellation_epoch::int FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({lifecycle:"queued",cancellation_epoch:0});
  expect((await pool.query("SELECT count(*)::int AS n FROM run_events WHERE run_id=$1",[x.runId])).rows[0].n).toBe(0);
 }finally{await gate.cleanup();await deleteAccount(pool,x.accountId);}
});

it("W02 event writers using Pool retain the sequence lock through insertion",async()=>{
 const x=await setup(),gate=await trigger(x.runId),lock=await blocker(gate.key);let pending:Promise<unknown>|undefined,released=false;
 try{
  const event={runId:x.runId,accountId:x.accountId,type:"cancel_requested",summary:"Synthetic sequence control",phase:"preparing" as const};
  const first=emitEvent(pool,event);pending=Promise.allSettled([first]);await until(async()=>Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[lock.pid])).rowCount));
  const second=emitEvent(pool,event);pending=Promise.allSettled([first,second]);
  await until(async()=>Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")).rows[0].n)>=2);
  await lock.release();released=true;
  expect((await Promise.allSettled([first,second])).map(r=>r.status)).toEqual(["fulfilled","fulfilled"]);
  expect((await pool.query("SELECT sequence::int FROM run_events WHERE run_id=$1 ORDER BY sequence",[x.runId])).rows).toEqual([{sequence:1},{sequence:2}]);
 }finally{if(!released)await lock.release();if(pending)await pending;await gate.cleanup();await deleteAccount(pool,x.accountId);}
});
it("W02 stop completes immediately when no worker lease or issued provider call remains",async()=>{
 const x=await setup();
 try{
  const response=await cancel(x);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({runId:x.runId,lifecycle:"terminal"});
  expect((await pool.query("SELECT lifecycle,terminal_outcome,cancellation_epoch::int FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({
    lifecycle:"terminal",terminal_outcome:"cancelled",cancellation_epoch:1,
  });
  expect((await pool.query("SELECT sequence::int,type FROM run_events WHERE run_id=$1 ORDER BY sequence",[x.runId])).rows).toEqual([
    {sequence:1,type:"cancel_requested"},
    {sequence:2,type:"cancelled"},
  ]);
 }finally{await deleteAccount(pool,x.accountId);}
});
it("W02 stop stays cancelling while a worker lease or issued provider call is still open",async()=>{
 const x=await setup();
 try{
  await pool.query(`INSERT INTO run_leases(run_id,fence,owner,expires_at) VALUES($1,1,'active-worker',clock_timestamp()+interval '1 hour')`,[x.runId]);
  const leased=await cancel(x);
  expect(leased.statusCode).toBe(200);
  expect(leased.json()).toMatchObject({runId:x.runId,lifecycle:"cancelling"});
  expect((await pool.query("SELECT lifecycle,terminal_outcome FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({
    lifecycle:"cancelling",terminal_outcome:null,
  });
  await pool.query("DELETE FROM run_leases WHERE run_id=$1",[x.runId]);
  await pool.query(`INSERT INTO provider_intents(id,run_id,correlation_id,route,request_digest,reserved_max_micro,state)
    VALUES($1,$2,$3,'openrouter:test','digest',1000,'issued')`,[crypto.randomUUID(),x.runId,crypto.randomUUID()]);
  const held=await cancel(x);
  expect(held.statusCode).toBe(200);
  expect(held.json()).toMatchObject({lifecycle:"cancelling"});
  expect((await pool.query("SELECT lifecycle,terminal_outcome,cancellation_epoch::int FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({
    lifecycle:"cancelling",terminal_outcome:null,cancellation_epoch:2,
  });
  const blocked=await withTx(pool,async db=>finishCancellationIfIdle(db,(await getRun(db,x.runId,{forUpdate:true}))!));
  expect(blocked.lifecycle).toBe("cancelling");
  await pool.query("UPDATE provider_intents SET state='confirmed', confirmed_micro=0 WHERE run_id=$1",[x.runId]);
  const finished=await withTx(pool,async db=>finishCancellationIfIdle(db,(await getRun(db,x.runId,{forUpdate:true}))!));
  expect(finished.lifecycle).toBe("terminal");
  expect(finished.terminal_outcome).toBe("cancelled");
 }finally{await deleteAccount(pool,x.accountId);}
});
it("W03 cancellation rejects another account and an already deleted session without mutation",async()=>{
 const x=await setup(),foreign=await setup();try{
  expect((await cancel({...x,token:foreign.token})).statusCode).toBe(404);
  expect((await pool.query("SELECT lifecycle,cancellation_epoch::int FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual({lifecycle:"queued",cancellation_epoch:0});
  await deleteAccount(pool,x.accountId);
  const before=(await pool.query("SELECT cancellation_epoch::text FROM runs WHERE id=$1",[x.runId])).rows[0];
  expect((await cancel(x)).statusCode).toBe(401);
  expect((await pool.query("SELECT cancellation_epoch::text FROM runs WHERE id=$1",[x.runId])).rows[0]).toEqual(before);
  expect((await pool.query("SELECT count(*)::int AS n FROM run_events WHERE account_id=$1",[x.accountId])).rows[0].n).toBe(0);
 }finally{await deleteAccount(pool,x.accountId);await deleteAccount(pool,foreign.accountId);}
});
