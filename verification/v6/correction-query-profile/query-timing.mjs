// Diagnostic only. Never imported by application runtime. No SQL parameter values retained.
import pg from "pg";
import { afterAll } from "vitest";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
const output = process.env.PG_QUERY_TIMING_PATH;
if (!output) throw Error("PG_QUERY_TIMING_PATH_required");
const samples = new Map();
const original = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
  if (typeof sql !== "string") return original.apply(this, args);
  const fingerprint = createHash("sha256").update(sql).digest("hex");
  if (!samples.has(fingerprint)) samples.set(fingerprint, {
    fingerprint,
    // Only a sanitized SQL template, never parameter arrays/results/errors.
    template: sql.replace(/'(?:''|[^'])*'/g, "'<literal>'").replace(/\b\d+\b/g, "<number>").replace(/\s+/g, " ").trim(),
    origin: new Error().stack?.split("\n").filter(line => line.includes("/apps/backend/src/")).slice(0, 4),
    calls: 0, errors: 0, totalMs: 0, maxMs: 0,
  });
  const sample = samples.get(fingerprint), start = performance.now();
  let finished = false;
  const finish = error => {
    if (finished) return;
    finished = true;
    const elapsed = performance.now() - start;
    sample.calls++; sample.errors += Number(Boolean(error)); sample.totalMs += elapsed; sample.maxMs = Math.max(sample.maxMs, elapsed);
  };
  const callbackIndex = args.length - 1;
  if (typeof args[callbackIndex] === "function") {
    const callback = args[callbackIndex];
    args[callbackIndex] = function (...result) { finish(result[0]); return callback.apply(this, result); };
  }
  try {
    const result = original.apply(this, args);
    if (result && typeof result.then === "function") return result.then(value => { finish(false); return value; }, error => { finish(true); throw error; });
    return result;
  } catch (error) { finish(true); throw error; }
};
const flush = () => writeFileSync(`${output}.${process.pid}.json`, JSON.stringify({
  evidenceClass: "diagnostic client query elapsed time; includes queue/network/parse/plan/execute; does not independently isolate server planning or execution",
  parametersRecorded: false, resultsRecorded: false,
  queries: [...samples.values()].sort((a, b) => b.totalMs - a.totalMs),
}, null, 2) + "\n");
afterAll(flush);
process.once("exit", flush);
