import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createQueue, RESEARCH_QUEUE } from "../adapters/queue.js";

const config = loadConfig();
const problems: string[] = [];
if (!config.databaseUrl) problems.push("DATABASE_URL missing");
const pool = createPool(config.databaseUrl);
try {
  const v = await pool.query<{ v: string }>("SHOW server_version");
  const tables = await pool.query("SELECT to_regclass('public.runs') AS runs");
  if (!tables.rows[0]?.runs) problems.push("runs table missing; run pnpm db:migrate");
  process.stdout.write(`postgres=${v.rows[0]?.v}\n`);
} catch (e) {
  problems.push(`postgres: ${String(e)}`);
}
try {
  const boss = await createQueue(config.databaseUrl);
  await boss.send(RESEARCH_QUEUE, { runId: "00000000-0000-4000-8000-000000000099" }, { startAfter: 60 });
  await boss.stop({ graceful: false, timeout: 2000 });
  process.stdout.write("queue=ok\n");
} catch (e) {
  problems.push(`queue: ${String(e)}`);
}
process.stdout.write(`authMode=${config.authMode}\nfixture=${config.fixtureRouteAllowed}\nlive=${config.liveRouteEnabled}\n`);
if (config.liveRouteEnabled && !config.openRouterApiKey) problems.push("LIVE_ROUTE_ENABLED but OPENROUTER_API_KEY missing");
await pool.end();
if (problems.length) {
  process.stderr.write(problems.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write("doctor=ok\n");
