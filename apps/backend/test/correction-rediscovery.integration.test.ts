/** Fabricated model/search/reader controls through the production worker and real PostgreSQL.
 * Independent expected entities below check orchestration, not live semantic eligibility. */
import { writeFile } from "node:fs/promises";
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
import { getRun } from "../src/modules/runs.js";
import { processRun } from "../src/worker/executor.js";
import * as reader from "../src/adapters/retrieval/read-source.js";
const url=process.env.TEST_DATABASE_URL??"postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";
let pool:pg.Pool;const accounts:string[]=[],originalFetch=globalThis.fetch;
const config=loadConfig({DATABASE_URL:url,NODE_ENV:"test",APP_AUTH_MODE:"development",LIVE_ROUTE_ENABLED:"true",STRUCTURED_MODEL_ENABLED:"true",LIVE_RETRIEVAL_ENABLED:"true",OPENROUTER_API_KEY:"nonbillable-rediscovery",LIVE_KEY_SPEND_CAP_MICRO:"1000000000",LIVE_SPEND_CAP_MICRO:"1000000",LIVE_BUDGET_SCOPE:crypto.randomUUID(),LEASE_MS:"180000"});
const oldUrl="https://example.org/solmere.txt",newUrl="https://example.org/vesper.txt";
const texts={[oldUrl]:"Solmere supports Linux.",[newUrl]:"Vesper supports Windows."};
const parentQuestion="Which tools support Linux?",relaxedQuestion="Which tools support Linux or Windows?";
const scope={entity:null,plan:null,version:null,geography:null,time:null,population:null};
const response=(output:unknown)=>new Response(JSON.stringify({id:"nonbillable-control",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000001"},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}));
function transport(){const queries:string[]=[];const fetch:typeof globalThis.fetch=async(input,init)=>{
 expect(String(input)).toBe("https://openrouter.ai/api/v1/chat/completions");const body=JSON.parse(String(init?.body));
 if(body.plugins?.length){queries.push(body.messages[1].content);return new Response(JSON.stringify({id:"nonbillable-search",model:"openai/gpt-4o-mini",provider:"OpenAI",usage:{cost:"0.000003"},choices:[{finish_reason:"stop",message:{annotations:[oldUrl,newUrl].map(url=>({type:"url_citation",url_citation:{url,title:"Synthetic platform documentation"}}))}}]}));}
 const c=JSON.parse(body.messages[1].content),op=body.response_format.json_schema.name;
 if(op==="research_brief_v1"){const provenance={start:0,end:c.question.length,quote:c.question};return response({objective:c.question,objectiveProvenance:provenance,intendedOutput:"Supported platforms",criteria:[{key:"platform",description:c.question,field:"platform",operator:"contains",value:c.question.includes("Windows")?"Linux or Windows":"Linux",unit:null,importance:"hard",scope,provenance,group:"g",groupOperator:"any",unresolvedAlternatives:[]}],questions:[{key:"q",text:c.question,criterionKeys:["platform"],importance:"critical",evidenceStandard:"Explicit platform statement"}],assumptions:[],openAmbiguities:[],explicitExclusions:[]});}
 if(op==="research_extract_assertions_v1"){const assertions=c.passages.filter((p:{text:string})=>p.text.includes("Linux")||c.question.includes("Windows")&&p.text.includes("Windows")).map((p:{id:string;text:string},i:number)=>({key:`p${i}`,candidateKey:null,criterionKeys:["platform"],text:p.text,scope,quantities:[],evidence:[{passageId:p.id,start:0,end:p.text.length,quote:p.text}]}));return response({candidates:[],assertions,limitations:[]});}
 if(op==="research_assess_support_v1")return response({assessments:c.assertions.map((a:{key:string;scope:unknown;evidence:unknown})=>({claimKey:a.key,status:"supported",scope:a.scope,evidence:a.evidence,rationale:"Fabricated exact-span support control",missingEvidence:[]}))});
 if(op==="research_review_coverage_v1")return response({questions:[{questionKey:"q",status:"supported",assertionKeys:c.approvedClaimKeys,reason:"Fabricated coverage control"}],omittedRequirements:[]});
 if(op==="research_write_report_v1")return response({title:"Platform findings",sections:[{heading:"Evidence",paragraphs:c.assertions.map((a:{key:string;text:string})=>({text:a.text,claimKeys:[a.key]}))}],unresolvedQuestionKeys:[],limitations:[]});
 throw Error(`unexpected_operation:${op}`);
 };return{fetch,queries};}
beforeAll(async()=>{pool=createPool(url);await migrate(pool);});
afterEach(async()=>{globalThis.fetch=originalFetch;vi.restoreAllMocks();for(const account of accounts.splice(0))await deleteAccount(pool,account);});
afterAll(async()=>{await pool.end();});
async function setup(){const owner=await withTx(pool,async db=>{const s=await createDevSession(db);await grantConsent(db,s.accountId);return s;});accounts.push(owner.accountId);
 const model=transport();globalThis.fetch=model.fetch;
 const parent=await admitRun(pool,owner.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:parentQuestion,routeMode:"controlled-research"}));
 const sourceId=await insertSource(pool,{accountId:owner.accountId,runId:parent.runId,locator:oldUrl,title:"Solmere platforms",publisher:"Synthetic",originCluster:"example.org"});
 const passage=await insertVersionAndPassage(pool,{accountId:owner.accountId,runId:parent.runId,sourceId,locator:oldUrl,text:texts[oldUrl],accessLevel:"full-text"});
 await processRun(pool,config,parent.runId);const parentReport=await getLatestReportForRun(pool,parent.runId,owner.accountId);expect(parentReport,JSON.stringify((await pool.query("SELECT public_summary,payload FROM run_events WHERE run_id=$1",[parent.runId])).rows)).toBeTruthy();
 const child=await admitResearchCorrection(pool,owner.accountId,parent.runId,CorrectionRequestSchema.parse({expectedBriefRevision:1,correctionText:relaxedQuestion,patch:{kind:"replace_question",question:relaxedQuestion,evidencePolicy:"reuse_snapshot"}}));
 return{...owner,parent,child,passage,model,parentReport:parentReport!};}
it("W06 relaxed public constraint discovers a previously absent option and reuses exact old evidence without rereading",async()=>{
 const x=await setup();const read=vi.spyOn(reader,"readSource").mockImplementation(async locator=>{expect(locator).toBe(newUrl);const text=texts[newUrl],bytes=Buffer.from(text),digest=createHash("sha256").update(bytes).digest("hex");return{receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:"text/plain",retrievedAt:new Date().toISOString(),outcome:"successful_body"},bytes,extraction:{version:"utf8-notes-v1",digest,status:"extracted",warnings:[],blocks:[{kind:"text",locator:"paragraph:0",text,rows:[]}]}};});
 await processRun(pool,{...config,structuredDiscoveryEnabled:true},x.child.runId);
 const report=await getLatestReportForRun(pool,x.child.runId,x.accountId);expect(report).toBeTruthy();
 expect(x.model.queries).toEqual([relaxedQuestion]);expect(read).toHaveBeenCalledTimes(1);
 expect(x.parentReport.blocks.map((b:{text:string})=>b.text).join("\n")).not.toContain("Vesper");
 const rendered=report!.blocks.map((b:{text:string})=>b.text).join("\n");for(const expected of ["Solmere supports Linux.","Vesper supports Windows."])expect(rendered).toContain(expected);
 expect((await pool.query("SELECT passage_id,source_version_id FROM run_evidence_membership WHERE run_id=$1",[x.child.runId])).rows).toEqual([{passage_id:x.passage.passageId,source_version_id:x.passage.versionId}]);
 expect((await pool.query("SELECT s.canonical_locator FROM source_read_operations op JOIN sources s ON s.id=op.source_id WHERE op.run_id=$1 AND op.state='finished'",[x.child.runId])).rows).toEqual([{canonical_locator:newUrl}]);
 expect(report!.claim_ids.some((id:string)=>x.parentReport.claim_ids.includes(id))).toBe(false);
 expect(report!.blocks.flatMap((b:{citationIds:string[]})=>b.citationIds)).toContain(x.passage.passageId);
 expect((await pool.query("SELECT confirmed_micro FROM provider_intents WHERE run_id=$1 AND route LIKE '%public-discovery.%'",[x.child.runId])).rows).toEqual([{confirmed_micro:"3"}]);
 // Fresh full rerun uses the same worker/tools, with no inherited membership and two durable reads.
 read.mockImplementation(async locator=>{const text=texts[locator as keyof typeof texts];if(!text)throw Error("unexpected_source");const bytes=Buffer.from(text),digest=createHash("sha256").update(bytes).digest("hex");return{receipt:{requestedUrl:locator,finalUrl:locator,redirectChain:[],status:200,mime:"text/plain",retrievedAt:new Date().toISOString(),outcome:"successful_body"},bytes,extraction:{version:"utf8-notes-v1",digest,status:"extracted",warnings:[],blocks:[{kind:"text",locator:"paragraph:0",text,rows:[]}]}};});
 const full=await admitRun(pool,x.accountId,crypto.randomUUID(),CreateRunRequestSchema.parse({question:relaxedQuestion,routeMode:"controlled-research"}));
 await processRun(pool,{...config,structuredDiscoveryEnabled:true},full.runId);const rerun=await getLatestReportForRun(pool,full.runId,x.accountId);expect(rerun).toBeTruthy();
 const facts=async(runId:string,ids:string[]) => (await pool.query("SELECT text FROM claims WHERE account_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY text",[x.accountId,runId,ids])).rows.map((r:{text:string})=>r.text);
 const expected=["Solmere supports Linux.","Vesper supports Windows."],correctedFacts=await facts(x.child.runId,report!.claim_ids),rerunFacts=await facts(full.runId,rerun!.claim_ids);
 expect(correctedFacts).toEqual(expected);expect(rerunFacts).toEqual(expected);expect(correctedFacts).toEqual(rerunFacts);
 expect(read).toHaveBeenCalledTimes(3);
 expect((await pool.query("SELECT 1 FROM run_evidence_membership WHERE run_id=$1",[full.runId])).rowCount).toBe(0);
 const measurements=(await pool.query(`SELECT r.id, r.spent_micro::text,
  (SELECT count(*)::int FROM run_evidence_membership m WHERE m.run_id=r.id) AS reused_passages,
  (SELECT count(*)::int FROM source_read_operations op WHERE op.run_id=r.id AND op.state='finished') AS durable_reads,
  (SELECT count(*)::int FROM provider_intents i WHERE i.run_id=r.id) AS provider_attempts
  FROM runs r WHERE id=ANY($1::uuid[]) ORDER BY id`,[[x.child.runId,full.runId]])).rows;
 expect(measurements.find(r=>r.id===x.child.runId)).toMatchObject({reused_passages:1,durable_reads:1});expect(measurements.find(r=>r.id===full.runId)).toMatchObject({reused_passages:0,durable_reads:2});
 for(const row of measurements)expect(Number(row.spent_micro)).toBeGreaterThan(0);
 await writeFile("/tmp/deep-v6-correction-rediscovery-trace.json",JSON.stringify({evidenceClass:"real_local_postgresql_production_worker_with_fabricated_model_search_reader_transports",referenceFacts:expected,correctedFacts,rerunFacts,correctedRunId:x.child.runId,fullRunId:full.runId,measurements,queries:x.model.queries,readLocators:read.mock.calls.map(c=>c[0]),limitations:["No live semantic validation or independent human adjudication.","Extraction and provider receipts are fabricated transports; spend is synthetic micro-units."]},null,2)+"\n");
},120_000);
it("W06 disabled required rediscovery cannot silently publish a relaxed correction from only old evidence",async()=>{
 const x=await setup();await processRun(pool,{...config,structuredDiscoveryEnabled:false},x.child.runId);
 expect(await getLatestReportForRun(pool,x.child.runId,x.accountId)).toBeNull();
 expect((await getRun(pool,x.child.runId))?.terminal_outcome).toBe("failed");
 expect(x.model.queries).toEqual([]);
 expect((await pool.query("SELECT payload FROM run_events WHERE run_id=$1 AND type='research_unresolved'",[x.child.runId])).rows[0].payload.reason).toBe("correction_rediscovery_disabled");
 expect((await pool.query("SELECT operation FROM model_operation_results WHERE run_id=$1",[x.child.runId])).rows).toEqual([]);
 expect((await pool.query("SELECT 1 FROM provider_intents WHERE run_id=$1",[x.child.runId])).rowCount).toBe(0);
});
