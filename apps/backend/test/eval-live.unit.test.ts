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
it("credentials and positive environment budget alone cannot authorize CLI execution",()=>{const r=spawnSync(process.execPath,["--import","tsx","src/eval-live.ts"],{encoding:"utf8",env:{...process.env,OPENROUTER_API_KEY:"sentinel-private-key",LIVE_SPEND_CAP_MICRO:"1000000"}});expect(r.status).toBe(2);expect(r.stderr).toContain("explicit current approval");expect(r.stdout+r.stderr).not.toContain("sentinel-private-key");});
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

it("unsupported document tasks remain individually unrun while supported frozen slots execute",async()=>{
 const p=plan(),d=driver(),events:any[]=[];p.authorization.sourceMode="frozen_supplied_document";
 p.tasks=[{...p.tasks[0]!,sources:[{id:"pdf",file:"document.pdf",mime:"application/pdf",sha256:"0".repeat(64)}]},{...p.tasks[0]!,id:"MC-D02",index:1,unavailableReason:"frozen_source_mime_unsupported"}];
 const result=await runMatched(p,d,async e=>{events.push(e)});expect(result).toEqual({expectedSteps:8,recordedResults:4,halted:null});expect(events.filter(e=>e.event==="unrun")).toHaveLength(4);expect(events.filter(e=>e.event==="unrun").every(e=>e.reason==="frozen_source_mime_unsupported")).toBe(true);expect(d.admit).toHaveBeenCalledTimes(4);
});

const heldIntent=()=>({intentId:"33333333-3333-4333-8333-333333333333",runId:"44444444-4444-4444-8444-444444444444",requestDigest:"1".repeat(64),receiptDigest:"2".repeat(64),questionDigest:sha256("previous unrelated question"),reservedMicro:21658,policyId:"openrouter-azure-mini-zdr-text-v1"});
function continuationPlan(){
 const registeredProtocol=JSON.stringify({...JSON.parse(protocol),heldIntentContinuation:"held-intent-continuation.v1"});
 const g={...grant(),protocolSha256:sha256(registeredProtocol),heldIntentContinuation:{version:"held-intent-continuation.v1" as const,intents:[heldIntent()]}};
 return registeredPlan(g,{protocol:registeredProtocol,freeze,tasks,sources});
}
const preservedExposure=()=>({confirmedMicro:539,heldMicro:21658,unknownIntents:1,preservedHeldMicro:21658,preservedUnknownIntents:1});
it("explicit registered held-intent continuation permits independent steps while retaining full exposure in the journal",async()=>{
 const p=continuationPlan(),d=driver(),events:Record<string,unknown>[]=[];d.exposure=vi.fn(async()=>preservedExposure());
 const result=await runMatched(p,d,async event=>{events.push(event)});
 expect(result).toEqual({expectedSteps:4,recordedResults:4,halted:null});expect(d.admit).toHaveBeenCalledTimes(4);
 expect(events.filter(e=>e.event==="attempt").map(e=>e.exposure)).toEqual(Array.from({length:4},preservedExposure));
 expect(p.authorization.heldIntentContinuation!.intents).toEqual([heldIntent()]);
});
it.each([
 {label:"missing hold",exposure:{confirmedMicro:539,heldMicro:0,unknownIntents:0,preservedHeldMicro:0,preservedUnknownIntents:0}},
 {label:"unattested hold",exposure:{confirmedMicro:539,heldMicro:21658,unknownIntents:1}},
 {label:"wrong attested amount",exposure:{...preservedExposure(),preservedHeldMicro:21657}},
 {label:"wrong attested count",exposure:{...preservedExposure(),preservedUnknownIntents:0}},
 {label:"extra hold",exposure:{...preservedExposure(),heldMicro:21659,unknownIntents:2}},
 {label:"invalid attestation",exposure:{...preservedExposure(),preservedHeldMicro:NaN}},
])("continuation rejects $label without changing any denominator",async({exposure})=>{
 const d=driver(),events:Record<string,unknown>[]=[];d.exposure=async()=>exposure;
 const result=await runMatched(continuationPlan(),d,async event=>{events.push(event)});
 expect(result.recordedResults).toBe(0);expect(result.halted).toBe("prior_unknown_exposure");
 expect(d.admit).not.toHaveBeenCalled();expect(events.filter(e=>e.event==="unrun")).toHaveLength(4);
});
it("continuation charges retained reserves against the cap before every independent admission",async()=>{
 const p=continuationPlan(),d=driver();p.authorization.budgetMicro=122196;d.exposure=async()=>preservedExposure();
 expect(await runMatched(p,d,async()=>{})).toEqual({expectedSteps:4,recordedResults:0,halted:"budget_unrun"});expect(d.admit).not.toHaveBeenCalled();
 p.authorization.budgetMicro=122197;
 expect(await runMatched(p,d,async()=>{})).toEqual({expectedSteps:4,recordedResults:4,halted:null});
});
it("a newly unknown outcome still stops a continuation and preserves every remaining slot",async()=>{
 const d=driver(),events:Record<string,unknown>[]=[];d.exposure=async()=>preservedExposure();
 d.execute=vi.fn(async()=>({...receipt(),reportId:null,cost:{confirmedMicro:0,heldMicro:21658,unknownIntents:1}}));
 expect(await runMatched(continuationPlan(),d,async event=>{events.push(event)})).toEqual({expectedSteps:4,recordedResults:1,halted:"unknown_or_incomplete_run"});
 expect(d.admit).toHaveBeenCalledOnce();expect(events.filter(e=>e.event==="unrun")).toHaveLength(3);
});
it("continuation authorization rejects duplicate held intents rather than double-counting authority",()=>{
 const p=continuationPlan();p.authorization.heldIntentContinuation!.intents.push(heldIntent());
 const raw=JSON.stringify(p.authorization);
 expect(()=>authorize(raw,{execute:true,operatorConfirmsUserApproval:true,approvalId:id,sha256:sha256(raw)})).toThrow("duplicate_held_intent");
});
it.each(["original","changed"])("continuation cannot select a held %s question as original or correction",question=>{
 const p=continuationPlan();p.authorization.heldIntentContinuation!.intents[0]!.questionDigest=sha256(question);
 const registeredProtocol=JSON.stringify({...JSON.parse(protocol),heldIntentContinuation:"held-intent-continuation.v1"});
 expect(()=>registeredPlan(p.authorization,{protocol:registeredProtocol,freeze,tasks,sources})).toThrow("unknown_question_retry_forbidden");
});
it("an authorization cannot opt into continuation if its hash-pinned protocol does not register it",()=>{
 const p=continuationPlan();p.authorization.protocolSha256=sha256(protocol);
 expect(()=>registeredPlan(p.authorization,{protocol,freeze,tasks,sources})).toThrow("continuation_not_registered");
});
