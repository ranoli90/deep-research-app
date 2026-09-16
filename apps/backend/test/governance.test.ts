import { readFileSync, readdirSync, statSync } from "node:fs";
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
