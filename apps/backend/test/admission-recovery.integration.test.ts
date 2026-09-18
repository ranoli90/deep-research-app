import { afterAll,afterEach,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { CreateRunRequestSchema } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createDevSession,deleteAccount,grantConsent,revokeConsent } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { resolveAdmission } from "../src/modules/admission-recovery.js";

let pool:pg.Pool,boss:PgBoss,app:FastifyInstance;
const accounts:string[]=[];
const url=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development"});
const input=CreateRunRequestSchema.parse({question:"Compare synthetic restoration evidence.",routeMode:"controlled-research"});
beforeAll(async()=>{pool=createPool(url);await migrate(pool);boss=await createQueue(url);app=await buildApp({pool,boss,config});});
afterEach(async()=>{for(const id of accounts.splice(0))await withTx(pool,async db=>{
 await deleteAccount(db,id);
 for(const table of ["publication_attempts","reports","provider_intents","run_actions","run_leases","reservations","claims"])
  await db.query(`DELETE FROM ${table} WHERE run_id IN(SELECT id FROM runs WHERE account_id=$1)`,[id]);
 await db.query("DELETE FROM runs WHERE account_id=$1",[id]);
 for(const table of ["research_briefs","conversations","allowance_accounts","sessions","consent_records","tombstones"])
  await db.query(`DELETE FROM ${table} WHERE account_id=$1`,[id]);
 await db.query("DELETE FROM accounts WHERE id=$1",[id]);
});});
afterAll(async()=>{await app.close();await boss.stop({graceful:false,timeout:2000});await pool.end();});
async function account(){const s=await withTx(pool,async db=>{const session=await createDevSession(db);await grantConsent(db,session.accountId);return session;});accounts.push(s.accountId);return s;}
function resolve(token:string,key:string){return app.inject({method:"POST",url:"/v1/run-requests/resolve",headers:{authorization:`Bearer ${token}`},payload:{idempotencyKey:key}});}

it("W07 resolves an admitted request even when route and consent are disabled without dispatch or new spend",async()=>{
 const owner=await account(),key=crypto.randomUUID(),created=await admitRun(pool,owner.accountId,key,input);
 await revokeConsent(pool,owner.accountId);
 const before=(await pool.query("SELECT state FROM run_dispatch_outbox WHERE run_id=$1",[created.runId])).rows;
 const response=await resolve(owner.token,key);expect(response.statusCode).toBe(200);
 expect(response.json()).toMatchObject({status:"accepted",run:{runId:created.runId,lifecycle:"queued",labeledDemo:false}});
 expect((await pool.query("SELECT state FROM run_dispatch_outbox WHERE run_id=$1",[created.runId])).rows).toEqual(before);
 expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1",[created.runId])).rowCount).toBe(0);
 expect((await pool.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1",[owner.accountId])).rowCount).toBe(0);
});

it("W07 withdrawal is durable and rejects every delayed admission for that exact key",async()=>{
 const owner=await account(),key=crypto.randomUUID();
 expect((await resolve(owner.token,key)).json()).toEqual({status:"withdrawn"});
 expect((await resolve(owner.token,key)).json()).toEqual({status:"withdrawn"});
 await expect(admitRun(pool,owner.accountId,key,input)).rejects.toMatchObject({code:"idempotency_withdrawn"});
 await expect(admitRun(pool,owner.accountId,key,{...input,question:"Changed question"})).rejects.toMatchObject({code:"idempotency_withdrawn"});
 expect((await pool.query("SELECT 1 FROM runs WHERE account_id=$1",[owner.accountId])).rowCount).toBe(0);
 const rows=(await pool.query("SELECT key_hash FROM admission_withdrawals WHERE account_id=$1",[owner.accountId])).rows;
 expect(rows).toHaveLength(1);expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
 const next=await admitRun(pool,owner.accountId,crypto.randomUUID(),input);expect(next.reused).toBe(false);
});

it("W03 recovery keys are account-bound and require an active authenticated account",async()=>{
 const owner=await account(),other=await account(),key=crypto.randomUUID(),created=await admitRun(pool,owner.accountId,key,input);
 expect((await resolve(other.token,key)).json()).toEqual({status:"withdrawn"});
 expect((await resolve(owner.token,key)).json()).toMatchObject({status:"accepted",run:{runId:created.runId}});
 expect((await app.inject({method:"POST",url:"/v1/run-requests/resolve",payload:{idempotencyKey:key}})).statusCode).toBe(401);
 expect((await resolve(owner.token,"bad-key")).statusCode).toBe(400);
 await deleteAccount(pool,owner.accountId);expect((await resolve(owner.token,key)).statusCode).toBe(401);
 expect(await resolveAdmission(pool,owner.accountId,key)).toBeNull();
});

it("W02 admission and withdrawal races serialize to exactly one local outcome",async()=>{
 for(let i=0;i<4;i++){
  const owner=await account(),key=crypto.randomUUID(),lock=await pool.connect();
  let admitted:ReturnType<typeof admitRun>,resolved:ReturnType<typeof resolveAdmission>;
  try{
   await lock.query("BEGIN");await lock.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[owner.accountId]);
   // Queue both operations behind one real database lock, alternating launch order.
   if(i%2){resolved=resolveAdmission(pool,owner.accountId,key);admitted=admitRun(pool,owner.accountId,key,input);}
   else{admitted=admitRun(pool,owner.accountId,key,input);resolved=resolveAdmission(pool,owner.accountId,key);}
   const admissionOutcome=admitted.then(value=>({value,error:null}),error=>({value:null,error}));
   await lock.query("COMMIT");
   const [a,r]=await Promise.all([admissionOutcome,resolved]);
   if(r?.status==="accepted"){
    expect(a.error).toBeNull();expect(r.run.runId).toBe(a.value?.runId);
    expect((await pool.query("SELECT 1 FROM admission_withdrawals WHERE account_id=$1",[owner.accountId])).rowCount).toBe(0);
   }else{
    expect(r).toEqual({status:"withdrawn"});expect(a.error).toMatchObject({code:"idempotency_withdrawn"});
    expect((await pool.query("SELECT 1 FROM runs WHERE account_id=$1",[owner.accountId])).rowCount).toBe(0);
   }
  }finally{await lock.query("ROLLBACK");lock.release();}
 }
});
