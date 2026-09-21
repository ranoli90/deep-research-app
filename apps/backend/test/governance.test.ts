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
      "g07-output.integration.test.ts",
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

describe("Norrow Render build context", () => {
  it("excludes local credential directories and private signing keys", () => {
    const repo = join(import.meta.dirname, "../../..");
    const rules = readFileSync(join(repo, ".dockerignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(rules).toContain("**/.credentials");
    expect(rules).toContain("**/*.p8");
    expect(rules.filter((line) => line.startsWith("!") && /\.credentials|\.p8/.test(line))).toEqual([]);
  });
});

// Follow source dependencies, including re-exports and literal dynamic imports.
// Type-only edges are erased and cannot load fixture data into the runtime.
import ts from "typescript";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
function runtimeSources(entry:string):Set<string> {
  const repo=resolve(import.meta.dirname,"../../..");
  const config=ts.readConfigFile(join(repo,"apps/backend/tsconfig.json"),ts.sys.readFile);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,join(repo,"apps/backend"));
  const seen=new Set<string>();
  function visit(file:string) {
    file=realpathSync(file);if(seen.has(file)||file.includes("/node_modules/")||file.endsWith(".d.ts"))return;
    seen.add(file);
    const ast=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
    function edge(spec:string) {
      const resolved=ts.resolveModuleName(spec,file,parsed.options,ts.sys).resolvedModule;
      if(!resolved){if(spec.startsWith(".")||spec.startsWith("@deep/"))throw new Error(`Unresolved source: ${file}: ${spec}`);return;}
      visit(resolved.resolvedFileName);
    }
    function node(n:ts.Node) {
      if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)) {
        const c=n.importClause;
        if(!c?.isTypeOnly && !(c&&!c.name&&c.namedBindings&&ts.isNamedImports(c.namedBindings)&&c.namedBindings.elements.every(x=>x.isTypeOnly)))edge(n.moduleSpecifier.text);
      }
      if(ts.isExportDeclaration(n)&&!n.isTypeOnly&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))edge(n.moduleSpecifier.text);
      if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==="require"))) {
        const arg=n.arguments[0];if(!arg||!ts.isStringLiteral(arg))throw new Error(`Uninspectable runtime import: ${file}`);edge(arg.text);
      }
      ts.forEachChild(n,node);
    }
    node(ast);
  }
  visit(entry);return seen;
}
describe("W05 production runtime isolation",()=>{
  it("API and worker cannot transitively load fixtures, evaluator gold or diagnostic executors",()=>{
    for(const entry of ["api/server.ts","worker/main.ts"]) {
      const files=runtimeSources(resolve(import.meta.dirname,"../src",entry));
      expect(files.size).toBeGreaterThan(20);
      expect([...files].filter(f=>/\/evaluation\//.test(f))).toEqual([]);
      expect([...files].filter(f=>/\/fixtures\/|\/eval[^/]*\.|fixture-catalog|\/adapters\/[^/]+\/fixture\.|diagnostic-executor|diagnostic-main/.test(f))).toEqual([]);
      if(entry==="worker/main.ts")expect([...files].some(f=>f.endsWith("/worker/structured-research.ts"))).toBe(true);
    }
  }, 30_000);
  it("the explicit historical diagnostic is detected as reaching fixture data",()=>{
    const files=runtimeSources(resolve(import.meta.dirname,"../src/worker/diagnostic-main.ts"));
    expect([...files].some(f=>f.endsWith("/fixture-catalog.ts"))).toBe(true);
  }, 30_000);
});
