import { describe,expect,it } from "vitest";
import { completeSourceDeletion,prepareSourceDeletion,readPendingSourceDeletion,readSourceDeletionReceipt,
 sameSourceDeletionTarget,sourceDeletionTarget,sourceDeletionUnavailable,type SourceDeletionState } from "../src/source-deletion";
import { emptyState } from "../src/state";
import { readSourceDetail } from "../src/source-view";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const source={sourceId:uuid(1),passageId:uuid(2),sourceVersionId:uuid(3),title:"Synthetic private source",exactText:"Source content",accessLevel:"full-text"};
const receipt={deleted:true as const,sourceId:source.sourceId,alreadyDeleted:false,invalidatedRunIds:[uuid(4)],fileCleanupPending:false};
function state():SourceDeletionState{return {...emptyState(),pendingSourceDeletion:null,signedIn:true,consentGranted:false,draft:"Preserved user composer",source,
 run:{runId:uuid(4),lifecycle:"terminal",phase:"done",outcome:"completed",reportId:uuid(5),labeledDemo:false,brief:{originalQuestion:"Dependent question",constraints:[],revision:1}},
 report:{reportId:uuid(5),blocks:[{id:"answer",kind:"text",text:"Derived private answer",claimIds:[],citationIds:[source.passageId]}],limitations:[],labeledDemo:false},
 previousReport:{reportId:uuid(6),blocks:[{id:"answer",kind:"text",text:"Previous private answer",claimIds:[],citationIds:[]}]},
 correctionDraft:{version:"correction-draft.v1",runId:uuid(4),baseRevision:1,question:"Dependent correction",evidencePolicy:"reuse_snapshot"},
 events:[{sequence:1,type:"answer",publicSummary:"Dependent activity"}],readingAnchor:{reportId:uuid(5),blockId:"answer",offset:22},clarification:["Dependent prompt"],status:"completed"};}

describe("W03/W07 source deletion on device",()=>{
 it("requires an explicit valid source handle while keeping legacy sources readable",()=>{
  expect(sourceDeletionTarget(readSourceDetail(source))).toEqual({sourceId:source.sourceId,passageId:source.passageId,sourceVersionId:source.sourceVersionId});
  const {sourceId:_,...legacy}=source;expect(readSourceDetail(legacy).exactText).toBe(source.exactText);expect(sourceDeletionTarget(legacy)).toBeNull();
  for(const value of [null,{}, {...source,sourceId:"arbitrary"},{...source,passageId:""},{...source,sourceVersionId:23}])expect(sourceDeletionTarget(value)).toBeNull();
 });
 it("binds the confirmation to the current source, passage and immutable version",()=>{
  const target=sourceDeletionTarget(source);
  expect(sameSourceDeletionTarget(target,sourceDeletionTarget({...source,title:"Same source"}))).toBe(true);
  for(const changed of [{sourceId:uuid(9)},{passageId:uuid(9)},{sourceVersionId:uuid(9)}])expect(sameSourceDeletionTarget(target,sourceDeletionTarget({...source,...changed}))).toBe(false);
  expect(sameSourceDeletionTarget(null,null)).toBe(false);
 });
 it("clears dependent and ambiguously mapped report caches without changing composer or consent",()=>{
  const original={...state(),attachments:[{filename:"private.txt",mime:"text/plain",text:"Selected private content"},{filename:"private.pdf",mime:"application/pdf",bytes:new Uint8Array([1,2,3])}]},next=prepareSourceDeletion(original,source.sourceId);
  expect(next).toMatchObject({pendingSourceDeletion:source.sourceId,draft:original.draft,consentGranted:false,signedIn:true,source:null,report:null,previousReport:null,run:null,
   correctionDraft:null,readingAnchor:null,attachments:[],events:[],clarification:[],status:"empty"});
  expect(next.error).toContain("not yet confirmed");expect(original.attachments).toHaveLength(2);expect(JSON.stringify(next)).not.toContain("Selected private content");expect(original.report?.blocks[0]?.text).toBe("Derived private answer");
  expect(JSON.stringify(next)).not.toContain("Derived private");expect(JSON.stringify(next)).not.toContain("Dependent question");
 });
 it("never discards unresolved admission identity to start a deletion",()=>{
  const original={...state(),pendingAdmission:{version:"admission.v1" as const,key:uuid(10),question:"Unknown admitted request",routeMode:"controlled-research" as const,uploads:[]}};
  expect(()=>prepareSourceDeletion(original,source.sourceId)).toThrow("Check or withdraw");expect(original.pendingAdmission.key).toBe(uuid(10));
  expect(original.report).not.toBeNull();
 });
 it("does not silently queue initial deletion offline or act on a stale source selection",()=>{
  expect(()=>prepareSourceDeletion({...state(),offline:true},source.sourceId)).toThrow("Nothing has been deleted");
  expect(()=>prepareSourceDeletion({...state(),signedIn:false},source.sourceId)).toThrow("Sign in");
  expect(()=>prepareSourceDeletion(state(),uuid(9))).toThrow("selected source changed");
  expect(()=>prepareSourceDeletion({...state(),pendingSourceDeletion:uuid(9)},source.sourceId)).toThrow("pending source deletion");
  expect(sourceDeletionUnavailable({target:sourceDeletionTarget(source),offline:true,admissionPending:false,busy:false})).toContain("Connect");
 });
 it("validates server acknowledgement and preserves uncertainty on malformed or foreign replies",()=>{
  expect(readSourceDeletionReceipt(receipt,source.sourceId)).toEqual(receipt);
  for(const bad of [null,{...receipt,deleted:false},{...receipt,sourceId:uuid(9)},{...receipt,fileCleanupPending:"false"},{...receipt,invalidatedRunIds:["bad"]},
   {...receipt,invalidatedRunIds:[uuid(4),uuid(4)]},{...receipt,extra:"unrecognized"}])expect(()=>readSourceDeletionReceipt(bad,source.sourceId)).toThrow("could not be confirmed");
  const pending=prepareSourceDeletion(state(),source.sourceId);
  expect(()=>completeSourceDeletion(pending,{...receipt,deleted:false} as unknown as typeof receipt)).toThrow("could not be confirmed");
  expect(pending.pendingSourceDeletion).toBe(source.sourceId);expect(pending.report).toBeNull();
 });
 it("handles replay's empty invalidation list without restoring any report and describes deferred file cleanup",()=>{
  const pending=prepareSourceDeletion(state(),source.sourceId);
  const replay=readSourceDeletionReceipt({...receipt,alreadyDeleted:true,invalidatedRunIds:[],fileCleanupPending:true},source.sourceId);
  const next=completeSourceDeletion(pending,replay);
  expect(next.pendingSourceDeletion).toBeNull();expect(next.report).toBeNull();expect(next.previousReport).toBeNull();expect(next.run).toBeNull();
  expect(next.error).toContain("file cleanup is still pending");
  expect(completeSourceDeletion({...pending,offline:true},receipt).error).toContain("Source deleted");
 });
 it("ignores late receipts when account clearing or another pending handle changed the active state",()=>{
  const cleared:SourceDeletionState={...emptyState(),pendingSourceDeletion:null};expect(completeSourceDeletion(cleared,receipt)).toBe(cleared);
  const other={...state(),pendingSourceDeletion:uuid(9)};expect(completeSourceDeletion(other,receipt)).toBe(other);expect(other.report).not.toBeNull();
 });
 it("requires fail-closed hydration of a pending privacy handle",()=>{
  expect(readPendingSourceDeletion(undefined)).toBeNull();expect(readPendingSourceDeletion(null)).toBeNull();expect(readPendingSourceDeletion(source.sourceId)).toBe(source.sourceId);
  for(const bad of ["",false,{},[],"bad",{sourceId:source.sourceId}])expect(()=>readPendingSourceDeletion(bad)).toThrow("Device cleanup");
 });
});
