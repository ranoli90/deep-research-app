import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it,vi } from "vitest";
import { claimIdForReportBlock,pickUniqueClaimId,uniqueAnswerClaimId,prepareVerificationRequest,readPendingVerificationRequest,readVerificationAccepted,submitVerificationRequest } from "../src/verification-request";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const args=()=>({run:{runId:id(1),reportId:id(2)},report:{reportId:id(2),version:3,blocks:[{claimIds:[id(4)]}]},reportId:id(2),reportVersion:3,claimId:id(4),note:"Private correction: not a public search query",evidencePolicy:"reuse_snapshot" as const,idempotencyKey:id(5)});
const reply=()=>({runId:id(6),parentRunId:id(1),verificationId:id(7),briefRevision:4,reused:false,reopenedDiscovery:false,evidencePolicy:"reuse_snapshot"});
it("targets the claim on the opened citation, not the first answer claim",()=>{
  const first=id(4), second=id(8);
  const blocks=[{id:"answer",claimIds:[first]},{id:"eligibility",claimIds:[second]}];
  expect(claimIdForReportBlock(blocks,"eligibility")).toBe(second);
  expect(claimIdForReportBlock(blocks,"answer")).toBe(first);
  expect(claimIdForReportBlock(blocks,"missing")).toBeNull();
  expect(claimIdForReportBlock([{id:"answer",claimIds:[first,second]}],"answer")).toBeNull();
  expect(pickUniqueClaimId([first,second])).toBeNull();
  expect(pickUniqueClaimId([first])).toBe(first);
  expect(uniqueAnswerClaimId([{id:"answer",kind:"answer",claimIds:[first]}])).toBe(first);
  expect(uniqueAnswerClaimId([{id:"answer",kind:"answer",claimIds:[first,second]}])).toBeNull();
  const app=readFileSync(join(import.meta.dirname,"../App.tsx"),"utf8");
  expect(app).toContain("uniqueAnswerClaimId");
  expect(app).toContain("pickUniqueClaimId");
  expect(app).toContain("void onFollowUp(claimId)");
  expect(app).not.toMatch(/claimIds\.length === 1 \? claimIds\[0\]/);
  expect(app).not.toMatch(/blocks\.find\(\(b\) => \(b\.kind === "answer" \|\| b\.id === "answer"\) && b\.claimIds.length\)\?\.claimIds\[0\]/);
  expect(app).not.toMatch(/void onFollowUp\(\); \}\}/);
});
it("binds selected claim to the current owned report and immutable version",()=>{
 expect(prepareVerificationRequest(args()).request.note).toBe(args().note);
 for(const changed of [{run:null},{report:null},{report:{...args().report,version:undefined}},{reportVersion:2},{reportId:id(9)},{claimId:id(9)},{run:{runId:id(1),reportId:id(9)}}])expect(()=>prepareVerificationRequest({...args(),...changed})).toThrow("changed");
 for(const changed of [{pendingAdmission:{}},{pendingSourceDeletion:id(9)}])expect(()=>prepareVerificationRequest({...args(),...changed})).toThrow("Resolve");
});
it("strictly parses protected identity using the shared request contract",()=>{
 const draft=prepareVerificationRequest(args());expect(readPendingVerificationRequest(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
 expect(readPendingVerificationRequest(null)).toBeNull();expect(readPendingVerificationRequest(undefined)).toBeNull();
 for(const bad of [{...draft,extra:true},{...draft,parentRunId:"bad"},{...draft,request:{...draft.request,query:"private"}},{...draft,request:{...draft.request,note:"x".repeat(4001)}},{...draft,request:{...draft.request,reportVersion:0}}])expect(()=>readPendingVerificationRequest(bad)).toThrow("invalid");
});
it("preserves exact identity and private note through response loss and restart without constructing queries",async()=>{
 const draft=prepareVerificationRequest(args());let stored="";const seen:unknown[]=[];
 const save=async(value:typeof draft)=>{stored=JSON.stringify(value)};
 await expect(submitVerificationRequest(draft,{current:()=>true,save,post:async(parent,request)=>{seen.push({parent,request});throw Error("response lost")}})).rejects.toThrow("response lost");
 const restored=readPendingVerificationRequest(JSON.parse(stored))!;
 const accepted=await submitVerificationRequest(restored,{current:()=>true,save,post:async(parent,request)=>{seen.push({parent,request});return{...reply(),reused:true}}});
 expect(seen[0]).toEqual(seen[1]);expect(accepted.reused).toBe(true);expect(JSON.parse(stored)).toEqual(draft);
 expect(Object.keys(restored.request).sort()).toEqual(["version","reportId","reportVersion","claimId","note","evidencePolicy","idempotencyKey"].sort());
});
it("does not POST until durable save succeeds and rejects account changes around awaits",async()=>{
 const draft=prepareVerificationRequest(args()),post=vi.fn(async()=>reply());
 await expect(submitVerificationRequest(draft,{current:()=>true,save:async()=>{throw Error("disk full")},post})).rejects.toThrow("disk full");expect(post).not.toHaveBeenCalled();
 let current=true;await expect(submitVerificationRequest(draft,{current:()=>current,save:async()=>{current=false},post})).rejects.toThrow("superseded");expect(post).not.toHaveBeenCalled();
 current=true;const save=vi.fn(async()=>{});await expect(submitVerificationRequest(draft,{current:()=>current,save,post:async()=>{current=false;return reply()}})).rejects.toThrow("superseded");expect(save).toHaveBeenCalledOnce();
});
it("rejects wrong or malformed acknowledgements while retaining the saved obligation",async()=>{
 const draft=prepareVerificationRequest(args());
 for(const patch of [{runId:id(1)},{parentRunId:id(9)},{verificationId:"bad"},{briefRevision:0},{briefRevision:1.5},{reused:"true"},{reopenedDiscovery:true},{evidencePolicy:"refresh_sources"},{extra:true}])expect(()=>readVerificationAccepted({...reply(),...patch},draft)).toThrow("could not be confirmed");
 const save=vi.fn(async()=>{});await expect(submitVerificationRequest(draft,{current:()=>true,save,post:async()=>null})).rejects.toThrow("could not be confirmed");expect(save).toHaveBeenCalledExactlyOnceWith(draft);
});
it("snapshots the acknowledged request before asynchronous caller mutation",async()=>{
 const draft=prepareVerificationRequest(args());const original=JSON.parse(JSON.stringify(draft));
 const post=vi.fn(async()=>reply());await submitVerificationRequest(draft,{current:()=>true,save:async(saved)=>{draft.request.note="changed";saved.request.note="also changed"},post});
 expect(post).toHaveBeenCalledExactlyOnceWith(original.parentRunId,original.request);
});

import { readVerificationRun } from "../src/verification-request";
import { createSessionStorage,memoryStore } from "../src/persist";
import { emptyState,canSubmit } from "../src/state";
const child=()=>({runId:id(6),routeMode:"controlled-research",labeledDemo:false,lifecycle:"queued",phase:"preparing",outcome:null,reportId:null,
 brief:{originalQuestion:"Actual saved question",revision:4,constraints:[{field:"year",value:"2026"}]},correctionMode:"replace_question",correctionReserveMicro:100});
it("validates actual child GET snapshots and rejects stale, fixture, or corrupt adoption",()=>{
 expect(readVerificationRun(child(),id(6))).toMatchObject({runId:id(6),labeledDemo:false,brief:child().brief});
 for(const patch of [{runId:id(9)},{routeMode:"fixture"},{labeledDemo:true},{lifecycle:"invented"},{phase:"done"},{outcome:"made_up"},{reportId:"bad"},
  {lifecycle:"terminal",outcome:null},{outcome:"failed"},{brief:{...child().brief,revision:0}},{brief:{...child().brief,constraints:[{field:1,value:"x"}]}},{correctionReserveMicro:-1}])
  expect(()=>readVerificationRun({...child(),...patch},id(6))).toThrow("could not be reopened");
 expect(readVerificationRun({...child(),lifecycle:"terminal",outcome:"completed",reportId:id(8)},id(6)).reportId).toBe(id(8));
});
it("retains unknown verification in protected storage across restart and clears it on account switch",async()=>{
 const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);
 await storage.activate({token:"a",accountId:"a"});const pending=prepareVerificationRequest(args());
 await storage.persistRequired("a",{...emptyState(),signedIn:true,pendingVerification:pending});
 const restarted=createSessionStorage(cache,credentials),restored=await restarted.hydrate();
 expect(restored.state.pendingVerification).toEqual(pending);expect(canSubmit({...restored.state,consentGranted:true,draft:"New question"}).reason).toContain("verification");
 await restarted.activate({token:"b",accountId:"b"});expect((await restarted.hydrate()).state.pendingVerification).toBeNull();
});
it("fails closed when the protected pending verification handle is malformed",async()=>{
 const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({token:"a",accountId:"a"});
 await storage.persistRequired("a",{...emptyState(),signedIn:true,pendingVerification:prepareVerificationRequest(args())});
 const envelope=JSON.parse((await cache.getItem("deep.ui.v2"))!);envelope.state.pendingVerification.request.claimId="corrupt";
 await cache.setItem("deep.ui.v2",JSON.stringify(envelope));await expect(storage.hydrate()).rejects.toThrow("Saved verification request is invalid");
});
