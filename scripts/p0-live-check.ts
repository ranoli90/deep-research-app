/**
 * Authorized live P0-L check. Requires OPENROUTER_API_KEY and LIVE_SPEND_CAP_MICRO>0.
 * Does not print secrets. Stops after one run + one correction or if remaining cap is too low.
 */
import { spawn, type ChildProcess } from "node:child_process";

const MICRO_PER_USD = 1_000_000;

const API = process.env.API_URL ?? "http://127.0.0.1:8787";
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
      DEV_ALLOW_FIXTURE_ROUTE: "true",
      APP_AUTH_MODE: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[${name}] ${String(d).replace(/sk-or-v1-[A-Za-z0-9]+/g, "sk-or-v1-[redacted]")}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${name}] ${String(d).replace(/sk-or-v1-[A-Za-z0-9]+/g, "sk-or-v1-[redacted]")}`));
  return child;
}

async function waitTerminal(headers: Record<string, string>, runId: string, timeoutMs = 180_000) {
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
      liveRetrieval: true,
    }) + "\n",
  );

  const api = start("src/api/server.ts");
  const worker = start("src/worker/main.ts");
  try {
    const health = await waitHealth();
    const session = await json(await fetch(`${API}/v1/dev/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
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
    const citationIds: string[] = (report?.blocks ?? []).flatMap((b: { citationIds?: string[] }) => b.citationIds ?? []);
    const sources = [];
    for (const id of citationIds.slice(0, 8)) {
      const srcRes = await fetch(`${API}/v1/sources/${id}`, { headers });
      const body = await json(srcRes);
      sources.push({
        ok: srcRes.ok,
        id: String(id).slice(0, 8),
        title: body.title,
        locator: body.locator,
        accessLevel: body.accessLevel,
        textChars: typeof body.exactText === "string" ? body.exactText.length : 0,
        http: typeof body.locator === "string" && body.locator.startsWith("http"),
      });
    }

    let correction: Record<string, unknown> | null = null;
    const remainingAfterFirst = cap; // worker-enforced; still attempt correction unless create is denied
    const corr = await json(
      await fetch(`${API}/v1/runs/${runId}/corrections`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ expectedBriefRevision: snap.brief?.revision ?? 1, correctionText: "Actually, the budget is 120 EUR" }),
      }),
    );
    if (!corr.code && corr.runId) {
      const child = await waitTerminal(headers, corr.runId as string);
      const childReport = child.reportId ? await json(await fetch(`${API}/v1/reports/${child.reportId}`, { headers })) : null;
      correction = {
        runId: child.runId,
        outcome: child.outcome,
        reportId: child.reportId ?? null,
        limitations: childReport?.limitations ?? [],
        blockCount: childReport?.blocks?.length ?? 0,
      };
    } else {
      correction = { blocked: true, body: corr };
    }

    process.stdout.write(
      JSON.stringify(
        {
          ok: Boolean(report && sources.some((s) => s.ok && s.textChars > 0)),
          health,
          runId,
          outcome: snap.outcome,
          reportId: snap.reportId ?? null,
          eventTypes: (events.events ?? []).map((e: { type: string }) => e.type),
          citationCount: citationIds.length,
          sources,
          correction,
          remainingAfterFirstUsdHint: remainingAfterFirst / MICRO_PER_USD,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    api.kill("SIGTERM");
    worker.kill("SIGTERM");
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
