import {expect,it,vi} from "vitest";
import {spawnSync} from "node:child_process";
import {authorize,registeredPlan,sha256,type Authorization} from "../src/evaluation/authorization.js";
import {runMatched,stepsFor,type Driver,type ExecutionReceipt} from "../src/evaluation/runner.js";
const id="11111111-1111-4111-8111-111111111111";
const protocol=JSON.stringify({version:"matched-real-model-protocol.v1",arms:{A1:"iterative-baseline.v1",B:"criterion-adaptive.v1"},repetitions:{allTasks:1,selectedThreeRepeats:["MC-D02"]}});
const tasks=JSON.stringify({tasks:[{id:"MC-D01",question:"Original",correctedQuestion:"Changed",mandatoryCriteria:["NEVER_GENERATOR_GOLD"]},{id:"MC-D02",question:"Second",correctedQuestion:"Revised",references:["NEVER_GENERATOR_GOLD"]}]});
const sources="{}",freeze=JSON.stringify({tasksSha256:sha256(tasks),sourcesSha256:sha256(sources)});
const grant=():Authorization=>({version:"matched-evaluation-authorization.v1",approvalId:id,approvalReference:"unit-control-not-authorization",issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),protocolSha256:sha256(protocol),freezeSha256:sha256(freeze),taskIds:["MC-D01"],budgetMicro:1000000,accountId:id,budgetScope:"evaluation:unit",sourceMode:"live_discovery",exclusiveDatabaseAcknowledged:true});
const plan=(g=grant())=>registeredPlan(g,{protocol,freeze,tasks,sources});
const receipt=(runId=id):ExecutionReceipt=>({runId,briefRevision:1,lifecycle:"terminal",outcome:"completed",reportId:id,cost:{confirmedMicro:1,heldMicro:0,unknownIntents:0},trace:{}});
const driver=():Driver=>({exposure:vi.fn(async()=>({confirmedMicro:0,heldMicro:0,unknownIntents:0})),admit:vi.fn(async()=>({runId:id})),execute:vi.fn(async()=>receipt())});
it("credentials and positive environment budget alone cannot authorize CLI execution",{timeout:60_000},()=>{const r=spawnSync(process.execPath,["--import","tsx","src/eval-live.ts"],{encoding:"utf8",env:{...process.env,OPENROUTER_API_KEY:"sentinel-private-key",LIVE_SPEND_CAP_MICRO:"1000000"}});expect(r.status).toBe(2);expect(r.stderr).toContain("explicit current approval");expect(r.stdout+r.stderr).not.toContain("sentinel-private-key");});
it("requires matching explicit operator attestation, current grant and digest",()=>{const g=grant(),raw=JSON.stringify(g),flags={execute:true,operatorConfirmsUserApproval:true,approvalId:id,sha256:sha256(raw)};expect(authorize(raw,flags)).toEqual(g);expect(()=>authorize(raw,{...flags,execute:false})).toThrow();expect(()=>authorize(raw,{...flags,operatorConfirmsUserApproval:false})).toThrow();expect(()=>authorize(raw,{...flags,sha256:"0".repeat(64)})).toThrow();expect(()=>authorize(raw,flags,Date.now()+86400000)).toThrow();});
it("verifies frozen registration and projects questions without evaluator references",()=>{const p=plan();expect(JSON.stringify(p.tasks)).not.toContain("NEVER_GENERATOR_GOLD");expect(p.unselectedTaskIds).toEqual(["MC-D02"]);expect(()=>registeredPlan(grant(),{protocol,freeze,tasks:tasks+" ",sources})).toThrow("registration_hash_mismatch");});
it("includes all registered repeats and alternates arm order",()=>{const steps=stepsFor(plan({...grant(),taskIds:["MC-D01","MC-D02"]}));expect(steps).toHaveLength(16);expect(steps.slice(0,2).map(s=>s.arm)).toEqual(["A1","B"]);expect(steps.slice(4,6).map(s=>s.arm)).toEqual(["B","A1"]);expect(steps.slice(8,10).map(s=>s.arm)).toEqual(["A1","B"]);expect(new Set(steps.map(s=>s.idempotencyKey)).size).toBe(16);});
it("missing frozen sources record every unrun step before any driver activity",async()=>{const d=driver(),events:unknown[]=[];const r=await runMatched(plan({...grant(),sourceMode:"frozen_supplied_document"}),d,async v=>{events.push(v)});expect(r.halted).toBeNull();expect(events.filter((v:any)=>v.event==="unrun").every((v:any)=>v.reason==="frozen_sources_unregistered")).toBe(true);expect(events.filter((v:any)=>v.event==="unrun")).toHaveLength(4);expect(d.exposure).not.toHaveBeenCalled();expect(d.admit).not.toHaveBeenCalled();});
it("holds including prior account/key liabilities block every new attempt",async()=>{const d=driver();d.exposure=async()=>({confirmedMicro:0,heldMicro:100,unknownIntents:1});const r=await runMatched(plan(),d,async()=>{});expect(r.halted).toBe("prior_unknown_exposure");expect(d.admit).not.toHaveBeenCalled();});
it("insufficient full-run reserve reports budget-unrun without lowering denominator",async()=>{const d=driver();d.exposure=async()=>({confirmedMicro:999999,heldMicro:0,unknownIntents:0});const r=await runMatched(plan(),d,async()=>{});expect(r).toEqual({expectedSteps:4,recordedResults:0,halted:"budget_unrun"});expect(d.admit).not.toHaveBeenCalled();});
it("retains accepted unknown response and never resends or starts another step",async()=>{const d=driver(),events:any[]=[];d.execute=async()=>{throw Error("arbitrary-sensitive-provider-message")};const r=await runMatched(plan(),d,async v=>{events.push(v)});expect(d.admit).toHaveBeenCalledOnce();expect(r.recordedResults).toBe(0);expect(events.filter(v=>v.event==="unrun")).toHaveLength(3);expect(JSON.stringify(events)).not.toContain("arbitrary-sensitive");});
it("failed exposure records the full remaining denominator with bounded reason",async()=>{const d=driver(),events:any[]=[];d.exposure=async()=>{throw Error("private")};await runMatched(plan(),d,async v=>{events.push(v)});expect(events.filter(v=>v.event==="unrun")).toHaveLength(4);expect(d.admit).not.toHaveBeenCalled();});
it("failed durable result write cannot count completion or issue the next step",async()=>{const d=driver();const r=await runMatched(plan(),d,async v=>{if(v.event==="result")throw Error("disk failed")});expect(r.recordedResults).toBe(0);expect(d.admit).toHaveBeenCalledOnce();});
it("runs original A1/B, B correction and fresh A1 sequentially with separate null scores",async()=>{const d=driver(),events:any[]=[];const r=await runMatched(plan(),d,async v=>{events.push(v)});expect(r.recordedResults).toBe(4);expect((d.admit as any).mock.calls[2][1].runId).toBe(id);expect((d.admit as any).mock.calls[3][1]).toBeUndefined();expect(events.at(-1).semanticScores).toBeNull();});

it("same approval and slots retain keys across new journals; distinct approval gets distinct keys",()=>{const a=stepsFor(plan()),b=stepsFor(plan());expect(a.map(s=>s.idempotencyKey)).toEqual(b.map(s=>s.idempotencyKey));expect(stepsFor(plan({...grant(),approvalId:"22222222-2222-4222-8222-222222222222"})).map(s=>s.idempotencyKey)).not.toEqual(a.map(s=>s.idempotencyKey));});

it.each(["exposure","attempt journal"])("expiry during awaited %s prevents admission and records every slot unrun",async boundary=>{
 const p=plan(),d=driver(),events:Record<string,unknown>[]=[];
 let now=Date.now();const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
 try{
  if(boundary==="exposure")d.exposure=vi.fn(async()=>{await Promise.resolve();now=Date.parse(p.authorization.expiresAt);return {confirmedMicro:0,heldMicro:0,unknownIntents:0};});
  const result=await runMatched(p,d,async event=>{events.push(event);await Promise.resolve();if(boundary==="attempt journal"&&event.event==="attempt")now=Date.parse(p.authorization.expiresAt);});
  expect(result).toEqual({expectedSteps:4,recordedResults:0,halted:"approval_expired"});
  expect(d.admit).not.toHaveBeenCalled();expect(d.execute).not.toHaveBeenCalled();
  expect(events.filter(e=>e.event==="unrun")).toHaveLength(4);
  expect(events.filter(e=>e.event==="unrun").every(e=>e.reason==="approval_expired")).toBe(true);
 }finally{clock.mockRestore();}
});
it("expiry after admission permits recording admitted completion but prevents the next admission",async()=>{
 const p=plan(),d=driver(),events:Record<string,unknown>[]=[];
 let now=Date.now();const clock=vi.spyOn(Date,"now").mockImplementation(()=>now);
 try{
  d.admit=vi.fn(async()=>{await Promise.resolve();now=Date.parse(p.authorization.expiresAt);return {runId:id};});
  const result=await runMatched(p,d,async e=>{events.push(e);});
  expect(result).toEqual({expectedSteps:4,recordedResults:1,halted:"approval_expired"});
  expect(d.admit).toHaveBeenCalledOnce();expect(d.execute).toHaveBeenCalledOnce();
  expect(events.filter(e=>e.event==="result")).toHaveLength(1);expect(events.filter(e=>e.event==="unrun")).toHaveLength(3);
 }finally{clock.mockRestore();}
});

it("live semantic path fail-closes without explicit current approval and issues zero provider calls",async()=>{
 const {authorizeLiveSemantic,executeLiveSemanticEval,LIVE_SEMANTIC_TASK_CLASSES}=await import("../src/evaluation/live-semantic.js");
 const providerCall=vi.fn(async()=>{throw new Error("must_not_call_provider");});
 const flags={execute:false,operatorConfirmsUserApproval:false,approvalId:id,sha256:"0".repeat(64)};
 expect(()=>authorizeLiveSemantic("{}",flags)).toThrow("explicit_current_approval_required");
 await expect(executeLiveSemanticEval({rawAuthorization:"{}",flags,driver:{providerCall}})).rejects.toThrow("explicit_current_approval_required");
 expect(providerCall).not.toHaveBeenCalled();
 expect(LIVE_SEMANTIC_TASK_CLASSES).toEqual([
  "one_sentence_purchase_comparison",
  "technical_compatibility_conflict",
  "freshness_sensitive_fact",
  "document_grounded_check",
  "correction",
  "unknown_is_correct",
 ]);
});
it("malformed or expired live-semantic grants fail closed with zero provider calls",async()=>{
 const {executeLiveSemanticEval}=await import("../src/evaluation/live-semantic.js");
 const providerCall=vi.fn(async()=>null);
 const g=grant(),raw=JSON.stringify(g),flags={execute:true,operatorConfirmsUserApproval:true,approvalId:id,sha256:sha256(raw)};
 await expect(executeLiveSemanticEval({rawAuthorization:"{not-json",flags,driver:{providerCall}})).rejects.toThrow();
 expect(providerCall).not.toHaveBeenCalled();
 await expect(executeLiveSemanticEval({rawAuthorization:raw,flags,driver:{providerCall},now:Date.now()+86400000})).rejects.toThrow();
 expect(providerCall).not.toHaveBeenCalled();
 await expect(executeLiveSemanticEval({rawAuthorization:JSON.stringify({...g,approvalId:"22222222-2222-4222-8222-222222222222"}),flags,driver:{providerCall}})).rejects.toThrow();
 expect(providerCall).not.toHaveBeenCalled();
});

it("unsupported document tasks remain individually unrun while supported frozen slots execute",async()=>{
 const p=plan(),d=driver(),events:any[]=[];p.authorization.sourceMode="frozen_supplied_document";
 p.tasks=[{...p.tasks[0]!,sources:[{id:"pdf",file:"document.pdf",mime:"application/pdf",sha256:"0".repeat(64)}]},{...p.tasks[0]!,id:"MC-D02",index:1,unavailableReason:"frozen_source_mime_unsupported"}];
 const result=await runMatched(p,d,async e=>{events.push(e)});expect(result).toEqual({expectedSteps:8,recordedResults:4,halted:null});expect(events.filter(e=>e.event==="unrun")).toHaveLength(4);expect(events.filter(e=>e.event==="unrun").every(e=>e.reason==="frozen_source_mime_unsupported")).toBe(true);expect(d.admit).toHaveBeenCalledTimes(4);
});
