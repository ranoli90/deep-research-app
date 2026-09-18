import type { RouteCapabilities } from "../model-governor/portfolio.js";

export const PORTFOLIO_EVAL_VERSION = "model-portfolio-eval.v1";

export type PortfolioEvalCase = {
  operation: string;
  input: unknown;
  validate: (output: unknown) => { validity: boolean; schemaOk: boolean; refused: boolean };
};

export type PortfolioEvalExecuteResult = {
  output?: unknown;
  refused?: boolean;
  latencyMs: number;
  actualMicro: number | null;
};

export type PortfolioEvalRecord = {
  datedAt: string;
  portfolioEvalVersion: typeof PORTFOLIO_EVAL_VERSION;
  candidatePolicyId: string;
  operation: string;
  validity: boolean;
  schemaOk: boolean;
  refused: boolean;
  latencyMs: number;
  actualMicro: number | null;
  superiorityClaim: false;
};

export type PortfolioEvalReport = {
  datedAt: string;
  portfolioEvalVersion: typeof PORTFOLIO_EVAL_VERSION;
  records: PortfolioEvalRecord[];
  superiorityClaim: false;
  note: "No claim that dynamic routing is better until measured on live tasks.";
};

/** Score registered candidates on identical inputs. Never asserts a winner. */
export function runPortfolioEvaluation(args: {
  candidates: RouteCapabilities[];
  cases: PortfolioEvalCase[];
  execute: (candidate: RouteCapabilities, input: unknown) => PortfolioEvalExecuteResult;
  now?: Date;
}): PortfolioEvalReport {
  const datedAt = (args.now ?? new Date()).toISOString();
  const records: PortfolioEvalRecord[] = [];
  for (const candidate of args.candidates) {
    for (const testCase of args.cases) {
      const executed = args.execute(candidate, testCase.input);
      const judged = testCase.validate(executed.output);
      records.push({
        datedAt,
        portfolioEvalVersion: PORTFOLIO_EVAL_VERSION,
        candidatePolicyId: candidate.policyId,
        operation: testCase.operation,
        validity: judged.validity,
        schemaOk: judged.schemaOk,
        refused: judged.refused || Boolean(executed.refused),
        latencyMs: executed.latencyMs,
        actualMicro: executed.actualMicro,
        superiorityClaim: false,
      });
    }
  }
  return {
    datedAt,
    portfolioEvalVersion: PORTFOLIO_EVAL_VERSION,
    records,
    superiorityClaim: false,
    note: "No claim that dynamic routing is better until measured on live tasks.",
  };
}
