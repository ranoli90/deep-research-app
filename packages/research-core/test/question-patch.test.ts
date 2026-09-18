import { expect,it } from "vitest";
import { ResearchCorrectionPatchSchema,type ResearchCorrectionPatch } from "@deep/contracts";
import { applyQuestionPatch } from "../src/question-patch.js";
const digest="a".repeat(64),question="Compare 😀 tools below €40 in Germany.";
const start=question.indexOf("€40");
const patch={kind:"replace_question_span" as const,originalQuestionSha256:digest,start,end:start+3,quote:"€40",replacement:"€70",evidencePolicy:"reuse_snapshot" as const};
it("W06 replaces only the explicitly quoted UTF-16 span without implicit normalization or appended notes",()=>{
 expect(applyQuestionPatch(question,digest,patch)).toBe("Compare 😀 tools below €70 in Germany.");
 expect(applyQuestionPatch(question,digest,{...patch,replacement:""})).toBe("Compare 😀 tools below  in Germany.");
 expect(applyQuestionPatch(question,digest,{...patch,start:0,end:0,quote:"",replacement:"Please "})).toBe(`Please ${question}`);
});
it("W06 rejects mismatched original digests and same-length wrong quotes",()=>{
 expect(()=>applyQuestionPatch(question,"b".repeat(64),patch)).toThrow("digest_mismatch");
 expect(()=>applyQuestionPatch(question,digest,{...patch,quote:"€50"})).toThrow("quote_mismatch");
});
it("W06 rejects reversed and outside spans without editing another occurrence",()=>{
 for(const span of [{start:patch.end,end:patch.start},{start:0,end:20000}])expect(()=>applyQuestionPatch(question,digest,{...patch,...span})).toThrow("invalid_span");
 expect(applyQuestionPatch("40 then 40",digest,{...patch,start:8,end:10,quote:"40",replacement:"70"})).toBe("40 then 70");
});
it("W06 rejects surrogate splits and malformed original/replacement while accepting whole Unicode characters",()=>{
 const emoji=question.indexOf("😀");
 for(const span of [{start:emoji,end:emoji+1,quote:"\ud83d"},{start:emoji+1,end:emoji+2,quote:"\ude00"}])expect(()=>applyQuestionPatch(question,digest,{...patch,...span})).toThrow("invalid_unicode");
 expect(()=>applyQuestionPatch(question,digest,{...patch,replacement:"\ud83d"})).toThrow("invalid_unicode");
 expect(()=>applyQuestionPatch("a\ude00",digest,{...patch,start:0,end:1,quote:"a"})).toThrow("invalid_unicode");
 expect(applyQuestionPatch(question,digest,{...patch,start:emoji,end:emoji+2,quote:"😀",replacement:"🧭"})).toContain("🧭");
});
it("W06 rejects empty or oversized resulting questions",()=>{
 for(const replacement of ["","  "])expect(()=>applyQuestionPatch("Q",digest,{...patch,start:0,end:1,quote:"Q",replacement})).toThrow("invalid_result");
 expect(()=>applyQuestionPatch("x".repeat(20000),digest,{...patch,start:0,end:1,quote:"x",replacement:"xx"})).toThrow("invalid_result");
});
it("W06 strict boundary rejects authority, implicit question replacement, malformed hashes and fractional offsets",()=>{
 for(const change of [{accountId:"foreign"},{question:"ignored authority"},{originalQuestionSha256:"A".repeat(64)},{start:1.5}])expect(ResearchCorrectionPatchSchema.safeParse({...patch,...change}).success).toBe(false);
});
it("W06 whole-question replacement retains its existing exact behavior",()=>{
 const whole:ResearchCorrectionPatch={kind:"replace_question",question:" New question ",evidencePolicy:"refresh"};
 expect(applyQuestionPatch(question,digest,whole)).toBe(" New question ");
});
