import {it,expect} from "vitest";
import {reconciliationOutcome} from "../src/worker/document-reconciliation.js";
import type {ScopedSupportResult} from "@deep/research-core";
const check=(decision:ScopedSupportResult["decision"],modelStatus:ScopedSupportResult["modelStatus"])=>({decision,modelStatus}) as ScopedSupportResult;
it("ENG-025 never promotes missing, partial or negative semantic assessments to confirmation",()=>{
 expect(reconciliationOutcome(undefined,0)).toBe("unverifiable");
 expect(reconciliationOutcome(check("supported","contradicted"),0)).toBe("unverifiable");
 expect(reconciliationOutcome(check("supported","partially_supported"),0)).toBe("partially_confirmed");
 expect(reconciliationOutcome(check("supported","supported"),0)).toBe("confirmed");
 expect(reconciliationOutcome(check("out_of_scope","supported"),0)).toBe("unverifiable");
 expect(reconciliationOutcome(check("contradicted","contradicted"),0)).toBe("contradicted");
});
it("ENG-026 discloses omitted public evidence as incomplete reconciliation",()=>{
 expect(reconciliationOutcome(check("supported","supported"),1)).toBe("partially_confirmed");
});
