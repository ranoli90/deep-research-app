/**
 * Smallest useful live adaptive smoke. One consented controlled-research run.
 * Does not run a correction. Requires OPENROUTER_API_KEY and LIVE_SPEND_CAP_MICRO>0.
 */
import { spawn, type ChildProcess } from "node:child_process";

const MICRO_PER_USD = 1_000_000;
const PORT = "8791";
const API = `http://127.0.0.1:${PORT}`;
const cwd = new URL("../apps/backend", import.meta.url);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  throw new Error("API did not become healthy");
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-json ${res.status}: ${text.slice(0, 300)}`);
  }
}

function start(name: string): ChildProcess {
  const child = spawn("pnpm", ["exec", "tsx", name], {
    cwd: cwd.pathname,
    env: {
      ...process.env,
      LIVE_ROUTE_ENABLED: "true",
      LIVE_RETRIEVAL_ENABLED: "true",
      LIVE_CONTROLLER_KIND: "adaptive",
      DEV_ALLOW_FIXTURE_ROUTE: "true",
      APP_AUTH_MODE: "development",
      API_PORT: PORT,
      API_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) =>
    process.stderr.write(`[${name}] ${String(d).replace(/sk-or-v1-[A-Za-z0-9]+/g, "sk-or-v1-[redacted]")}`),
  );
  child.stderr?.on("data", (d) =>
    process.stderr.write(`[${name}] ${String(d).replace(/sk-or-v1-[A-Za-z0-9]+/g, "sk-or-v1-[redacted]")}`),
  );
  return child;
}

async function waitTerminal(headers: Record<string, string>, runId: string, timeoutMs = 300_000) {
  const startWait = Date.now();
  while (Date.now() - startWait < timeoutMs) {
    const snap = await json(await fetch(`${API}/v1/runs/${runId}`, { headers }));
    if (snap.lifecycle === "terminal") return snap;
    await sleep(1500);
  }
  throw new Error(`run ${runId} did not reach terminal`);
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
  const cap = Number(process.env.LIVE_SPEND_CAP_MICRO ?? 0);
  if (!(cap > 0)) throw new Error("LIVE_SPEND_CAP_MICRO must be > 0");
  process.stdout.write(
    JSON.stringify({
      phase: "preflight",
      capMicro: cap,
      capUsd: cap / MICRO_PER_USD,
      model: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
      controllerKind: "adaptive",
      liveRetrieval: true,
    }) + "\n",
  );

  const api = start("src/api/server.ts");
  const worker = start("src/worker/main.ts");
  try {
    const health = await waitHealth();
    process.stderr.write(`health=${JSON.stringify(health)}\n`);
    const session = await json(
      await fetch(`${API}/v1/dev/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    );
    const token = session.token as string;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    await fetch(`${API}/v1/consent`, { method: "POST", headers, body: JSON.stringify({ grant: true }) });

    const created = await json(
      await fetch(`${API}/v1/runs`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          question: "Compare managed Postgres options in Germany under 50 EUR per month as of 2026-03-01. Prefer vendor docs.",
          routeMode: "controlled-research",
        }),
      }),
    );
    if (created.code) throw new Error(`create failed: ${JSON.stringify(created)}`);
    const runId = created.runId as string;
    const snap = await waitTerminal(headers, runId);
    const report = snap.reportId ? await json(await fetch(`${API}/v1/reports/${snap.reportId}`, { headers })) : null;
    const events = await json(await fetch(`${API}/v1/runs/${runId}/events?after=0`, { headers }));
    const eventTypes: string[] = (events.events ?? []).map((e: { type: string }) => e.type);
    const actions = eventTypes.filter((t) =>
      ["searched", "opened_source", "source_pivot", "verify", "challenge", "stop_policy", "published", "action_rejected"].includes(t),
    );
    const citationIds: string[] = (report?.blocks ?? []).flatMap((b: { citationIds?: string[] }) => b.citationIds ?? []);
    const httpPassages = [];
    for (const id of citationIds.slice(0, 6)) {
      const srcRes = await fetch(`${API}/v1/sources/${id}`, { headers });
      const body = await json(srcRes);
      httpPassages.push({
        ok: srcRes.ok,
        id: String(id).slice(0, 8),
        locator: body.locator,
        accessLevel: body.accessLevel,
        textChars: typeof body.exactText === "string" ? body.exactText.length : 0,
        http: typeof body.locator === "string" && String(body.locator).startsWith("http"),
      });
    }

    const distinct = [...new Set(actions)];
    const adapted = actions.includes("challenge") || actions.includes("verify") || actions.includes("source_pivot") || actions.filter((t) => t === "searched").length > 1;
    const result = {
      ok: Boolean(report && httpPassages.some((s) => s.ok && s.textChars > 0 && s.http)),
      adapted,
      runId,
      outcome: snap.outcome,
      reportId: snap.reportId ?? null,
      eventTypes,
      actionTrace: actions,
      distinctActionTypes: distinct,
      citationCount: citationIds.length,
      httpPassages,
      controllerKind: "adaptive",
      evidenceClass: "live",
    };
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.ok) process.exit(1);
  } finally {
    api.kill("SIGTERM");
    worker.kill("SIGTERM");
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
