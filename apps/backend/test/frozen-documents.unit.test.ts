import {it,expect} from "vitest";
import {mkdtemp,writeFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadFrozenDocuments} from "../src/evaluation/frozen-documents.js";
import {sha256,type RegisteredPlan} from "../src/evaluation/authorization.js";
const bytes=Buffer.from("%PDF-1.4\nsynthetic validation only");
const plan=(file="document.pdf",digest=sha256(bytes))=>({authorization:{sourceMode:"frozen_supplied_document"},tasks:[{sources:[{id:"doc",file,mime:"application/pdf",sha256:digest}]}]} as RegisteredPlan);
it("preflights exact PDF bytes and rejects digest substitution and missing files",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"frozen-pdf-"));try{
 await writeFile(join(directory,"document.pdf"),bytes);
 expect((await loadFrozenDocuments(plan(),directory)).get("doc")?.bytes).toEqual(bytes);
 await expect(loadFrozenDocuments(plan("document.pdf","0".repeat(64)),directory)).rejects.toThrow("digest_mismatch");
 await expect(loadFrozenDocuments(plan("missing.pdf"),directory)).rejects.toThrow();
 }finally{await rm(directory,{recursive:true});}
});
it("rejects symlinks outside corpus, oversize files, and HTML masquerading as PDF",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"frozen-pdf-")),outside=await mkdtemp(join(tmpdir(),"outside-"));try{
 await writeFile(join(outside,"document.pdf"),bytes);await symlink(join(outside,"document.pdf"),join(directory,"document.pdf"));
 await expect(loadFrozenDocuments(plan(),directory)).rejects.toThrow("frozen_document_invalid");await rm(join(directory,"document.pdf"));
 await writeFile(join(directory,"document.pdf"),Buffer.alloc(8*1024*1024+1));await expect(loadFrozenDocuments(plan(),directory)).rejects.toThrow("frozen_document_invalid");
 await writeFile(join(directory,"document.pdf"),"<html>not a pdf</html>");await expect(loadFrozenDocuments(plan(),directory)).rejects.toThrow();
 }finally{await rm(directory,{recursive:true});await rm(outside,{recursive:true});}
});
it("loads every registered official PDF without importing reference criteria or relabeling HTML",async()=>{
 const {readFile}=await import("node:fs/promises");const {registeredPlan}=await import("../src/evaluation/authorization.js");
 const root=new URL("../../../",import.meta.url);
 const [protocol,freeze,tasks,sources]=await Promise.all(["model-protocol.json","FREEZE.json","tasks.json","sources.json"].map(name=>readFile(new URL(`evals/matched-pipeline/${name}`,root),"utf8")));
 const grant={sourceMode:"frozen_supplied_document",protocolSha256:sha256(protocol!),freezeSha256:sha256(freeze!),taskIds:JSON.parse(tasks!).tasks.map((t:{id:string})=>t.id)} as RegisteredPlan["authorization"];
 const registered=registeredPlan(grant,{protocol:protocol!,freeze:freeze!,tasks:tasks!,sources:sources!});
 const documents=await loadFrozenDocuments(registered,new URL("verification/v6/matched-corpus/raw",root).pathname);
 expect([...documents.keys()].sort()).toEqual(["esp32","rfc9112","tmp117"]);
 expect(registered.tasks.filter(t=>t.unavailableReason)).toHaveLength(9);
 for(const task of registered.tasks){expect(task).not.toHaveProperty("references");expect(task).not.toHaveProperty("mandatoryCriteria");}
});
it("rejects duplicate and excessive source lists before reading or uploading bytes",async()=>{
 const p=plan();p.tasks[0]!.sources=[p.tasks[0]!.sources![0]!,p.tasks[0]!.sources![0]!];
 await expect(loadFrozenDocuments(p,tmpdir())).rejects.toThrow("frozen_sources_unregistered");
 p.tasks[0]!.sources=Array.from({length:4},(_,i)=>({...p.tasks[0]!.sources![0]!,id:`doc-${i}`}));
 await expect(loadFrozenDocuments(p,tmpdir())).rejects.toThrow("frozen_sources_unregistered");
});
it("all-unsupported registered frozen tasks exit incomplete before database/session/provider setup",async()=>{
 const {readFile}=await import("node:fs/promises"),{spawnSync}=await import("node:child_process");
 const root=new URL("../../../",import.meta.url),directory=await mkdtemp(join(tmpdir(),"frozen-cli-"));
 try{
 const protocol=await readFile(new URL("evals/matched-pipeline/model-protocol.json",root),"utf8"),freeze=await readFile(new URL("evals/matched-pipeline/FREEZE.json",root),"utf8");
 const approvalId=crypto.randomUUID(),raw=JSON.stringify({version:"matched-evaluation-authorization.v1",approvalId,approvalReference:"local-synthetic-unit-no-paid-approval",issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),protocolSha256:sha256(protocol),freezeSha256:sha256(freeze),taskIds:["MC-D01"],budgetMicro:1000000,accountId:crypto.randomUUID(),budgetScope:"evaluation:unit",sourceMode:"frozen_supplied_document",exclusiveDatabaseAcknowledged:true});
 const auth=join(directory,"authorization.json"),output=join(directory,"output");await writeFile(auth,raw);
 const result=spawnSync(process.execPath,["--import","tsx","src/eval-live.ts","--execute","--operator-confirms-user-approval","--authorization",auth,"--sha256",sha256(raw),"--approval-id",approvalId,"--output",output],{encoding:"utf8",env:{...process.env,EVAL_SESSION_TOKEN:"",OPENROUTER_API_KEY:"",DATABASE_URL:"not-a-database"}});
 expect(result.status).toBe(2);const events=(await readFile(join(output,"receipts.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
 expect(events.filter(e=>e.event==="unrun")).toHaveLength(4);expect(events.filter(e=>e.event==="unrun").every(e=>e.reason==="frozen_source_mime_unsupported")).toBe(true);expect(events.some(e=>e.event==="attempt"||e.event==="admitted"||e.event==="effective_configuration")).toBe(false);
 }finally{await rm(directory,{recursive:true});}
});
