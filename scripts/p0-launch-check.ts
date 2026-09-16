/**
 * Real API + worker launch against local Postgres/queue.
 * Asserts a consented run, persisted evidence, and citations that resolve.
 */
import { spawn, type ChildProcess } from "node:child_process";

const API = process.env.API_URL ?? "http://127.0.0.1:8787";
const cwd = new URL("../apps/backend", import.meta.url);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${API}/health`);
      if (r.ok) return;
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
    throw new Error(`non-json ${res.status}: ${text}`);
  }
}

function start(name: string): ChildProcess {
  const child = spawn("pnpm", ["exec", "tsx", name], {
    cwd: cwd.pathname,
    env: { ...process.env, DEV_ALLOW_FIXTURE_ROUTE: "true", LIVE_ROUTE_ENABLED: "false", APP_AUTH_MODE: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  return child;
}

async function main() {
const api = start("src/api/server.ts");
const worker = start("src/worker/main.ts");

try {
  await waitHealth();
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
        question: "Compare managed Postgres options in Germany under 50 EUR / month as of 2026-03-01",
        routeMode: "fixture",
      }),
    }),
  );
  if (!created.runId) throw new Error(`no run id: ${JSON.stringify(created)}`);
  const runId = created.runId as string;
  let reportId: string | null = null;
  const startWait = Date.now();
  while (Date.now() - startWait < 20_000) {
    const snap = await json(await fetch(`${API}/v1/runs/${runId}`, { headers }));
    if (snap.lifecycle === "terminal" && snap.reportId) {
      reportId = snap.reportId;
      break;
    }
    await sleep(200);
  }
  if (!reportId) throw new Error("run did not publish a report");
  const report = await json(await fetch(`${API}/v1/reports/${reportId}`, { headers }));
  const citationIds: string[] = (report.blocks as { citationIds?: string[] }[]).flatMap((b) => b.citationIds ?? []);
  if (citationIds.length === 0) throw new Error("report has no citation IDs");
  for (const id of citationIds) {
    const src = await fetch(`${API}/v1/sources/${id}`, { headers });
    if (!src.ok) throw new Error(`citation ${id} did not resolve`);
    const body = await json(src);
    if (!body.exactText) throw new Error(`citation ${id} empty passage`);
  }
  const events = await json(await fetch(`${API}/v1/runs/${runId}/events?after=0`, { headers }));
  if (!events.events?.length) throw new Error("no events");

  let cancelRunId: string | null = null;
  let cancelled: Record<string, unknown> | null = null;
  let sawWriting = false;
  let publicationRejected = false;
  for (let attempt = 0; attempt < 4 && !sawWriting; attempt++) {
    const writing = await json(
      await fetch(`${API}/v1/runs`, {
        method: "POST",
        headers: { ...headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          question: "What did ACME announce about Widget 4?",
          routeMode: "fixture",
        }),
      }),
    );
    cancelRunId = writing.runId as string;
    const waitWrite = Date.now();
    while (Date.now() - waitWrite < 15_000) {
      const snap = await json(await fetch(`${API}/v1/runs/${cancelRunId}`, { headers }));
      if (snap.phase === "writing" && snap.lifecycle !== "terminal") {
        sawWriting = true;
        const cancelRes = await fetch(`${API}/v1/runs/${cancelRunId}/cancel`, {
          method: "POST",
          headers,
          body: "{}",
        });
        if (!cancelRes.ok) {
          throw new Error(`cancel failed: ${cancelRes.status} ${await cancelRes.text()}`);
        }
        break;
      }
      if (snap.lifecycle === "terminal") break;
      await sleep(25);
    }
  }
  if (!cancelRunId || !sawWriting) {
    throw new Error("never observed phase=writing to cancel during writing");
  }
  const waitTerm = Date.now();
  while (Date.now() - waitTerm < 15_000) {
    cancelled = await json(await fetch(`${API}/v1/runs/${cancelRunId}`, { headers }));
    if (cancelled.lifecycle === "terminal") break;
    await sleep(50);
  }
  if (!cancelled) throw new Error("cancel snapshot missing");
  if (cancelled.lifecycle !== "terminal" || cancelled.outcome !== "cancelled") {
    throw new Error(`expected cancelled terminal after writing cancel: ${JSON.stringify(cancelled)}`);
  }
  if (cancelled.reportId) {
    throw new Error(`late publication was not rejected; reportId=${cancelled.reportId}`);
  }
  const evCancel = await json(await fetch(`${API}/v1/runs/${cancelRunId}/events?after=0`, { headers }));
  const types = (evCancel.events ?? []).map((e: { type: string }) => e.type);
  publicationRejected = types.includes("publication_rejected") || types.includes("cancelled") || types.includes("cancel_requested");
  if (!publicationRejected) {
    throw new Error(`no cancel/reject event after writing cancel: ${JSON.stringify(types)}`);
  }

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        runId,
        reportId,
        citationCount: citationIds.length,
        eventCount: events.events.length,
        cancelRunId,
        cancelPhaseAtCancel: "writing",
        cancelLifecycle: cancelled.lifecycle,
        cancelOutcome: cancelled.outcome,
        cancelReportId: cancelled.reportId ?? null,
        latePublicationRejected: !cancelled.reportId,
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
