import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const cases = JSON.parse(readFileSync(join(root, "evals/cases/review_seed_cases.json"), "utf8")) as {
  id: string;
  status: string;
  human_validated: boolean;
  executed: boolean;
}[];

process.stdout.write(
  JSON.stringify(
    {
      mode: "fixture-development",
      benchmark: false,
      note: "Seed cases are draft and not validated. This command does not score them or treat them as competitive evidence. Run pnpm test:integration for labeled fixture behavior.",
      cases: cases.map((c) => ({
        id: c.id,
        status: c.status,
        human_validated: c.human_validated,
        executed: c.executed,
      })),
    },
    null,
    2,
  ) + "\n",
);
