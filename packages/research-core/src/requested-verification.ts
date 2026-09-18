import type { ScopedSupportResult } from "./scoped-support.js";
/** A scoped evidence outcome, never a claim of universal or independently adjudicated truth. */
export function requestedVerificationOutcome(check:ScopedSupportResult){
 if(check.decision==="supported")return "supported_in_inspected_evidence" as const;
 if(check.decision==="contradicted"||check.counterEvidence.some(e=>e.decision==="contradicts"))return "contradicted_in_inspected_evidence" as const;
 if(check.decision==="partially_supported"||check.counterEvidence.some(e=>e.decision==="qualifies"))return "qualification_needed" as const;
 return "unresolved" as const;
}
