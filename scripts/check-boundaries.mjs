#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "android", "ios", ".expo"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function importsOf(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const specs = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { src, specs };
}

const coreForbidden = /^(fastify|pg|pg-boss|react-native|expo|openai|@openrouter|express|undici)$/;
for (const file of walk(join(root, "packages/research-core"))) {
  const { specs } = importsOf(file);
  for (const s of specs) {
    if (coreForbidden.test(s) || s.startsWith("react-native") || s.startsWith("expo")) {
      failures.push(`${relative(root, file)} imports ${s}`);
    }
  }
}

const mobileForbidden = /^(pg|pg-boss|fastify|openai)$/;
for (const file of walk(join(root, "apps/mobile"))) {
  const { src, specs } = importsOf(file);
  if (/OPENROUTER_API_KEY|DATABASE_URL/.test(src) && !/EXPO_PUBLIC_/.test(src)) {
    failures.push(`${relative(root, file)} mentions a server secret name`);
  }
  for (const s of specs) {
    if (mobileForbidden.test(s)) failures.push(`${relative(root, file)} imports ${s}`);
  }
}

if (failures.length) {
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write("boundaries=ok\n");
