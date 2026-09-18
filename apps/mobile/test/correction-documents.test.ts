import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { prepareCorrectionDocuments, readCorrectionDocuments, submitCorrectionDocuments, type PendingCorrectionDocuments } from "../src/correction-documents";
import { createSessionStorage, memoryStore } from "../src/persist";
import { createProtectedContentStore } from "../src/protected-content";
import { canSubmit, emptyState } from "../src/state";
import { api } from "../src/api";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const digest = async (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest());
const file = { filename: "private.pdf", mime: "application/pdf", bytes: new Uint8Array([1,2,3]) };
async function draft() { let n = 10; return prepareCorrectionDocuments(id(1), 2, [file], () => id(++n), digest, () => true); }
function io() { return { digest, current: () => true, progress: vi.fn(), preflight: vi.fn(async () => ({ liveRouteEnabled: true, appendDocumentsAllowed: true })),
  save: vi.fn(async (_p: PendingCorrectionDocuments) => {}), upload: vi.fn(async () => ({ attachmentId: id(40) })),
  correct: vi.fn(async () => ({ runId: id(50), parentRunId: id(1), briefRevision: 3, fullRerun: true, reused: false })) }; }
it("W06 exact correction journal precedes upload and confirmed IDs precede correction", async () => {
  const d = await draft(), ports = io(); expect(await submitCorrectionDocuments(d, [file], ports)).toBe(id(50));
  expect(ports.save.mock.invocationCallOrder[0]).toBeLessThan(ports.upload.mock.invocationCallOrder[0]!);
  expect(ports.save.mock.invocationCallOrder[1]).toBeLessThan(ports.correct.mock.invocationCallOrder[0]!);
  expect(ports.correct).toHaveBeenCalledWith(id(1), 2, d.upload.question, [id(40)]);
  expect(JSON.stringify(ports.save.mock.calls)).not.toContain('"bytes":');
});
it("W06 upload response loss retries identical key and bytes; admission response loss reuses saved IDs", async () => {
  const d = await draft(), ports = io(); let saved = d;
  ports.save.mockImplementation(async p => { saved = p; }); ports.upload.mockRejectedValueOnce(Error("upload response lost"));
  await expect(submitCorrectionDocuments(d,[file],ports)).rejects.toThrow("upload response lost");
  ports.correct.mockRejectedValueOnce(Error("admission response lost"));
  await expect(submitCorrectionDocuments(saved,[file],ports)).rejects.toThrow("admission response lost");
  expect(ports.upload.mock.calls[0]).toEqual(ports.upload.mock.calls[1]);
  await expect(submitCorrectionDocuments(saved,[],ports)).resolves.toBe(id(50));
  expect(ports.upload).toHaveBeenCalledTimes(2); expect(ports.correct.mock.calls[0]).toEqual(ports.correct.mock.calls[1]);
});
it("W03 rejects changed original bytes and unavailable route before upload", async () => {
  const d = await draft(), ports = io();
  await expect(submitCorrectionDocuments(d,[{...file,bytes:new Uint8Array([9])}],ports)).rejects.toThrow("Select private.pdf again");
  expect(ports.save).not.toHaveBeenCalled(); expect(ports.upload).not.toHaveBeenCalled();
  ports.preflight.mockResolvedValue({liveRouteEnabled:false,appendDocumentsAllowed:true});
  await expect(submitCorrectionDocuments(d,[file],ports)).rejects.toThrow("disabled"); expect(ports.upload).not.toHaveBeenCalled();
});
it("W03 storage failure or superseded upload never starts correction", async () => {
  const d = await draft(), ports = io(); ports.save.mockRejectedValueOnce(Error("storage"));
  await expect(submitCorrectionDocuments(d,[file],ports)).rejects.toThrow("storage"); expect(ports.upload).not.toHaveBeenCalled();
  let current = true; ports.current = () => current; ports.upload.mockImplementation(async () => { current = false; return {attachmentId:id(40)}; });
  await expect(submitCorrectionDocuments(d,[file],ports)).rejects.toThrow("superseded"); expect(ports.correct).not.toHaveBeenCalled();
});
it.each(["parentRunId","briefRevision","fullRerun","runId"])("W06 rejects mismatched child %s", async field => {
  const ports = io(); ports.correct.mockResolvedValue({...await ports.correct(),[field]:field === "briefRevision" ? 2 : field === "fullRerun" ? false : id(1)});
  if (field === "parentRunId") ports.correct.mockResolvedValue({...await ports.correct(),parentRunId:id(9)});
  await expect(submitCorrectionDocuments(await draft(),[file],ports)).rejects.toThrow("could not be confirmed");
});
it("W03 correction metadata is protected, restored independently of admission and cleared on account switch/logout", async () => {
  const ordinary=memoryStore(), secure=memoryStore(), credentials=memoryStore();
  const cache=createProtectedContentStore(ordinary,secure), store=createSessionStorage(cache,credentials);
  await store.activate({accountId:"owner",token:"token"}); const d=await draft();
  await store.persistRequired("token",{...emptyState(),signedIn:true,attachments:[file]});
  await store.saveCorrectionDocuments("token",d);
  expect(await ordinary.getItem("deep.ui.v2")).toBeNull();
  expect(await ordinary.getItem("deep.correction-documents.v1")).toBeNull();
  expect(await cache.getItem("deep.ui.v2")).not.toContain('"bytes":');
  const restored=await createSessionStorage(cache,credentials).hydrate(); expect(restored.state.pendingCorrectionDocuments).toEqual(d);
  expect(restored.state.pendingAdmission).toBeNull(); expect(restored.state.attachments).toEqual([]);
  expect(canSubmit({...restored.state,draft:"unrelated",consentGranted:true}).ok).toBe(false);
  await store.activate({accountId:"other",token:"other"}); expect((await store.hydrate()).state.pendingCorrectionDocuments).toBeNull();
  await store.clear(); expect((await store.hydrate()).state.pendingCorrectionDocuments).toBeNull();
});
it("W03 malformed correction metadata fails closed",async()=>{
  expect(()=>readCorrectionDocuments({version:"correction-documents.v1"})).toThrow();
  const cache=memoryStore(),credentials=memoryStore(),store=createSessionStorage(cache,credentials); await store.activate({accountId:"owner",token:"token"});
  await cache.setItem("deep.correction-documents.v1",JSON.stringify({accountId:"owner",draft:{bad:true}}));
  await expect(store.hydrate()).rejects.toThrow("invalid");
});
it("W06 recovery sends exact correction body while settings are unavailable",async()=>{
  const d=await draft(); api.activateSession("token");api.selectRun(d.parentRunId);
  const fetch=vi.fn(async()=>Response.json({status:"withdrawn"}));vi.stubGlobal("fetch",fetch);
  try { await expect(api.resolveCorrection("token",d.parentRunId,d.baseRevision,d.upload.question,{kind:"append_attachments",attachmentIds:[id(40)],evidencePolicy:"reuse_snapshot"})).resolves.toEqual({status:"withdrawn"});
    expect(fetch.mock.calls).toHaveLength(1);
    const [url,request]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toContain(`/v1/runs/${d.parentRunId}/corrections/resolve`);
    expect(JSON.parse(request.body as string)).toEqual({expectedBriefRevision:2,correctionText:d.upload.question,patch:{kind:"append_attachments",attachmentIds:[id(40)],evidencePolicy:"reuse_snapshot"}});
  } finally {api.activateSession(null);vi.unstubAllGlobals();}
});
it("W02 ordinary stale snapshot writes cannot erase confirmed upload identity",async()=>{
  const cache=memoryStore(),credentials=memoryStore(),store=createSessionStorage(cache,credentials);await store.activate({accountId:"owner",token:"token"});
  const d=await draft();d.upload.uploads[0]!.attachmentId=id(40);await store.saveCorrectionDocuments("token",d);
  await store.persist({token:"token",state:{...emptyState(),signedIn:true}});
  expect((await createSessionStorage(cache,credentials).hydrate()).state.pendingCorrectionDocuments).toEqual(d);
  await store.finishCorrectionDocuments("token",{...emptyState(),signedIn:true});
  expect((await createSessionStorage(cache,credentials).hydrate()).state.pendingCorrectionDocuments).toBeNull();
});
it("W02 failed child snapshot save retains correction journal",async()=>{
  const memory=memoryStore(),credentials=memoryStore();let fail=false;
  const cache={...memory,setItem:async(k:string,v:string)=>{if(fail&&k==="deep.ui.v2")throw Error("disk unavailable");await memory.setItem(k,v);}};
  const store=createSessionStorage(cache,credentials);await store.activate({accountId:"owner",token:"token"});const d=await draft();await store.saveCorrectionDocuments("token",d);fail=true;
  await expect(store.finishCorrectionDocuments("token",emptyState())).rejects.toThrow("disk unavailable");
  expect((await createSessionStorage(cache,credentials).hydrate()).state.pendingCorrectionDocuments).toEqual(d);
});

it("W06 branched correction accepts a later allocated revision while retaining parent binding",async()=>{
  const ports=io();ports.correct.mockResolvedValue({...await ports.correct(),briefRevision:9});
  await expect(submitCorrectionDocuments(await draft(),[file],ports)).resolves.toBe(id(50));
});

it.each([false,undefined,"true"])("W06 rejects unsupported document correction capability %s before upload",async flag=>{
  const ports={...io(),preflight:async()=>({liveRouteEnabled:true,appendDocumentsAllowed:flag})};
  await expect(submitCorrectionDocuments(await draft(),[file],ports)).rejects.toThrow("unavailable");
  expect(ports.save).not.toHaveBeenCalled();expect(ports.upload).not.toHaveBeenCalled();expect(ports.correct).not.toHaveBeenCalled();
});
