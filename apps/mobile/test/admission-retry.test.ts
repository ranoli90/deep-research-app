import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { documentFingerprint, prepareAdmission, readAdmissionDraft, submitAdmission, type AdmissionDraft } from "../src/admission-retry";
import { createSessionStorage, memoryStore } from "../src/persist";
import { createProtectedContentStore } from "../src/protected-content";
import { attachFile, emptyState, type UiState, type AttachmentDraft } from "../src/state";
const nodeDigest = async (bytes: Uint8Array) => new Uint8Array(createHash("sha256").update(bytes).digest());
const cryptoMock = vi.hoisted(() => ({ digest: vi.fn() }));
vi.mock("expo-crypto", () => ({ CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digest: (...args: unknown[]) => cryptoMock.digest(...args) }));
import { nativeDocumentDigest } from "../src/native-document-digest";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const file: AttachmentDraft = { filename: "note.txt", mime: "text/plain", text: "Exact private note" };
const preflight = async () => ({ fixtureRouteAllowed: true, liveRouteEnabled: true });
const accepted = { runId: id(99), lifecycle: "queued", phase: "planning", labeledDemo: false };
function pending(files = [file]) { let n=0; return prepareAdmission("Compare the evidence", "controlled-research", files, () => id(++n), nodeDigest); }
async function storage() {
  const ordinary=memoryStore(), secure=memoryStore(), credentials=memoryStore();
  const cache=createProtectedContentStore(ordinary,secure);
  const store=createSessionStorage(cache,credentials);
  await store.activate({accountId:"owner",token:"token"});
  return {ordinary,secure,credentials,cache,store};
}
describe("W02/W07 durable admission retry", () => {
  it("uses the explicit native adapter for exact byte views and rejects missing or malformed native results", async () => {
    cryptoMock.digest.mockImplementation(async (_algorithm, bytes: Uint8Array) => (await nodeDigest(bytes)).buffer);
    const bytes=new Uint8Array([90,1,2,3,91]).subarray(1,4);
    expect(await documentFingerprint({filename:"view.txt",mime:"text/plain",bytes},nativeDocumentDigest)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(cryptoMock.digest.mock.calls[0]?.[0]).toBe("SHA-256");
    expect([...cryptoMock.digest.mock.calls[0]?.[1]]).toEqual([1,2,3]);
    const draft=await pending();let saves=0,calls=0;
    const io={preflight,digest:nativeDocumentDigest,current:()=>true,progress:()=>{},save:async()=>{saves++;},upload:async()=>{calls++;return {};},admit:async()=>{calls++;return accepted;}};
    cryptoMock.digest.mockRejectedValue(new Error("Native module unavailable"));
    await expect(submitAdmission(draft,[file],io)).rejects.toThrow("Native module unavailable");
    cryptoMock.digest.mockResolvedValue(new ArrayBuffer(31));
    await expect(submitAdmission(draft,[file],io)).rejects.toThrow("invalid digest");
    await expect(submitAdmission(draft,[file],{...io,digest:async()=>new Uint8Array(33)})).rejects.toThrow("SHA256 is unavailable or invalid");
    expect(saves).toBe(0);expect(calls).toBe(0);
  });

  it("yields around native hashing and stops superseded preparation before journal or network", async () => {
    const large: AttachmentDraft = { filename: "large.pdf", mime: "application/pdf", bytes: new Uint8Array(8*1024*1024).fill(83) };
    let current = true, ticks = 0;
    const slowDigest = async (bytes: Uint8Array) => { await new Promise(resolve => setTimeout(resolve, 15)); return nodeDigest(bytes); };
    const heartbeat = setInterval(() => { if (++ticks === 3) current = false; }, 0);
    try {
      await expect(prepareAdmission("Compare evidence", "controlled-research", [large], () => id(1), slowDigest, () => current)).rejects.toThrow("superseded");
      expect(ticks).toBeGreaterThanOrEqual(3);
    } finally { clearInterval(heartbeat); }
    const draft: AdmissionDraft = { version:"admission.v1", key:id(1), question:"Compare evidence", routeMode:"controlled-research", uploads:[
      {key:id(2),filename:large.filename,mime:large.mime,kind:"bytes",digest:createHash("sha256").update(large.bytes!).digest("hex"),attachmentId:null}] };
    let saves=0,calls=0;current=true;ticks=0;
    const cancel = setInterval(() => { if (++ticks === 3) current=false; }, 0);
    try {
      await expect(submitAdmission(draft,[large],{preflight,digest:slowDigest,current:()=>current,progress:()=>{},save:async()=>{saves++;},upload:async()=>{calls++;return{};},admit:async()=>{calls++;return accepted;}})).rejects.toThrow("superseded");
      expect(saves).toBe(0);expect(calls).toBe(0);
    } finally { clearInterval(cancel); }
  });
  it("uploads the verified private snapshot even when external bytes change during persistence", async () => {
    const bytes = new TextEncoder().encode("Original bytes");
    const source: AttachmentDraft = {filename:"mutable.txt",mime:"text/plain",bytes};
    const draft = await pending([source]);
    await submitAdmission(draft,[source],{preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async()=>{bytes.fill(88);},upload:async f=>{
      expect(new TextDecoder().decode(f.bytes)).toBe("Original bytes");return {attachmentId:id(50)};
    },admit:async()=>accepted});
  });
  it("binds reselected duplicate names by digest regardless of selection order", async () => {
    const second={...file,text:"Second content"},draft=await pending([file,second]);
    let state: UiState={...emptyState(),pendingAdmission:draft};
    state=attachFile(state,{...second,id:"stale-selection-id"});state=attachFile(state,file);
    expect(state.attachments.map(f=>f.id)).toEqual([undefined,undefined]);
    const sent:string[]=[];
    await submitAdmission(draft,state.attachments,{preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async()=>{},upload:async f=>{sent.push(f.text!);return{attachmentId:id(50+sent.length)};},admit:async()=>accepted});
    expect(sent).toEqual([file.text,second.text]);
    const boundary="a".repeat(2047)+"🪸"+"café";
    expect(await documentFingerprint({...file,text:boundary}, nodeDigest)).toBe(createHash("sha256").update(boundary).digest("hex"));
  });

  it("replays the identical run key and uploaded IDs after a lost response and process restart", async () => {
    const s=await storage(); let uploadCount=0; const attempts: unknown[]=[];
    const io={preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:(d:AdmissionDraft)=>s.store.saveAdmission("token",d),
      upload:async()=>{uploadCount++;return {attachmentId:id(50)};},
      admit:async(d:AdmissionDraft,ids:string[])=>{attempts.push({key:d.key,question:d.question,ids});throw new Error("response lost after admission");}};
    await expect(submitAdmission(await pending(),[file],io)).rejects.toThrow("response lost");
    const reopened=createSessionStorage(s.cache,s.credentials);
    const restored=await reopened.hydrate();
    expect(restored.state.pendingAdmission?.uploads[0]?.attachmentId).toBe(id(50));
    const result=await submitAdmission(restored.state.pendingAdmission!,[],{...io,save:d=>reopened.saveAdmission("token",d),admit:async(d,ids)=>{attempts.push({key:d.key,question:d.question,ids});return accepted;}});
    expect(result).toEqual(accepted); expect(uploadCount).toBe(1); expect(attempts[0]).toEqual(attempts[1]);
    expect(await s.ordinary.getItem("deep.admission.v1")).toBeNull();
    await reopened.finishAdmission("token",{...restored.state,pendingAdmission:null,run:{...accepted,outcome:null,reportId:null}});
    const final=await createSessionStorage(s.cache,s.credentials).hydrate();
    expect(final.state.pendingAdmission).toBeNull();expect(final.state.run?.runId).toBe(accepted.runId);
  });
  it("persists the upload key before sending and reuses it after a lost upload reply", async () => {
    let journal: AdmissionDraft | null=null; const keys:string[]=[];
    const io={preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async(d:AdmissionDraft)=>{journal=structuredClone(d);},
      upload:async(_f:AttachmentDraft,key:string)=>{expect(journal?.uploads[0]?.key).toBe(key);keys.push(key);throw new Error("lost upload response");},admit:async()=>accepted};
    await expect(submitAdmission(await pending(),[file],io)).rejects.toThrow("lost upload");
    await expect(submitAdmission(journal!,[],io)).rejects.toThrow("Select note.txt again");
    expect(keys).toHaveLength(1);
    await submitAdmission(journal!,[file],{...io,upload:async(_f,key)=>{keys.push(key);return {attachmentId:id(50)};}});
    expect(keys[0]).toBe(keys[1]);
  });
  it("reselects only the unresolved duplicate-named file after restart", async () => {
    const d=await pending([file,{...file,text:"second"}]);d.uploads[0]!.attachmentId=id(50);
    const sent:string[]=[];
    await submitAdmission(d,[{...file,text:"second"}],{preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async()=>{},upload:async f=>{sent.push(f.text!);return {attachmentId:id(51)};},admit:async()=>accepted});
    expect(sent).toEqual(["second"]);
  });
  it("rejects same-named replacement bytes even if the first upload never reached the server", async () => {
    let calls=0;
    await expect(submitAdmission(await pending(),[{...file,text:"silently changed"}],{preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async()=>{},upload:async()=>{calls++;return {attachmentId:id(50)};},admit:async()=>accepted})).rejects.toThrow("Select note.txt again");
    expect(calls).toBe(0);
    const text="Unicode 🪸 café";
    expect(await documentFingerprint({...file,text}, nodeDigest)).toBe(createHash("sha256").update(text).digest("hex"));
    const bytes=new Uint8Array(8*1024*1024).fill(83);
    expect(await documentFingerprint({filename:"max.pdf",mime:"application/pdf",bytes}, nodeDigest)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it("does not upload or admit if protected persistence fails, and preserves unknown admission on malformed success", async () => {
    let calls=0; const io={preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async()=>{throw new Error("storage failed");},upload:async()=>{calls++;return {};},admit:async()=>{calls++;return {};}};
    await expect(submitAdmission(await pending(),[file],io)).rejects.toThrow("storage failed");expect(calls).toBe(0);
    let saved:AdmissionDraft|null=null;
    await expect(submitAdmission(await pending([]),[],{...io,save:async d=>{saved=d;}})).rejects.toThrow("could not be confirmed");
    expect(saved).not.toBeNull();expect(calls).toBe(1);
  });
  it("does not admit after account/view change and prevents late journal writes across accounts", async () => {
    const s=await storage();let current=true,admissions=0;
    await expect(submitAdmission(await pending(),[file],{preflight,digest:nodeDigest,current:()=>current,progress:()=>{},save:d=>s.store.saveAdmission("token",d),upload:async()=>{current=false;return {attachmentId:id(50)};},admit:async()=>{admissions++;return accepted;}})).rejects.toThrow("superseded");
    expect(admissions).toBe(0);
    await s.store.activate({accountId:"other",token:"other"});
    await expect(s.store.saveAdmission("token",await pending())).rejects.toThrow("Session changed");
    expect((await s.store.hydrate()).state.pendingAdmission).toBeNull();
  });
  it("keeps retry identity when accepted-run snapshot persistence fails", async () => {
    const s=await storage();await s.store.saveAdmission("token",await pending([]));
    const original=s.cache.setItem;s.cache.setItem=async(k,v)=>{if(k==="deep.ui.v2")throw new Error("snapshot failure");await original(k,v);};
    await expect(s.store.finishAdmission("token",{...emptyState(),signedIn:true})).rejects.toThrow("snapshot failure");
    s.cache.setItem=original;
    expect((await s.store.hydrate()).state.pendingAdmission?.key).toBe(id(1));
    await s.store.clear();expect(await s.cache.getItem("deep.admission.v1")).toBeNull();
  });
  it("fails closed on corrupt/foreign journal rather than discarding an unknown request", async () => {
    const s=await storage();
    for(const payload of ['{"accountId":"foreign","draft":{}}','{"accountId":"owner","draft":{"version":"unknown"}}','malformed']) {
      await s.cache.setItem("deep.admission.v1",payload);
      await expect(createSessionStorage(s.cache,s.credentials).hydrate()).rejects.toThrow();
    }
    const valid = await pending();
    expect(()=>readAdmissionDraft({...valid,bytes:[1,2]})).toThrow("Saved request");
  });
  it("keeps duplicate-named uploads distinct and never puts their bytes in the journal", async () => {
    const files=[file,{...file,text:"Second distinct content"}]; const seen:string[]=[];let journal=await pending(files);
    await submitAdmission(journal,files,{preflight,digest:nodeDigest,current:()=>true,progress:()=>{},save:async d=>{journal=d;},upload:async(f)=>{seen.push(f.text!);return {attachmentId:id(50+seen.length)};},admit:async()=>accepted});
    expect(seen).toEqual([file.text,"Second distinct content"]);expect(JSON.stringify(journal)).not.toContain("Exact private note");
    expect(journal.uploads[0]?.key).not.toBe(journal.uploads[1]?.key);
  });
});
