/** Test-only native UI harness: actual local API/worker/parser, fabricated model transport.
 * Never import from runtime. It has no real provider credential or external fetch fallback.
 */
import { buildApp } from "../src/api/app.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";
import { createQueue } from "../src/adapters/queue.js";
import { processRun } from "../src/worker/executor.js";
const databaseUrl = "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_native_v6";
const pool = createPool(databaseUrl);
await migrate(pool);
const boss = await createQueue(databaseUrl);
const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, APP_AUTH_MODE: "development", DEV_ALLOW_FIXTURE_ROUTE: "false", WRITING_CANCEL_WINDOW_MS: "1", LIVE_ROUTE_ENABLED: "true", STRUCTURED_MODEL_ENABLED: "true", OPENROUTER_API_KEY: "nonbillable-native-control", LIVE_SPEND_CAP_MICRO: "1000000000", LIVE_KEY_SPEND_CAP_MICRO: "1000000000", LIVE_BUDGET_SCOPE: crypto.randomUUID() });
const scope = { entity: null, plan: null, version: null, geography: null, time: null, population: null };
let fabricatedCalls = 0;
const reply = (output: unknown) => new Response(JSON.stringify({ id: `nonbillable-native-${++fabricatedCalls}`, model: "openai/gpt-4o-mini", provider: "OpenAI", usage: { cost: "0.000001" }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }), { status: 200 });
globalThis.fetch = async (input, init) => {
  if (String(input) !== "https://openrouter.ai/api/v1/chat/completions") throw new Error("Native control rejects all unexpected external requests");
  const body = JSON.parse(String(init?.body));
  if (body.plugins?.length) throw new Error("Native control does not permit public discovery");
  const context = JSON.parse(body.messages[1].content), operation = body.response_format.json_schema.name;
  if (operation === "research_brief_v1") {
    const provenance = { start: 0, end: context.question.length, quote: context.question };
    return reply({ objective: context.question, objectiveProvenance: provenance, intendedOutput: "Document-grounded answer", criteria: [{ key: "recording", description: "Recording support described in the document", field: "recording", operator: "explain", value: null, unit: null, importance: "hard", scope, provenance, group: "g", groupOperator: "all", unresolvedAlternatives: [] }], questions: [{ key: "q", text: context.question, criterionKeys: ["recording"], importance: "critical", evidenceStandard: "Explicit statement in the supplied document" }], assumptions: [], openAmbiguities: [], explicitExclusions: [] });
  }
  if (operation === "research_extract_assertions_v1") {
    const sentence = context.question.includes("firmware") ? "Ardent supports offline recording only on firmware 4.2." : "Ardent does not support underwater recording.";
    const p = context.passages.find((p: { text: string }) => p.text.includes(sentence));
    if (!p) throw new Error("Actual extraction did not contain the synthetic native control statement");
    const start = p.text.indexOf(sentence);
    return reply({ candidates: [], assertions: [{ key: "recording", candidateKey: null, criterionKeys: ["recording"], text: sentence, scope, quantities: [], evidence: [{ passageId: p.id, start, end: start + sentence.length, quote: sentence }] }], limitations: [] });
  }
  if (operation === "research_assess_support_v1") return reply({ assessments: context.assertions.map((a: { key: string; scope: unknown; evidence: unknown }) => ({ claimKey: a.key, status: "supported", scope: a.scope, evidence: a.evidence, rationale: "Fabricated native UI control; not semantic validation", missingEvidence: [] })) });
  if (operation === "research_review_coverage_v1") return reply({ questions: [{ questionKey: "q", status: "supported", assertionKeys: context.approvedClaimKeys, reason: "Fabricated native UI control" }], omittedRequirements: [] });
  if (operation === "research_write_report_v1") return reply({ title: "Document finding", sections: [{ heading: "Evidence", paragraphs: [{ text: context.assertions[0].text, claimKeys: [context.assertions[0].key] }] }], unresolvedQuestionKeys: [], limitations: [] });
  throw new Error(`Unexpected native model operation: ${operation}`);
};
const app = await buildApp({ pool, boss, config });
const sessions = new Map<string, string>();
app.addHook("onSend", async (request, _reply, payload) => {
  if (request.url === "/v1/dev/session" && typeof payload === "string") {
    const session = JSON.parse(payload);
    if (session.accountId && session.token) sessions.set(session.accountId, session.token);
  }
  return payload;
});
let busy = false, stopping = false;
const attempted = new Set<string>();
const poll = setInterval(async () => {
  if (busy || stopping || !sessions.size) return;
  busy = true;
  try {
    const { rows } = await pool.query("SELECT id FROM runs WHERE account_id=ANY($1::uuid[]) ORDER BY created_at", [[...sessions.keys()]]);
    for (const row of rows) {
      if (attempted.has(row.id)) continue;
      attempted.add(row.id);
      await processRun(pool, config, row.id);
      const report = await pool.query("SELECT id,outcome FROM reports WHERE run_id=$1", [row.id]);
      console.info(JSON.stringify({ event: "native_control_run", runId: row.id, reports: report.rows, fabricatedCalls, paidCalls: 0 }));
    }
  } catch (error) { console.error(error instanceof Error ? error.message : "Native worker failed"); }
  finally { busy = false; }
}, 500);
await app.listen({ host: "127.0.0.1", port: 8787 });
console.info(JSON.stringify({ event: "native_control_ready", evidenceClass: "native_ui_actual_api_worker_pdf_fabricated_model", paidCalls: 0, database: "deep_research_native_v6", fixtureRoute: false }));
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(poll);
  while (busy) await new Promise(resolve => setTimeout(resolve, 100));
  for (const token of sessions.values()) {
    const response = await app.inject({ method: "POST", url: "/v1/account/deletion", headers: { authorization: `Bearer ${token}` } });
    if (![200, 401].includes(response.statusCode)) console.error(`Native test account cleanup failed: ${response.statusCode}`);
  }
  await app.close(); await boss.stop({ graceful: false, timeout: 2000 }); await pool.end();
  console.info(JSON.stringify({ event: "native_control_stopped", createdAccounts: sessions.size, fabricatedCalls, paidCalls: 0 }));
}
process.on("SIGINT", () => { void stop(); });
process.on("SIGTERM", () => { void stop(); });
