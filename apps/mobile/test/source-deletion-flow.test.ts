import { expect,it,vi } from "vitest";
import { submitSourceDeletion } from "../src/source-deletion-flow";
import { createSessionStorage,memoryStore } from "../src/persist";
import { emptyState,canSubmit } from "../src/state";
const sourceId="11111111-1111-4111-8111-111111111111";
const pending=()=>({...emptyState(),signedIn:true,draft:"Keep my unrelated draft",pendingSourceDeletion:sourceId});
const receipt={deleted:true,sourceId,alreadyDeleted:true,invalidatedRunIds:[],fileCleanupPending:false};
async function setup(){const cache=memoryStore(),credentials=memoryStore(),storage=createSessionStorage(cache,credentials);await storage.activate({accountId:"a",token:"a"});return{cache,credentials,storage};}
it("never issues deletion before durable privacy acknowledgement, nor after an account change",async()=>{
 const remove=vi.fn(),hide=vi.fn();await expect(submitSourceDeletion(pending(),{current:()=>true,save:async()=>{throw Error("storage full")},hide,remove})).rejects.toThrow("storage full");
 expect(remove).not.toHaveBeenCalled();expect(hide).not.toHaveBeenCalled();
 let current=true;await expect(submitSourceDeletion(pending(),{current:()=>current,save:async()=>{current=false},hide,remove})).rejects.toThrow("superseded");expect(remove).not.toHaveBeenCalled();
});
it("keeps a lost-response privacy handle across restart and blocks research until idempotent confirmation",async()=>{
 const {cache,credentials,storage}=await setup();const hide=vi.fn(),calls:string[]=[];
 await expect(submitSourceDeletion(pending(),{current:()=>true,save:s=>storage.persistRequired("a",s),hide,remove:async id=>{calls.push(id);throw Error("response lost")}})).rejects.toThrow("response lost");
 expect(hide).toHaveBeenCalledOnce();const restarted=createSessionStorage(cache,credentials);const restored=await restarted.hydrate();
 expect(restored.state.pendingSourceDeletion).toBe(sourceId);expect(restored.state.draft).toBe(pending().draft);expect(canSubmit(restored.state).ok).toBe(false);
 const done=await submitSourceDeletion({...restored.state,offline:true},{current:()=>true,save:s=>restarted.persistRequired("a",s),hide,remove:async id=>{calls.push(id);return receipt}});
 expect(calls).toEqual([sourceId,sourceId]);expect(done.pendingSourceDeletion).toBeNull();expect((await restarted.hydrate()).state.pendingSourceDeletion).toBeNull();
});
it("a failed acknowledgement write retains pending identity even after the server deleted the source",async()=>{
 const {storage}=await setup();let writes=0;await expect(submitSourceDeletion(pending(),{current:()=>true,save:async s=>{if(++writes===2)throw Error("write failed");await storage.persistRequired("a",s)},hide:()=>{},remove:async()=>receipt})).rejects.toThrow("write failed");
 expect((await storage.hydrate()).state.pendingSourceDeletion).toBe(sourceId);
});
it("stale receipts cannot write content into another active account",async()=>{
 const {storage}=await setup();let current=true;const save=vi.fn(s=>storage.persistRequired("a",s));
 await expect(submitSourceDeletion(pending(),{current:()=>current,save,hide:()=>{},remove:async()=>{current=false;await storage.activate({accountId:"b",token:"b"});return receipt}})).rejects.toThrow("superseded");
 expect(save).toHaveBeenCalledTimes(1);const next=await storage.hydrate();expect(next.accountId).toBe("b");expect(next.state.pendingSourceDeletion).toBeNull();expect(next.state.report).toBeNull();
});
it("hydration redacts stale dependent content when a pending handle exists and rejects malformed handles",async()=>{
 const {cache,storage}=await setup();await storage.persistRequired("a",{...pending(),report:{reportId:"old",blocks:[],limitations:[],labeledDemo:true},readingAnchor:{reportId:"old",blockId:"a",offset:0}});
 const restored=await storage.hydrate();expect(restored.state.report).toBeNull();expect(restored.state.readingAnchor).toBeNull();expect(restored.state.pendingSourceDeletion).toBe(sourceId);
 const envelope=JSON.parse((await cache.getItem("deep.ui.v2"))!);envelope.state.pendingSourceDeletion="corrupt";await cache.setItem("deep.ui.v2",JSON.stringify(envelope));await expect(storage.hydrate()).rejects.toThrow("Device cleanup");
});
it("required redaction supersedes queued ordinary snapshots and survives protected write completion",async()=>{
 const {storage}=await setup();const old=storage.persist({token:"a",state:{...emptyState(),signedIn:true,draft:"old"}});const required=storage.persistRequired("a",pending());await Promise.all([old,required]);expect((await storage.hydrate()).state).toMatchObject({pendingSourceDeletion:sourceId,draft:pending().draft});
});
