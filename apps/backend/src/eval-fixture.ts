import { runAblations, runFixtureBenchmark } from "./eval-benchmark.js";

const result = runFixtureBenchmark();
const ablations = runAblations("conflicting-nimbus");
process.stdout.write(
  JSON.stringify(
    {
      ...result,
      competitorComparison: "not_run",
      not_competitor_comparison: true,
      ablations: Object.fromEntries(
        Object.entries(ablations).map(([k, v]) => [
          k,
          { pivots: v.pivots, goldLocatorsFetched: v.goldLocatorsFetched, actions: v.actions, unknownCitations: v.unknownCitations },
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
