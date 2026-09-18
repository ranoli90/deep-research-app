# Evaluation scoped instructions

Root AGENTS.md applies; these rules cannot weaken it.

**Current status:** Fixture harness lives in `apps/backend/src/eval-benchmark.ts` (`pnpm eval:fixture`). Twelve labeled families, gold packets, baseline vs adaptive, and ablations are fixture-class only (`verification/benchmark-fixture.json`). Draft seed cases in `evals/cases/review_seed_cases.json` remain unvalidated. No competitor A/B. One live adaptive smoke is recorded separately and is not this harness. Portfolio eval (`apps/backend/src/evaluation/portfolio-eval.ts`) stores dated candidate scores and must not claim routing superiority. Live semantic task classes share `eval:live` explicit-authorization fail-closed gates; fixture scores are not quality proof.

Keep development/heldout/gold/evaluation data distinct. Do not expose reference answers to generator tools. Register prompt/model/provider/plan/date/budget and grading methods. Judge factual support from sources, not prose confidence. Never relabel synthetic specs as user studies. Report exclusions, failures, repeats and uncertainty; no post-hoc lowered threshold.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook.
