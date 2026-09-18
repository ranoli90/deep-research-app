import { expect,it } from "vitest";
import { ModelContextSchema,MODEL_CONTEXT_MAX_PASSAGES } from "../src/ports/model.js";
import { prepareModelRequest } from "../src/adapters/model/openrouter.js";
import { STRUCTURED_MODEL_POLICY,STRUCTURED_CALL_RESERVE_MICRO } from "../src/ports/model-policy.js";
const context=(count:number,length=50)=>({question:"Explain documented restrictions.",task:null,passages:Array.from({length:count},()=>({id:crypto.randomUUID(),sourceVersionId:crypto.randomUUID(),digest:"a".repeat(64),accessLevel:"partial-text",text:"x".repeat(length)})),sources:[],assertions:[],approvedClaimKeys:[],draft:null});
it("W02 bounded capacity keeps each entire passage, pricing and serialized request limits",()=>{
 expect(MODEL_CONTEXT_MAX_PASSAGES).toBe(128);const input=context(128),request=prepareModelRequest("extract_assertions",input),body=JSON.parse(request.body);
 expect(JSON.parse(body.messages[1].content).passages).toEqual(input.passages);expect(Buffer.byteLength(request.body)).toBeLessThanOrEqual(STRUCTURED_MODEL_POLICY.contextTokens);
 expect(body.max_tokens).toBe(4096);expect(body.provider.max_price).toEqual({prompt:0.15,completion:0.6,request:0});expect(STRUCTURED_CALL_RESERVE_MICRO).toBe(21658);
 expect(ModelContextSchema.safeParse(context(129)).success).toBe(false);expect(ModelContextSchema.safeParse(context(1,24001)).success).toBe(false);
 expect(()=>prepareModelRequest("extract_assertions",context(25,7000))).toThrow("model_context_exceeds_policy");
 expect(()=>prepareModelRequest("extract_assertions",context(25,11000))).toThrow("model_context_too_large");
});
