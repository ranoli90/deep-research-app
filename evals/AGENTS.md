# Evaluation scoped instructions

Root AGENTS.md applies; these rules cannot weaken it.

**Current status:** Fixture harness lives in `apps/backend/src/eval-benchmark.ts` (`pnpm eval:fixture`). Twelve labeled families, gold packets, baseline vs adaptive, and ablations are fixture-class only (`verification/benchmark-fixture.json`). Draft seed cases in `evals/cases/review_seed_cases.json` remain unvalidated. No competitor A/B. One live adaptive smoke is recorded separately and is not this harness.

Keep development/heldout/gold/evaluation data distinct. Do not expose reference answers to generator tools. Register prompt/model/provider/plan/date/budget and grading methods. Judge factual support from sources, not prose confidence. Never relabel synthetic specs as user studies. Report exclusions, failures, repeats and uncertainty; no post-hoc lowered threshold. Fixture scores are not live quality. Do not claim a routing or model is better without the registered protocol and receipts. Live semantic spend is the authorized CLI; the in-process grant loop must not expand past granted task classes.

Use verification/COMMANDS.json to distinguish available and proposed checks. Update the owning canonical spec with behavior changes, not a duplicate local handbook.
