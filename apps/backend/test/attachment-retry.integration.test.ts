import { createHash } from "node:crypto";
import { afterAll,afterEach,beforeAll,expect,it } from "vitest";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { FastifyInstance } from "fastify";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { buildApp } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createDevSession,deleteAccount } from "../src/modules/access.js";
import { attachmentUploadReceipt,AttachmentUploadConflict,storeAttachment } from "../src/modules/attachments.js";

let pool:pg.Pool,boss:PgBoss,app:FastifyInstance;
const accounts:string[]=[];
const url=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development"});
beforeAll(async()=>{pool=createPool(url);await migrate(pool);boss=await createQueue(url);app=await buildApp({pool,boss,config});});
afterEach(async()=>{for(const id of accounts.splice(0))await withTx(pool,async db=>{
 await deleteAccount(db,id);
 for(const table of ["file_deletion_outbox","attachments","allowance_accounts","sessions","consent_records","tombstones"])
  await db.query(`DELETE FROM ${table} WHERE account_id=$1`,[id]);
 await db.query("DELETE FROM accounts WHERE id=$1",[id]);
});});
afterAll(async()=>{await app.close();await boss.stop({graceful:false,timeout:2000});await pool.end();});
async function account(){const s=await withTx(pool,createDevSession);accounts.push(s.accountId);return s;}
const payload={filename:"synthetic.txt",mime:"text/plain",bytes:Buffer.from("Synthetic retry content.")};
function upload(token:string,key?:string,change:Partial<typeof payload>={}){
 const data={...payload,...change};
 return app.inject({method:"POST",url:"/v1/attachments/bytes",headers:{authorization:`Bearer ${token}`,"content-type":"application/octet-stream",
  "x-document-mime":data.mime,"x-file-name":encodeURIComponent(data.filename),...(key===undefined?{}:{"idempotency-key":key})},payload:data.bytes});
}

it("W07 lost-response replay and concurrent retries commit one owned attachment",async()=>{
 const owner=await account(),key=crypto.randomUUID();
 const results=await Promise.all(Array.from({length:8},()=>upload(owner.token,key)));
 expect(results.map(r=>r.statusCode)).toEqual(Array(8).fill(201));
 const ids=results.map(r=>r.json().attachmentId);expect(new Set(ids).size).toBe(1);
 expect((await upload(owner.token,key.toUpperCase())).json().attachmentId).toBe(ids[0]);
 const rows=(await pool.query("SELECT raw_bytes,filename,mime,upload_key_hash FROM attachments WHERE account_id=$1",[owner.accountId])).rows;
 expect(rows).toHaveLength(1);expect(rows[0].raw_bytes).toEqual(payload.bytes);expect(rows[0].upload_key_hash).toMatch(/^[0-9a-f]{64}$/);
});

it("W07 key reuse rejects byte, name and MIME changes without mutation",async()=>{
 const owner=await account(),key=crypto.randomUUID(),first=await upload(owner.token,key);
 for(const change of [{bytes:Buffer.from("Different content.")},{filename:"other.txt"},{mime:"text/markdown"}]){
  const response=await upload(owner.token,key,change);expect(response.statusCode).toBe(409);expect(response.json().code).toBe("idempotency_conflict");
 }
 expect((await upload(owner.token,key)).json().attachmentId).toBe(first.json().attachmentId);
 expect((await pool.query("SELECT raw_bytes,filename,mime FROM attachments WHERE account_id=$1",[owner.accountId])).rows).toEqual([{raw_bytes:payload.bytes,filename:payload.filename,mime:payload.mime}]);
});

it("W03 keys are account scoped and do not expose another owner's attachment",async()=>{
 const owner=await account(),foreign=await account(),key=crypto.randomUUID();
 const a=await upload(owner.token,key),b=await upload(foreign.token,key,{bytes:Buffer.from("Different owner.")});
 expect(a.statusCode).toBe(201);expect(b.statusCode).toBe(201);expect(a.json().attachmentId).not.toBe(b.json().attachmentId);
 expect((await app.inject({method:"GET",url:`/v1/attachments/${a.json().attachmentId}`,headers:{authorization:`Bearer ${foreign.token}`}})).statusCode).toBe(404);
});

it("W07 optional keys preserve legacy uploads and JSON retries validate at the boundary",async()=>{
 const owner=await account();
 const a=await upload(owner.token),b=await upload(owner.token);expect(a.json().attachmentId).not.toBe(b.json().attachmentId);
 expect((await upload(owner.token,"invalid-key")).statusCode).toBe(400);
 const key=crypto.randomUUID(),request={method:"POST" as const,url:"/v1/attachments",headers:{authorization:`Bearer ${owner.token}`,"idempotency-key":key},payload:{filename:"note.md",mime:"text/markdown",text:"Synthetic notes."}};
 const first=await app.inject(request),replay=await app.inject(request);expect(first.statusCode).toBe(200);expect(replay.json()).toEqual(first.json());
 expect((await app.inject({...request,payload:{...request.payload,text:"Changed notes."}})).statusCode).toBe(409);
 expect((await app.inject({...request,headers:{...request.headers,"idempotency-key":"bad"}})).statusCode).toBe(400);
});

it("W03 a content tombstone keeps only opaque request identity and vetoes replay",async()=>{
 const owner=await account(),key=crypto.randomUUID(),first=await upload(owner.token,key),id=first.json().attachmentId;
 // The source-deletion suite executes the full source purge; exercise its resulting attachment tombstone here.
 await withTx(pool,async db=>{await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[owner.accountId]);
  await db.query("UPDATE attachments SET deleted_at=now(),filename='[deleted]',mime='application/octet-stream',size_bytes=0,storage_ptr='',sha256=NULL,raw_bytes=NULL,extracted_text=NULL,extraction=NULL,processing_state='deleted' WHERE id=$1",[id]);});
 expect((await upload(owner.token,key)).statusCode).toBe(409);
 expect((await pool.query("SELECT id,raw_bytes,sha256,filename FROM attachments WHERE account_id=$1",[owner.accountId])).rows).toEqual([{id,raw_bytes:null,sha256:null,filename:"[deleted]"}]);
});

it("W03 account deletion serializes with a concurrent retry under the account lock",async()=>{
 const owner=await account(),key=crypto.randomUUID();await upload(owner.token,key);
 const db=await pool.connect();
 try{
  await db.query("BEGIN");await db.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE",[owner.accountId]);
  const retry=storeAttachment(pool,{...payload,accountId:owner.accountId,idempotencyKey:key});
  await deleteAccount(db,owner.accountId);await db.query("COMMIT");
  expect(await retry).toBeNull();
 }finally{await db.query("ROLLBACK");db.release();}
 expect((await upload(owner.token,key)).statusCode).toBe(401);
 const rows=(await pool.query("SELECT raw_bytes,sha256,filename,deleted_at FROM attachments WHERE account_id=$1",[owner.accountId])).rows;
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({raw_bytes:null,sha256:null,filename:"[deleted]"});expect(rows[0].deleted_at).not.toBeNull();
});

it("W07 the module rejects malformed keys and preserves conflict identity",async()=>{
 const owner=await account(),key=crypto.randomUUID();
 await expect(storeAttachment(pool,{...payload,accountId:owner.accountId,idempotencyKey:"arbitrary private text"})).rejects.toThrow("invalid_attachment_idempotency_key");
 await storeAttachment(pool,{...payload,accountId:owner.accountId,idempotencyKey:key});
 await expect(storeAttachment(pool,{...payload,filename:"different.txt",accountId:owner.accountId,idempotencyKey:key})).rejects.toBeInstanceOf(AttachmentUploadConflict);
});


it("W07 cross-route upload retries report stored processing rather than inventing extraction",async()=>{
 const owner=await account(),key=crypto.randomUUID(),binary=await upload(owner.token,key);
 const json=await app.inject({method:"POST",url:"/v1/attachments",headers:{authorization:`Bearer ${owner.token}`,"idempotency-key":key},
  payload:{filename:payload.filename,mime:payload.mime,text:payload.bytes.toString("utf8")}});
 expect(json.statusCode).toBe(200);expect(json.json()).toEqual(binary.json());
 expect(json.json()).toMatchObject({processingState:"stored",coverage:"not-read"});
 expect((await pool.query("SELECT extracted_text,extraction FROM attachments WHERE id=$1",[binary.json().attachmentId])).rows).toEqual([{extracted_text:null,extraction:null}]);
 const otherKey=crypto.randomUUID();
 const notes=await app.inject({method:"POST",url:"/v1/attachments",headers:{authorization:`Bearer ${owner.token}`,"idempotency-key":otherKey},
  payload:{filename:payload.filename,mime:payload.mime,text:payload.bytes.toString("utf8")}});
 const replay=await upload(owner.token,otherKey);expect(replay.statusCode).toBe(201);
 expect(replay.json()).toEqual(notes.json());expect(replay.json()).toMatchObject({processingState:"extracted",coverage:"complete"});
});

it("W04/W07 replay reports partial, unavailable and complete stored parser states with digest binding",async()=>{
 const owner=await account(),key=crypto.randomUUID();
 const pdf={filename:"synthetic.pdf",mime:"application/pdf",bytes:Buffer.from("%PDF-1.4\nSYNTHETIC RECEIPT CONTROL, NOT PARSER PROOF")};
 const first=await upload(owner.token,key,pdf),id=first.json().attachmentId;
 expect(first.json()).toMatchObject({processingState:"stored",coverage:"not-read"});
 const digest=createHash("sha256").update(pdf.bytes).digest("hex");
 for(const [status,processingState,coverage] of [["partial","partially_read","partial"],["unavailable","unsupported","unavailable"],["extracted","ready","complete"]]){
  // Persist parser-result shapes deliberately; actual parser execution is in the extraction suite.
  await pool.query("UPDATE attachments SET processing_state=$2,extraction=$3 WHERE id=$1",[id,processingState,JSON.stringify({version:"docling-parse-7.20.0/geometry-v1",digest,status,warnings:[],blocks:[]})]);
  expect((await upload(owner.token,key,pdf)).json()).toEqual({attachmentId:id,processingState,coverage});
 }
 await pool.query("UPDATE attachments SET extraction=jsonb_set(extraction,'{digest}',to_jsonb($2::text)) WHERE id=$1",[id,"0".repeat(64)]);
 expect((await upload(owner.token,key,pdf)).json()).toMatchObject({processingState:"ready",coverage:"unavailable"});
 const foreign=await account();expect(await attachmentUploadReceipt(pool,foreign.accountId,id)).toBeNull();
 await deleteAccount(pool,owner.accountId);expect(await attachmentUploadReceipt(pool,owner.accountId,id)).toBeNull();
});
