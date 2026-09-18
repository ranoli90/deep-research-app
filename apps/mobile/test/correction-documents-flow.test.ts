import { createRequestScope } from "../src/request-scope";
import { expect, it, vi } from "vitest";
import { adoptCorrectionFile, correctionFilesFor, authoritativeCorrection, resolveCorrectionDocuments, adoptCorrectionSnapshot } from "../src/correction-documents-flow";
import { createSessionStorage, memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import type { PendingCorrectionDocuments } from "../src/correction-documents";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const draft=():PendingCorrectionDocuments=>({version:"correction-documents.v1",parentRunId:id(1),baseRevision:2,upload:{version:"admission.v1",key:id(2),question:"Add the selected documents to the existing research question.",routeMode:"controlled-research",uploads:[{key:id(3),filename:"doc.txt",mime:"text/plain",kind:"text",digest:"a".repeat(64),attachmentId:null}]}});
const file={filename:"doc.txt",mime:"text/plain",text:"private"};
it("W03 queued picker adoption cannot overwrite another account or report selection",()=>{
  const other={owner:"other",parent:id(9),files:[file]};
  expect(adoptCorrectionFile(other,"old",id(1),file,()=>false)).toBe(other);
  expect(correctionFilesFor(other,"old",id(9))).toEqual([]);expect(correctionFilesFor(other,"other",id(1))).toEqual([]);
  expect(correctionFilesFor(other,"other",id(9))).toEqual([file]);
});
it("W02 retry and withdrawal use confirmed durable IDs despite stale UI",async()=>{
  const stale=draft(),durable=draft();durable.upload.uploads[0]!.attachmentId=id(4);
  const read=async()=>durable, resolve=vi.fn(async()=>({status:"accepted",run:{runId:id(5),lifecycle:"running",phase:"researching",labeledDemo:false}})),finish=vi.fn();
  expect(await authoritativeCorrection(stale,id(1),{read,current:()=>true})).toEqual(durable);
  expect(await resolveCorrectionDocuments(stale,emptyState(),{read,resolve,finish,current:()=>true})).toEqual({runId:id(5)});
  expect(resolve).toHaveBeenCalledWith(durable,[id(4)]);expect(finish).not.toHaveBeenCalled();
});
it("W02 unknown recovery and failed withdrawal persistence retain journal",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),store=createSessionStorage(cache,credentials);await store.activate({accountId:"a",token:"t"});const d=draft();d.upload.uploads[0]!.attachmentId=id(4);await store.saveCorrectionDocuments("t",d);
  const ports={read:()=>store.readCorrectionDocuments("t"),current:()=>true,resolve:vi.fn(async()=>({status:"unknown"})),finish:vi.fn(async()=>{throw Error("storage unavailable");})};
  await expect(resolveCorrectionDocuments(d,emptyState(),ports)).rejects.toThrow("could not be confirmed");expect(ports.finish).not.toHaveBeenCalled();
  ports.resolve.mockResolvedValue({status:"withdrawn"});await expect(resolveCorrectionDocuments(d,emptyState(),ports)).rejects.toThrow("storage unavailable");
  expect(await store.readCorrectionDocuments("t")).toEqual(d);
});
it("W02 incomplete durable uploads can be withdrawn locally without a correction request",async()=>{
  const d=draft(),resolve=vi.fn(),finish=vi.fn();
  const result=await resolveCorrectionDocuments(d,{...emptyState(),pendingCorrectionDocuments:d},{read:async()=>d,current:()=>true,resolve,finish});
  expect(resolve).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledOnce();expect("state" in result&&result.state.pendingCorrectionDocuments).toBeNull();
});
it("W02 failed child GET retains request; successful actual snapshot is persisted before journal deletion",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),store=createSessionStorage(cache,credentials);await store.activate({accountId:"a",token:"t"});const d=draft();await store.saveCorrectionDocuments("t",d);
  const parent={...emptyState(),signedIn:true,pendingCorrectionDocuments:d};
  await expect(adoptCorrectionSnapshot(id(5),parent,{current:()=>true,get:async()=>{throw Error("offline");},finish:next=>store.finishCorrectionDocuments("t",next)})).rejects.toThrow("offline");
  expect(await store.readCorrectionDocuments("t")).toEqual(d);
  // This queued ordinary parent write is superseded by required child adoption.
  const stale=store.persist({token:"t",state:parent});
  const snap={runId:id(5),lifecycle:"running",phase:"researching",outcome:null,reportId:null,labeledDemo:false};
  const next=await adoptCorrectionSnapshot(id(5),parent,{current:()=>true,get:async()=>({...snap,routeMode:"controlled-research"}),finish:state=>store.finishCorrectionDocuments("t",state)});await stale;
  expect(next.run).toEqual(snap);const restored=await createSessionStorage(cache,credentials).hydrate();
  expect(restored.state.run).toEqual(snap);expect(restored.state.pendingCorrectionDocuments).toBeNull();
});
it("W03 account change during child GET cannot persist adoption",async()=>{
  let current=true;const finish=vi.fn();
  await expect(adoptCorrectionSnapshot(id(5),emptyState(),{current:()=>current,get:async()=>{current=false;return {runId:id(5),lifecycle:"running",phase:"researching",outcome:null,reportId:null,labeledDemo:false};},finish})).rejects.toThrow("superseded");expect(finish).not.toHaveBeenCalled();
});
it("W02 durable journal unseen by stale UI blocks a new correction instead of overwriting identity",async()=>{
  const durable=draft();
  await expect(authoritativeCorrection(null,id(9),{current:()=>true,read:async()=>durable})).rejects.toThrow("Saved correction changed");
  await expect(authoritativeCorrection(durable,id(9),{current:()=>true,read:async()=>durable})).rejects.toThrow("Saved correction changed");
});

it("W03 revoking consent invalidates old view callbacks while preserving current run and account requests",()=>{
  const scope=createRequestScope();scope.setSession("owner");scope.selectRun(id(1));
  const old=scope.capture("view"),account=scope.capture("account");
  expect(()=>scope.invalidateView("other")).toThrow("superseded");expect(old.current()).toBe(true);
  scope.invalidateView("owner");expect(old.current()).toBe(false);expect(account.current()).toBe(true);
  expect(scope.currentRun("owner",id(1))).toBe(true);expect(scope.capture("view","owner",id(1)).current()).toBe(true);
});
