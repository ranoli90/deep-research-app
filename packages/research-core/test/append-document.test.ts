import { expect,it } from "vitest";
import { ResearchCorrectionPatchSchema,type ResearchCorrectionPatch } from "@deep/contracts";
import { applyQuestionPatch } from "../src/question-patch.js";
const id="aaaaaaaa-0000-4000-8000-000000000001";
const input={kind:"append_attachments",attachmentIds:[id],evidencePolicy:"reuse_snapshot"};
it("W06 accepts an explicit document append while preserving the exact original question",()=>{
 const patch=ResearchCorrectionPatchSchema.parse(input);expect(patch).toEqual(input);
 expect(applyQuestionPatch(" Exact original 🧭 question ","a".repeat(64),patch)).toBe(" Exact original 🧭 question ");
});
it("W03 document append rejects empty/duplicate/oversized/foreign authority/implicit rewrite/refresh inputs",()=>{
 for(const change of [{attachmentIds:[]},{attachmentIds:[id,id]},{attachmentIds:[id,id.toUpperCase()]},{attachmentIds:[id,id,id,id]},{attachmentIds:["bad"]},{question:"Replacement"},{removeAttachmentIds:[id]},{accountId:id},{evidencePolicy:"refresh"}])expect(ResearchCorrectionPatchSchema.safeParse({...input,...change}).success).toBe(false);
});
