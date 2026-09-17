import * as publicTransport from "../src/platform/ssrf.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import type pg from "pg";
import { buildApp } from "../src/api/app.js";
import { createPool, migrate, withTx } from "../src/platform/db.js";
import { loadConfig, type AppConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
import { processRun } from "../src/worker/executor.js";
import { ingestAttachments } from "../src/worker/attachment-ingestion.js";
import { claimLease, getBrief, getRun } from "../src/modules/runs.js";
import { fencedSession } from "../src/worker/fenced-session.js";
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();});
let app: FastifyInstance, pool: pg.Pool, boss: PgBoss, config: AppConfig;
beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
  pool = createPool(databaseUrl); await migrate(pool); boss = await createQueue(databaseUrl);
  config = loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, APP_AUTH_MODE: "development", DEV_ALLOW_FIXTURE_ROUTE: "true", WRITING_CANCEL_WINDOW_MS: "1", LIVE_ROUTE_ENABLED:"true", STRUCTURED_MODEL_ENABLED:"true", OPENROUTER_API_KEY:"nonbillable-test-key", LIVE_SPEND_CAP_MICRO:"1000000000", LIVE_KEY_SPEND_CAP_MICRO:"1000000000", LIVE_BUDGET_SCOPE:crypto.randomUUID() });
  app = await buildApp({ pool, boss, config });
});
afterAll(async () => { await app.close(); await boss.stop({ graceful: false, timeout: 2000 }); await pool.end(); });
async function setup(structured=false,publicSource=false) {
  const session = (await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} })).json();
  const headers = { authorization: `Bearer ${session.token}` };
  expect((await app.inject({ method: "POST", url: "/v1/consent", headers, payload: { grant: true } })).statusCode).toBe(200);
  const original = await readFile(new URL("./fixtures/documents/digital-scoped.pdf", import.meta.url));
  const entity=structured?Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>String.fromCharCode(65+n%26)).join(""):"Ardent";
  // Same-length substitution preserves PDF object offsets; the extractor still reads actual binary bytes.
  const bytes=Buffer.from(original.toString("latin1").replaceAll("Ardent",entity),"latin1");
  const question=`What does the ${entity} field note say about underwater recording?`;
  const uploaded = await app.inject({ method: "POST", url: "/v1/attachments/bytes", headers: { ...headers,
    "content-type": "application/octet-stream", "x-document-mime": "application/pdf", "x-file-name": "field-notes.pdf" }, payload: bytes });
  expect(uploaded.statusCode).toBe(201);
  const attachmentId = uploaded.json().attachmentId;
  const response = await app.inject({ method: "POST", url: "/v1/runs", headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    payload: { question, routeMode: structured?"controlled-research":"fixture", attachmentIds: publicSource?[]:[attachmentId] } });
  expect(response.statusCode).toBe(200);
  return { accountId: session.accountId, headers, attachmentId, runId: response.json().runId, bytes,entity,question };
}
it("W04 real API/worker persists PDF bytes, page locators and limitations; source inspection and deletion use the same records", async () => {
  const task = await setup(); await processRun(pool, config, task.runId);
  const att = (await pool.query("SELECT processing_state,extraction FROM attachments WHERE id=$1", [task.attachmentId])).rows[0];
  expect(att.processing_state).toBe("partially_read"); expect(att.extraction.blocks).toHaveLength(2);
  const passages = (await pool.query("SELECT p.* FROM passages p JOIN source_versions v ON v.id=p.source_version_id JOIN sources s ON s.id=v.source_id WHERE s.canonical_locator=$1 AND p.run_id=$2 ORDER BY p.locator->>'block'", [`attachment://${task.attachmentId}`, task.runId])).rows;
  expect(passages).toHaveLength(2);
  const reopened = await app.inject({ method: "GET", url: `/v1/sources/${passages[1].id}`, headers: task.headers });
  expect(reopened.statusCode).toBe(200); expect(reopened.json().passageLocator.block).toBe("page:2/block:0");
  expect(reopened.json().exactText).toContain("This result does not apply to immersion or cold weather.");
  expect(reopened.json().warnings).toContain("pdf_layout_tables_and_ocr_unverified");
  expect(reopened.json().accessLevel).toBe("partial-text");
  const artifact = (await pool.query("SELECT a.body FROM evidence_artifacts a JOIN extraction_receipts r ON r.artifact_id=a.id WHERE r.source_version_id=$1", [passages[0].source_version_id])).rows[0];
  expect(artifact.body).toEqual(task.bytes);
  expect((await app.inject({ method: "POST", url: "/v1/account/deletion", headers: task.headers })).statusCode).toBe(200);
  const purged = (await pool.query("SELECT raw_bytes,extraction FROM attachments WHERE id=$1", [task.attachmentId])).rows[0];
  expect(purged.raw_bytes).toBeNull(); expect(purged.extraction).toBeNull();
  expect((await app.inject({ method: "GET", url: `/v1/sources/${passages[1].id}`, headers: task.headers })).statusCode).toBe(401);
});
it.each(["cancel", "delete"])("W04 %s after actual parsing prevents late result persistence", async (action) => {
  const task = await setup(), owner = crypto.randomUUID();
  const run = (await getRun(pool, task.runId))!, brief = await getBrief(pool, run.brief_id);
  const fence = (await withTx(pool, (db) => claimLease(db, run.id, owner, 30_000)))!;
  const session = fencedSession(pool, { runId: run.id, accountId: run.account_id, owner, fence, briefRevision: run.brief_revision, leaseMs: 30_000 });
  let writes = 0;
  try {
    await expect(ingestAttachments(pool, run, brief, { ...session, write: async (fn, revoked) => {
      if (++writes === 2) {
        const result = await app.inject({ method: "POST", url: action === "delete" ? "/v1/account/deletion" : `/v1/runs/${run.id}/cancel`, headers: task.headers });
        expect(result.statusCode).toBe(200);
      }
      return session.write(fn, revoked);
    } })).rejects.toThrow("stale_worker");
    expect((await pool.query("SELECT 1 FROM passages WHERE run_id=$1", [run.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT extraction FROM attachments WHERE id=$1", [task.attachmentId])).rows[0].extraction).toBeNull();
  } finally { session.stop(); }
});


it.each(["upload","public-search"])("W04/W05 %s -> isolated PDF -> structured worker -> report/source reopen preserves a renamed negative finding",async(mode)=>{
 const publicSource=mode==="public-search",task=await setup(true,publicSource);
 if(publicSource)vi.spyOn(publicTransport,"safeFetch").mockImplementation(async(url)=>{
  expect(url).toBe("https://example.org/field-note.pdf");
  return {url,body:task.bytes.toString("utf8"),status:200,mime:"application/pdf",bytes:task.bytes,redirectChain:[]};
 });
 const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
 const reply=(output:unknown)=>new Response(JSON.stringify({id:"nonbillable-document-test",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}),{status:200});
 globalThis.fetch=vi.fn(async(input,init)=>{
  if(String(input)!=="https://openrouter.ai/api/v1/chat/completions")throw new Error("unexpected external request");
  const body=JSON.parse(String(init?.body));
  if(body.plugins?.length)return new Response(JSON.stringify({id:"nonbillable-search-document",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000003"},choices:[{finish_reason:"stop",message:{annotations:[{type:"url_citation",url_citation:{url:"https://example.org/field-note.pdf",title:"Field note",content:"A field note is available."}}]}}]}));
  const context=JSON.parse(body.messages[1].content),operation=body.response_format.json_schema.name;
  if(operation==="research_brief_v1") {
   const provenance={start:0,end:context.question.length,quote:context.question};
   return reply({objective:context.question,objectiveProvenance:provenance,intendedOutput:"Document-grounded answer",criteria:[{key:"recording",description:"Underwater recording support",field:"recording",operator:"explain",value:null,unit:null,importance:"hard",scope,provenance,group:"g",groupOperator:"all",unresolvedAlternatives:[]}],questions:[{key:"q",text:context.question,criterionKeys:["recording"],importance:"critical",evidenceStandard:"Explicit statement in the supplied document"}],assumptions:[],openAmbiguities:[],explicitExclusions:[]});
  }
  if(operation==="research_extract_assertions_v1") {
   const sentence=`${task.entity} does not support underwater recording.`;
   const p=context.passages.find((p:{text:string})=>p.text.includes(sentence));
   if(!p)throw new Error("actual PDF extraction lost the negative finding");
   const start=p.text.indexOf(sentence);
   return reply({candidates:[],assertions:[{key:"recording",candidateKey:null,criterionKeys:["recording"],text:sentence,scope,quantities:[],evidence:[{passageId:p.id,start,end:start+sentence.length,quote:sentence}]}],limitations:[]});
  }
  if(operation==="research_assess_support_v1")return reply({assessments:context.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Test double matches the extracted explicit negative",missingEvidence:[]}))});
  if(operation==="research_review_coverage_v1")return reply({questions:[{questionKey:"q",status:"supported",assertionKeys:context.approvedClaimKeys,reason:"Explicit negative answers the requested document question"}],omittedRequirements:[]});
  if(operation==="research_write_report_v1")return reply({title:"Document finding",sections:[{heading:"Evidence",paragraphs:[{text:context.assertions[0].text,claimKeys:[context.assertions[0].key]}]}],unresolvedQuestionKeys:[],limitations:[]});
  throw new Error("unexpected model operation");
 }) as typeof fetch;
 await processRun(pool,{...config,structuredDiscoveryEnabled:publicSource,liveRetrievalEnabled:publicSource},task.runId);
 const reports=(await pool.query("SELECT * FROM reports WHERE run_id=$1",[task.runId])).rows;
 expect(reports).toHaveLength(1);expect(reports[0].outcome).toBe("completed");
 const reopened=await app.inject({method:"GET",url:`/v1/reports/${reports[0].id}`,headers:task.headers});
 expect(reopened.statusCode).toBe(200);expect(reopened.json().labeledDemo).toBe(false);
 expect(reopened.json().blocks[1].text).toBe(`${task.entity} does not support underwater recording.`);
 const passageId=reopened.json().blocks[1].citationIds[0];
 const source=await app.inject({method:"GET",url:`/v1/sources/${passageId}`,headers:task.headers});
 expect(source.statusCode).toBe(200);expect(source.json().exactText).toContain(`${task.entity} does not support underwater recording.`);
 expect(source.json().passageLocator.block).toBe("page:1/block:0");expect(source.json().accessLevel).toBe("partial-text");
 expect(source.json().warnings).toContain("pdf_layout_tables_and_ocr_unverified");
 expect((await pool.query("SELECT body FROM evidence_artifacts WHERE account_id=$1",[task.accountId])).rows[0].body).toEqual(task.bytes);
 const checks=(await pool.query("SELECT result,claim_revision_id FROM scoped_support_results WHERE run_id=$1",[task.runId])).rows;
 expect(checks).toHaveLength(2);expect(checks.every((c)=>c.result.decision==="supported")).toBe(true);
 expect(globalThis.fetch).toHaveBeenCalledTimes(publicSource?8:7);
 if(publicSource)expect(publicTransport.safeFetch).toHaveBeenCalledTimes(1);
 console.info(JSON.stringify({evidenceClass:"local_api_worker_actual_pdf_fabricated_model",sourceTransport:publicSource?"saved bytes transport double":"binary upload",question:task.question,
  originalBytesSha256:createHash("sha256").update(task.bytes).digest("hex"),runId:task.runId,reportId:reports[0].id,
  reportText:reopened.json().blocks[1].text,source:{passageId,sourceVersionId:source.json().sourceVersionId,locator:source.json().passageLocator,
   access:source.json().accessLevel,method:source.json().extractionMethod,warnings:source.json().warnings},
  support:checks.map((c)=>({claimRevisionId:c.claim_revision_id,decision:c.result.decision,checks:c.result.checks})),
  paidProviderCalls:0,modelResponses:"fabricated",correctionJourney:"not tested"}));
 const library=await app.inject({method:"GET",url:"/v1/library",headers:task.headers});expect(JSON.stringify(library.json())).toContain(reports[0].id);
 expect((await app.inject({method:"POST",url:"/v1/account/deletion",headers:task.headers})).statusCode).toBe(200);
 expect((await pool.query("SELECT 1 FROM research_coverage WHERE account_id=$1",[task.accountId])).rowCount).toBe(0);
 expect((await pool.query("SELECT 1 FROM evidence_artifacts WHERE account_id=$1",[task.accountId])).rowCount).toBe(0);
 expect((await app.inject({method:"GET",url:`/v1/reports/${reports[0].id}`,headers:task.headers})).statusCode).toBe(401);
});
