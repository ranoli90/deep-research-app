import { storeAttachment } from "../src/modules/attachments.js";
/** Actual isolated PDF parser + real PostgreSQL/production worker; deliberately fabricated model replies. */
import { createHash } from "node:crypto";
import { afterAll,afterEach,beforeAll,expect,it,vi } from "vitest";
import type pg from "pg";
import { CreateRunRequestSchema,CorrectionRequestSchema } from "@deep/contracts";
import { createPool,migrate,withTx } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { createDevSession,grantConsent,deleteAccount } from "../src/modules/access.js";
import { admitRun } from "../src/modules/run-admission.js";
import { admitResearchCorrection } from "../src/modules/research-corrections.js";
import { insertSource,insertVersionAndPassage } from "../src/modules/evidence.js";
import { getLatestReportForRun } from "../src/modules/reports.js";
import { getBrief,getRun } from "../src/modules/runs.js";
import { processRun } from "../src/worker/executor.js";
import * as extraction from "../src/adapters/extraction/offline.js";
import { matchedDocumentModel } from "./helpers/matched-model.js";
const url=process.env.TEST_DATABASE_URL!;let pool:pg.Pool;const accounts:string[]=[],originalFetch=globalThis.fetch;
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",STRUCTURED_DISCOVERY_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-append",LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID()});
function pdf(text:string){const stream=`BT /F1 12 Tf 40 740 Td (${text}) Tj ET`;const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let body="%PDF-1.4\n",offsets:number[]=[];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(body);body+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(o=>`${String(o).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(body);}
beforeAll(async()=>{pool=createPool(url);await migrate(pool);});
afterEach(async()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();for(const id of accounts.splice(0))await deleteAccount(pool,id);});
afterAll(async()=>{await pool.end();});
it("W04/W06 new private PDF is parsed once, old public/document evidence remains exact, and contradiction vetoes stale positive answer without public search",async()=>{
 const owner=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s;});accounts.push(owner.accountId);
 const oldText="Ardent supports offline recording only on firmware 4.2.",newText="Ardent does not support offline recording on firmware 4.2.";
 const oldBytes=pdf(oldText),newBytes=pdf(newText),oldId=(await storeAttachment(pool,{accountId:owner.accountId,filename:"old.pdf",mime:"application/pdf",bytes:oldBytes}))!,newId=(await storeAttachment(pool,{accountId:owner.accountId,filename:"PRIVATE_APPEND_CANARY.pdf",mime:"application/pdf",bytes:newBytes}))!;
 const parent=await admitRun(pool,owner.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Which firmware supports Ardent offline recording?",routeMode:"controlled-research",attachmentIds:[oldId]}));
 const source=await insertSource(pool,{accountId:owner.accountId,runId:parent.runId,locator:"https://example.org/prior-public",title:"Public handling note",publisher:"Synthetic",originCluster:"synthetic"});await insertVersionAndPassage(pool,{accountId:owner.accountId,runId:parent.runId,sourceId:source,locator:"https://example.org/prior-public",text:"General handling guidance only.",accessLevel:"partial-text"});
 const model=matchedDocumentModel();let searchCalls=0;globalThis.fetch=async(input,init)=>{const body=JSON.parse(String(init?.body));if(body.plugins?.length)searchCalls++;expect(body.plugins).toEqual([]);return model.transport(input,init);};const parser=vi.spyOn(extraction,"extractOffline");
 await processRun(pool,config,parent.runId);const report=await getLatestReportForRun(pool,parent.runId,owner.accountId);expect(report).toBeTruthy();expect(parser).toHaveBeenCalledTimes(1);
 const basis=(await pool.query("SELECT id,source_version_id,content_hash FROM authorized_run_passages WHERE run_id=$1 ORDER BY id",[parent.runId])).rows;
 const input=CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"Add document; PRIVATE_NOTE_NOT_A_SEARCH",patch:{kind:"append_attachments",attachmentIds:[newId],evidencePolicy:"reuse_snapshot"}}),child=await admitResearchCorrection(pool,owner.accountId,parent.runId,input);
 await processRun(pool,config,child.runId);expect(parser).toHaveBeenCalledTimes(2);expect(createHash("sha256").update(parser.mock.calls[1]![0]).digest("hex")).toBe(createHash("sha256").update(newBytes).digest("hex"));
 expect((await getBrief(pool,(await getRun(pool,child.runId))!.brief_id)).originalQuestion).toBe("Which firmware supports Ardent offline recording?");
 const inherited=(await pool.query("SELECT id,source_version_id,content_hash FROM authorized_run_passages WHERE run_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",[child.runId,basis.map(p=>p.id)])).rows;expect(inherited).toEqual(basis);
 const fresh=(await pool.query("SELECT exact_text,locator,extraction_method FROM passages WHERE run_id=$1",[child.runId])).rows;expect(fresh).toHaveLength(1);expect(fresh[0].exact_text).toBe(newText);expect(fresh[0].locator.block).toBe("page:1/block:0");expect(fresh[0].extraction_method).toBe("docling-parse-7.20.0/geometry-v1");
 expect((await pool.query("SELECT decision FROM scoped_support_results WHERE run_id=$1",[child.runId])).rows).toEqual([{decision:"disputed"}]);expect(await getLatestReportForRun(pool,child.runId,owner.accountId)).toBeNull();expect((await getLatestReportForRun(pool,parent.runId,owner.accountId))?.id).toBe(report!.id);expect(searchCalls).toBe(0);
});
it.each([false,true])("W06 unreadable appended PDF cannot silently republish old answer (missing change-set=%s)",async missing=>{
 const owner=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s;});accounts.push(owner.accountId);
 const oldId=(await storeAttachment(pool,{accountId:owner.accountId,filename:"readable.pdf",mime:"application/pdf",bytes:pdf("Ardent supports offline recording only on firmware 4.2.")}))!,newId=(await storeAttachment(pool,{accountId:owner.accountId,filename:"empty.pdf",mime:"application/pdf",bytes:pdf("")}))!;
 const parent=await admitRun(pool,owner.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:"Which firmware supports Ardent offline recording?",routeMode:"controlled-research",attachmentIds:[oldId]}));const model=matchedDocumentModel();globalThis.fetch=model.transport;await processRun(pool,config,parent.runId);expect(await getLatestReportForRun(pool,parent.runId,owner.accountId)).toBeTruthy();
 const child=await admitResearchCorrection(pool,owner.accountId,parent.runId,CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:"Check empty new document",patch:{kind:"append_attachments",attachmentIds:[newId],evidencePolicy:"reuse_snapshot"}}));if(missing)await pool.query("DELETE FROM research_change_sets WHERE run_id=$1",[child.runId]);
 await processRun(pool,config,child.runId);expect(await getLatestReportForRun(pool,child.runId,owner.accountId)).toBeNull();expect((await getRun(pool,child.runId))?.terminal_outcome).toBe("failed");expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[child.runId])).rows[0].payload.reason).toBe("appended_document_unavailable");expect((await pool.query("SELECT operation FROM model_operation_results WHERE run_id=$1",[child.runId])).rows).toEqual([{operation:"brief"}]);
});
