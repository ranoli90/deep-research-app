import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe("V2-15 forbidden imports", () => {
  it("research-core does not import HTTP, mobile, or vendor SDKs", () => {
    const root = join(import.meta.dirname, "../../../packages/research-core");
    const files = walk(root);
    expect(files.length).toBeGreaterThan(0);
    const forbidden = /from ['"](fastify|pg|pg-boss|react-native|expo|openai|@openrouter|node:http|undici)['"]/;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src.match(forbidden), f).toBeNull();
    }
  });

  it("mobile bundle does not contain provider secrets or server SDKs", () => {
    const root = join(import.meta.dirname, "../../../apps/mobile");
    const files = walk(root);
    const forbidden = /OPENROUTER_API_KEY|from ['"]pg['"]|from ['"]pg-boss['"]|from ['"]fastify['"]/;
    for (const f of files) {
      if (f.includes("node_modules")) continue;
      const src = readFileSync(f, "utf8");
      expect(src.match(forbidden), f).toBeNull();
    }
  });
});

describe("V2-16 test weakening", () => {
  it("P0 smoke and launch-scope files do not skip or xit cases", () => {
    const dir = join(import.meta.dirname, ".");
    for (const name of [
      "p0-smoke.integration.test.ts",
      "launch-scope.integration.test.ts",
      "p3-remaining.integration.test.ts",
      "g01-g02.integration.test.ts",
      "p4-recovery.integration.test.ts",
      "g06-cost.integration.test.ts",
    ]) {
      const src = readFileSync(join(dir, name), "utf8");
      expect(src).not.toMatch(/\bit\.skip\(|\bxit\(|\bdescribe\.skip\(/);
    }
  });
});

describe("V2-17 command readiness", () => {
  it("implemented_application_command entries point at real files", () => {
    const repo = join(import.meta.dirname, "../../..");
    const commands = JSON.parse(readFileSync(join(repo, "verification/COMMANDS.json"), "utf8")) as {
      command: string;
      status: string;
      implementation: string;
    }[];
    for (const c of commands) {
      if (c.status !== "implemented_application_command" && c.status !== "implemented_review_tool") continue;
      const parts = c.implementation.split("#")[0]!.split(",").map((p) => p.trim());
      for (const impl of parts) {
        const concrete = impl.replace(/\*.*$/, "");
        expect(existsSync(join(repo, concrete)), `${c.command} -> ${impl}`).toBe(true);
      }
    }
    expect(commands.some((c) => c.status === "proposed" && /verified/.test(c.status))).toBe(false);
  });
});
