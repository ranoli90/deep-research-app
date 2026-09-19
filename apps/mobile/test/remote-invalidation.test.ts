import { expect,it,vi } from "vitest";
import { applyRemoteInvalidation,redactInvalidatedContent } from "../src/remote-invalidation";
import { applySnapshot,emptyState,type UiState } from "../src/state";
import { createSessionStorage,memoryStore } from "../src/persist";
import { createProtectedContentStore } from "../src/protected-content";
import { readVerificationRun, prepareVerificationRequest } from "../src/verification-request";
import { createRequestScope } from "../src/request-scope";
const runId="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const snapshot={runId,lifecycle:"terminal",phase:"writing",outcome:"cancelled",reportId:null,labeledDemo:false,contentInvalidated:true};
const cached=():UiState=>({...emptyState(),signedIn:true,consentGranted:true,draft:"independent composer",
  run:{...snapshot,contentInvalidated:false,brief:{originalQuestion:"private question",constraints:[],revision:1}},
  report:{reportId:other,blocks:[{id:"answer",kind:"answer",text:"deleted source contents",claimIds:[],citationIds:[]}],limitations:[],labeledDemo:false},
  previousReport:{reportId:other,blocks:[]},readingAnchor:{reportId:other,blockId:"answer",offset:0},
  correctionDraft:{version:"correction-draft.v1",runId,baseRevision:1,question:"correction private text",evidencePolicy:"reuse_snapshot"},events:[{sequence:1,activity:null}],attachments:[{filename:"private.txt",mime:"text/plain",text:"private"}]});
it("W03 authoritative invalidation clears current and previous content before any ancillary fetch",async()=>{
  let state=cached();const ancillary=vi.fn(async()=>{throw Error("events offline");}),save=vi.fn(async(next:UiState)=>{expect(state.report).toBeNull();expect(next.previousReport).toBeNull();});
  const handled=await applyRemoteInvalidation(state,snapshot,{current:()=>true,hide:()=>{state=redactInvalidatedContent(state,runId);},save});
  if(!handled)await ancillary();expect(ancillary).not.toHaveBeenCalled();expect(save).toHaveBeenCalledOnce();
  expect(state).toMatchObject({report:null,previousReport:null,source:null,correctionDraft:null,readingAnchor:null,events:[],attachments:[],draft:"independent composer"});expect(state.run?.brief).toBeUndefined();
  expect(applySnapshot(cached(),snapshot).report).toBeNull();
});
it("W03 ordinary cancellation without invalidation does not erase a saved report",async()=>{
  const hide=vi.fn(),save=vi.fn();expect(await applyRemoteInvalidation(cached(),{...snapshot,contentInvalidated:false},{current:()=>true,hide,save})).toBe(false);expect(hide).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it("W03 delayed account/run callback cannot erase another view",async()=>{
  const scope=createRequestScope();scope.setSession("a");scope.selectRun(runId);const lease=scope.capture("view");scope.selectRun(other);
  const hide=vi.fn(),save=vi.fn();await expect(applyRemoteInvalidation(cached(),snapshot,{current:lease.current,hide,save})).rejects.toThrow("superseded");expect(hide).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
  const otherState={...cached(),run:{...snapshot,runId:other}};expect(redactInvalidatedContent(otherState,runId)).toBe(otherState);
  scope.setSession("b");await expect(applyRemoteInvalidation(cached(),snapshot,{current:lease.current,hide,save})).rejects.toThrow("superseded");
});
it("W03 child adoption refuses invalidated or malformed invalidation snapshots",()=>{
  expect(()=>readVerificationRun({...snapshot,routeMode:"controlled-research"},runId)).toThrow();
  expect(()=>readVerificationRun({...snapshot,contentInvalidated:"true",routeMode:"controlled-research"},runId)).toThrow();
});
it("W03 failed cleanup leaves UI hidden and protected marker redacts old snapshot on restart",async()=>{
  const ordinary=memoryStore(),secure=memoryStore(),credentials=memoryStore(),protectedCache=createProtectedContentStore(ordinary,secure);let fail=false;
  const cache={...protectedCache,setItem:async(k:string,v:string)=>{if(fail&&k==="deep.ui.v2")throw Error("disk full");await protectedCache.setItem(k,v);}};
  const storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});await storage.persistRequired("a",cached());fail=true;let state=cached();
  await expect(applyRemoteInvalidation(state,snapshot,{current:()=>true,hide:()=>{state=redactInvalidatedContent(state,runId);},save:(next,id)=>storage.redactRunContent("a",id,next)})).rejects.toThrow("disk full");expect(state.report).toBeNull();
  expect(await ordinary.getItem("deep.content-invalidation.v1")).toBeNull();expect(await protectedCache.getItem("deep.content-invalidation.v1")).toContain(runId);
  const restarted=createSessionStorage(cache,credentials),restored=await restarted.hydrate();expect(restored.state.report).toBeNull();expect(restored.state.previousReport).toBeNull();expect(restored.state.draft).toBe("independent composer");expect(restored.state.pendingContentInvalidation).toBe(runId);
  fail=false;await restarted.redactRunContent("a",runId,restored.state);expect(await protectedCache.getItem("deep.content-invalidation.v1")).toBeNull();
  // A stale coalesced UI write after cleanup is sanitized by the owning session.
  await restarted.persist({token:"a",state:cached()});expect((await createSessionStorage(cache,credentials).hydrate()).state.report).toBeNull();
});
it("W03 marker failure reports uncertainty without restoring current UI",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage({...cache,setItem:async(k,v)=>{if(k==="deep.content-invalidation.v1")throw Error("marker unavailable");await cache.setItem(k,v);}},credentials);await storage.activate({accountId:"a",token:"a"});let state=cached();
  await expect(applyRemoteInvalidation(state,snapshot,{current:()=>true,hide:()=>{state=redactInvalidatedContent(state,runId);},save:(next,id)=>storage.redactRunContent("a",id,next)})).rejects.toThrow("marker unavailable");expect(state.report).toBeNull();expect(state.pendingContentInvalidation).toBe(runId);
});
it("W03 invalidation preserves independent admission identity and account cleanup removes marker",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});
  const request={version:"admission.v1" as const,key:other,question:"independent request",routeMode:"controlled-research" as const,uploads:[]};await storage.saveAdmission("a",request);
  await storage.redactRunContent("a",runId,cached());expect((await storage.hydrate()).state.pendingAdmission).toEqual(request);
  await cache.setItem("deep.content-invalidation.v1",JSON.stringify({accountId:"a",runId}));await storage.activate({accountId:"b",token:"b"});expect(await cache.getItem("deep.content-invalidation.v1")).toBeNull();
  await cache.setItem("deep.content-invalidation.v1",JSON.stringify({accountId:"b",runId}));await storage.clear();expect(await cache.getItem("deep.content-invalidation.v1")).toBeNull();
});
it("W03 malformed invalidation markers fail closed",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});await cache.setItem("deep.content-invalidation.v1",JSON.stringify({accountId:"a",runId:"bad"}));await expect(storage.hydrate()).rejects.toThrow("invalid");
});
it("W03 new-install reset removes surviving protected invalidation markers",async()=>{
  const ordinary=memoryStore(),secure=memoryStore(),credentials=memoryStore();const cache=createProtectedContentStore(ordinary,secure);
  await cache.setItem("deep.content-invalidation.v1",JSON.stringify({accountId:"old",runId}));
  await createSessionStorage(cache,credentials).hydrate();
  expect(await cache.getItem("deep.content-invalidation.v1")).toBeNull();
});

it("W03 invalidation preserves exact pending correction and verification identities",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});
  const correction={version:"correction-documents.v1" as const,parentRunId:runId,baseRevision:1,upload:{version:"admission.v1" as const,key:other,question:"Add the selected documents to the existing research question.",routeMode:"controlled-research" as const,uploads:[{key:other,filename:"private.txt",mime:"text/plain",kind:"text" as const,digest:"a".repeat(64),attachmentId:other}]}};
  const verification=prepareVerificationRequest({run:{runId,reportId:other},report:{reportId:other,version:1,blocks:[{claimIds:[runId]}]},reportId:other,reportVersion:1,claimId:runId,note:"private exact identity",evidencePolicy:"reuse_snapshot",idempotencyKey:other});
  await storage.saveCorrectionDocuments("a",correction);await storage.redactRunContent("a",runId,{...cached(),pendingVerification:verification});
  const restored=await storage.hydrate();expect(restored.state.pendingCorrectionDocuments).toEqual(correction);expect(restored.state.pendingVerification).toEqual(verification);expect(restored.state.report).toBeNull();
});
it("W03 clean tombstoned snapshot reopens without an unfinished cleanup hold",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});await storage.redactRunContent("a",runId,cached());
  const reopened=await createSessionStorage(cache,credentials).hydrate();expect(reopened.state.run?.contentInvalidated).toBe(true);expect(reopened.state.report).toBeNull();expect(reopened.state.pendingContentInvalidation).toBeNull();
});
it("W03 fast opening snapshot can invalidate before React commits the selected run",async()=>{
  const before={...cached(),run:{...snapshot,runId:other}},opening={...before,run:{...snapshot,contentInvalidated:false}};
  let queued:UiState=opening;const saved:UiState[]=[];
  // App passes its explicit opening state while the last rendered state still names the old run.
  await applyRemoteInvalidation(opening,await Promise.resolve(snapshot),{current:()=>true,hide:()=>{queued=redactInvalidatedContent(queued,runId);},save:async state=>{saved.push(state);}});
  expect(queued.report).toBeNull();expect(saved[0]?.draft).toBe(before.draft);expect(saved[0]?.report).toBeNull();
});
it("W03 queued required and ordinary writes cannot restore content after cleanup",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});
  const before=storage.persistRequired("a",cached());
  const cleanup=storage.redactRunContent("a",runId,cached());
  const after=storage.persistRequired("a",cached());
  await Promise.all([before,cleanup,after]);expect((await createSessionStorage(cache,credentials).hydrate()).state.report).toBeNull();expect(await cache.getItem("deep.content-invalidation.v1")).toBeNull();
});
