import type { Constraint, ConstraintProvenance } from "@deep/contracts";

/** Map persisted origin onto the four-way provenance labels. Never treat inferred as user-provided. */
export function provenanceFromOrigin(origin: Constraint["origin"]): ConstraintProvenance {
  if (origin === "explicit" || origin === "confirmed") return "user_provided";
  if (origin === "document") return "document_derived";
  if (origin === "system") return "system_generated";
  return "model_inferred";
}

export function constraintProvenance(constraint: Constraint): ConstraintProvenance {
  return constraint.provenance ?? provenanceFromOrigin(constraint.origin);
}

export function isUserRequirement(constraint: Constraint): boolean {
  return constraintProvenance(constraint) === "user_provided" && constraint.importance === "hard";
}
