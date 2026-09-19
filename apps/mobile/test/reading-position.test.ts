import { describe,expect,it } from "vitest";
import { createReadingRestoration } from "../src/reading-position";
import { createSessionStorage,memoryStore } from "../src/persist";
import { createProtectedContentStore } from "../src/protected-content";
import { emptyState,type UiState } from "../src/state";
const owner={ownerKey:"account-a",reportId:"report-version-1"};
const saved={reportId:owner.reportId,blockId:"evidence",offset:80};
function sized(reader:ReturnType<typeof createReadingRestoration>,view:number){reader.measureViewport(view,600);reader.measureContent(view,4000);}


describe("W07 report reading continuity",()=>{
 it("waits for real scroll dimensions and ignores transient content shorter than the target section",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,saved,["evidence"]);
  reader.measureCard(view,160);reader.measureBlock(view,"evidence",700);
  expect(reader.take(view)).toEqual({kind:"waiting"});
  reader.measureViewport(view,600);reader.measureContent(view,0);expect(reader.take(view)).toEqual({kind:"waiting"});
  reader.measureContent(view,600);expect(reader.take(view)).toEqual({kind:"waiting"});
  reader.measureContent(view,1800);expect(reader.take(view)).toEqual({kind:"ready",y:940,anchor:saved});
 });
 it("clamps to the measured scroll range when a changed viewport cannot show the saved offset at its top",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,saved,["evidence"]);
  reader.measureCard(view,160);reader.measureBlock(view,"evidence",700);reader.measureViewport(view,900);reader.measureContent(view,1500);
  expect(reader.take(view)).toEqual({kind:"ready",y:600,anchor:saved});
 });

 it("explains a concise subset without claiming its canonical section changed",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,saved,["answer"],["answer","evidence"]);
  sized(reader,view);reader.measureCard(view,160);reader.measureBlock(view,"answer",100);
  const result=reader.take(view);expect(result).toEqual({kind:"ready",y:260,anchor:{...saved,blockId:"answer",offset:0},note:"That section is hidden in this view. Showing the first visible section."});
 });

 it("waits for the fallback block after the report card arrives, then explains a removed section",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,{...saved,blockId:"removed",offset:350},["answer","evidence"]);
  sized(reader,view);reader.measureCard(view,160);expect(reader.take(view)).toEqual({kind:"waiting"});
  reader.measureBlock(view,"evidence",700);expect(reader.take(view)).toEqual({kind:"waiting"});
  reader.measureBlock(view,"answer",100);
  expect(reader.take(view)).toMatchObject({kind:"ready",y:260,anchor:{...saved,blockId:"answer",offset:0},note:expect.stringContaining("changed")});
 });
 it("restores regardless of layout callback order and does not rewind on subsequent relayout",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,saved,["answer","evidence"]);
  reader.measureBlock(view,"evidence",700);expect(reader.take(view)).toEqual({kind:"waiting"});
  sized(reader,view);reader.measureCard(view,160);expect(reader.take(view)).toEqual({kind:"ready",y:940,anchor:saved});
  reader.measureBlock(view,"evidence",900);expect(reader.take(view)).toEqual({kind:"none"});
 });
 it("outline jump uses measured card and block y without consuming restore",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,saved,["evidence","answer"]);
  expect(reader.jumpY(view,"evidence")).toBeNull();
  reader.measureCard(view,160);expect(reader.jumpY(view,"evidence")).toBeNull();
  reader.measureBlock(view,"evidence",700);expect(reader.jumpY(view,"evidence")).toBe(860);
  expect(reader.take(view)).toEqual({kind:"waiting"});
 });
 it("a user scroll cancels pending restoration before delayed layout callbacks arrive",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,saved,["evidence"]);
  sized(reader,view);reader.measureCard(view,160);reader.userScrolled(view);reader.measureBlock(view,"evidence",700);
  expect(reader.take(view)).toEqual({kind:"none"});
  expect(reader.capture(view,965)).toEqual({...saved,offset:105});
 });
 it("ignores callbacks from a prior mount, account or immutable report version",()=>{
  const reader=createReadingRestoration(),oldView=reader.begin(owner,saved,["evidence"]);
  const current=reader.begin({...owner,ownerKey:"account-b",reportId:"report-version-2"},saved,["evidence"]);
  reader.measureCard(oldView,160);reader.measureBlock(oldView,"evidence",700);
  expect(reader.capture(oldView,940)).toBeNull();expect(reader.take(oldView)).toEqual({kind:"none"});
  sized(reader,current);reader.measureCard(current,200);reader.measureBlock(current,"evidence",800);
  expect(reader.take(current)).toEqual({kind:"none"});
  expect(reader.capture(current,1020)).toEqual({reportId:"report-version-2",blockId:"evidence",offset:20});
  reader.clear();expect(reader.capture(current,1020)).toBeNull();
 });
 it("captures the exact invoking block with its signed offset and requires a fresh layout on source return",()=>{
  const reader=createReadingRestoration(),view=reader.begin(owner,null,["answer","evidence"]);
  sized(reader,view);reader.measureCard(view,160);reader.measureBlock(view,"answer",100);reader.measureBlock(view,"evidence",1000);
  const anchor=reader.capture(view,940,"evidence");expect(anchor).toEqual({...saved,offset:-220});
  const returning=reader.begin(owner,anchor,["answer","evidence"]);
  expect(reader.take(returning)).toEqual({kind:"waiting"});
  sized(reader,view);reader.measureCard(view,9999);reader.measureBlock(view,"evidence",9999);
  sized(reader,returning);reader.measureCard(returning,200);reader.measureBlock(returning,"evidence",1100);
  expect(reader.take(returning)).toEqual({kind:"ready",y:1080,anchor});
 });
 it("does not fabricate coordinates for missing measurements or invalid anchor identities",()=>{
  const reader=createReadingRestoration();
  for(const anchor of [{...saved,offset:Infinity},{...saved,blockId:""}]){
   const view=reader.begin(owner,anchor,["evidence"]);sized(reader,view);reader.measureCard(view,160);reader.measureBlock(view,"evidence",700);
   expect(reader.take(view)).toEqual({kind:"none"});
  }
  const view=reader.begin(owner,saved,["evidence"]);sized(reader,view);reader.measureCard(view,NaN);reader.measureBlock(view,"evidence",Infinity);
  expect(reader.capture(view,940,"evidence")).toBeNull();expect(reader.take(view)).toEqual({kind:"waiting"});
  sized(reader,view);reader.measureCard(view,160);reader.measureBlock(view,"evidence",700);expect(reader.capture(view,940,"unmeasured")).toBeNull();
 });
 it("handles report block IDs as data, including prototype property names",()=>{
  const reader=createReadingRestoration(),anchor={...saved,blockId:"__proto__"},view=reader.begin(owner,anchor,["__proto__"]);
  sized(reader,view);reader.measureCard(view,160);reader.measureBlock(view,"__proto__",700);
  expect(reader.take(view)).toEqual({kind:"ready",y:940,anchor});
 });
 it("restores a protected account-owned anchor after process recreation while closing transient source content",async()=>{
  const ordinary=memoryStore(),secure=memoryStore(),credentials=memoryStore(),cache=createProtectedContentStore(ordinary,secure);
  const store=createSessionStorage(cache,credentials);await store.activate({accountId:owner.ownerKey,token:"synthetic-token"});
  const state:UiState={...emptyState(),signedIn:true,status:"completed",readingAnchor:saved,
   report:{reportId:owner.reportId,labeledDemo:false,limitations:[],blocks:[{id:"answer",kind:"text",text:"Synthetic answer",claimIds:[],citationIds:[]},{id:"evidence",kind:"text",text:"Synthetic evidence",claimIds:[],citationIds:["passage-v1"]}]},
   source:{passageId:"passage-v1",sourceVersionId:"source-version-1",title:"Synthetic source",exactText:"Private transient source content",accessLevel:"full-text"}};
  await store.persist({token:"synthetic-token",state});await store.flush();
  expect(await ordinary.getItem("deep.ui.v2")).toBeNull();
  const restored=await createSessionStorage(cache,credentials).hydrate();
  expect(restored.state.source).toBeNull();expect(restored.state.readingAnchor).toEqual(saved);
  const reader=createReadingRestoration(),view=reader.begin({ownerKey:restored.accountId!,reportId:restored.state.report!.reportId},restored.state.readingAnchor,restored.state.report!.blocks.map(b=>b.id));
  sized(reader,view);reader.measureCard(view,160);reader.measureBlock(view,"evidence",700);expect(reader.take(view)).toEqual({kind:"ready",y:940,anchor:saved});
  await store.activate({accountId:"account-b",token:"synthetic-other-token"});
  const switched=await createSessionStorage(cache,credentials).hydrate();
  expect(switched.accountId).toBe("account-b");expect(switched.state.readingAnchor).toBeNull();expect(switched.state.report).toBeNull();
  await store.clear();const cleared=await createSessionStorage(cache,credentials).hydrate();
  expect(cleared.state.readingAnchor).toBeNull();expect(cleared.state.report).toBeNull();
 });
});
