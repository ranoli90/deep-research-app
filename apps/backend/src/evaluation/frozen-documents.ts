import {readFile,realpath,stat} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {sha256,type RegisteredPlan,type FrozenSource} from "./authorization.js";
import {validateAttachmentBytes} from "../modules/attachments.js";
export type FrozenDocuments=ReadonlyMap<string,{source:FrozenSource;bytes:Buffer}>;
/** Exact frozen input only. No extraction, source authority or evaluator labels are synthesized. */
export async function loadFrozenDocuments(plan:RegisteredPlan,directory:string):Promise<FrozenDocuments>{
 const documents=new Map<string,{source:FrozenSource;bytes:Buffer}>();
 if(plan.authorization.sourceMode!=="frozen_supplied_document")return documents;
 const root=await realpath(directory);
 for(const task of plan.tasks){
  if(task.unavailableReason)continue;
  if(!task.sources?.length||task.sources.length>3||new Set(task.sources.map(s=>s.id)).size!==task.sources.length)throw new Error("frozen_sources_unregistered");
  for(const source of task.sources){
   const path=await realpath(resolve(root,source.file));
   if(dirname(path)!==root||source.mime!=="application/pdf"||(await stat(path)).size>8*1024*1024)throw new Error("frozen_document_invalid");
   const bytes=await readFile(path);
   validateAttachmentBytes(bytes,source.mime,source.file);
   if(sha256(bytes)!==source.sha256)throw new Error("frozen_document_digest_mismatch");
   documents.set(source.id,{source,bytes});
  }
 }
 return documents;
}
