import {createHash} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import type pg from "pg";
import {CreateRunRequestSchema} from "@deep/contracts";
import {createPool,migrate,withTx} from "../src/platform/db.js";
import {createDevSession,grantConsent,deleteAccount} from "../src/modules/access.js";
import {admitRun} from "../src/modules/run-admission.js";
import {insertSource,insertExtractedVersion} from "../src/modules/evidence.js";
let pool:pg.Pool;const accounts:string[]=[];
beforeAll(async()=>{pool=createPool(process.env.TEST_DATABASE_URL!);await migrate(pool);});
afterAll(async()=>{for(const id of accounts)await deleteAccount(pool,id);await pool.end();});
async function setup(){const account=await withTx(pool,async db=>{const a=await createDevSession(db);await grantConsent(db,a.accountId);return a;});accounts.push(account.accountId);const run=await admitRun(pool,account.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Synthetic artifact storage control",routeMode:"controlled-research"}));const sourceId=await insertSource(pool,{accountId:account.accountId,runId:run.runId,locator:"attachment://"+crypto.randomUUID(),title:"Synthetic",publisher:"Synthetic",originCluster:"synthetic"});return {accountId:account.accountId,runId:run.runId,sourceId};}
const receipt={requestedUrl:"attachment://synthetic",finalUrl:"attachment://synthetic",redirectChain:[],status:200,mime:"application/pdf",retrievedAt:"2026-09-18T00:00:00.000Z",outcome:"successful_body" as const};
it("W04 stores exact 8MiB uploaded artifact and preserves it through full migration replay",async()=>{
 const owner=await setup(),bytes=Buffer.alloc(8*1024*1024,0x5a),digest=createHash("sha256").update(bytes).digest("hex");
 const version=await withTx(pool,db=>insertExtractedVersion(db,{...owner,bytes,receipt}));
 for(let replay=0;replay<2;replay++)await migrate(pool);
 const stored=(await pool.query("SELECT a.body,a.digest,a.account_id,a.run_id FROM evidence_artifacts a JOIN extraction_receipts e ON e.artifact_id=a.id WHERE e.source_version_id=$1",[version])).rows[0];
 expect(Buffer.isBuffer(stored.body)).toBe(true);expect(stored.body.length).toBe(bytes.length);expect(stored.body.equals(bytes)).toBe(true);expect(stored.digest).toBe(digest);expect(stored.account_id).toBe(owner.accountId);expect(stored.run_id).toBe(owner.runId);
});
it("W04 refuses artifact above8MiB atomically and keeps source ownership boundary",async()=>{
 const owner=await setup(),foreign=await setup(),bytes=Buffer.alloc(8*1024*1024+1);
 await expect(withTx(pool,db=>insertExtractedVersion(db,{...owner,bytes,receipt}))).rejects.toMatchObject({code:"23514",constraint:"evidence_artifacts_body_check"});
 expect((await pool.query("SELECT 1 FROM evidence_artifacts WHERE run_id=$1",[owner.runId])).rowCount).toBe(0);
 await expect(withTx(pool,db=>insertExtractedVersion(db,{...owner,sourceId:foreign.sourceId,bytes:Buffer.from("owned control"),receipt}))).rejects.toThrow("source_owner_mismatch");
 expect((await pool.query("SELECT 1 FROM evidence_artifacts WHERE run_id=$1",[owner.runId])).rowCount).toBe(0);
});
