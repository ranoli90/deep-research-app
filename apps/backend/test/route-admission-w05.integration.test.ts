import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type PgBoss from "pg-boss";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { CONSENT_POLICY_VERSION } from "@deep/contracts";
import { buildApp, publicRouteAdmissionDenial } from "../src/api/app.js";
import { createQueue } from "../src/adapters/queue.js";
import { createPool, migrate } from "../src/platform/db.js";
import { loadConfig } from "../src/platform/config.js";

/**
 * W05 canonical public route-admission tuple.
 *
 * Keeps the 5 known allowlisted messages; every other code/message maps to a
 * generic tuple with no private leak. Denials create no run, reservation,
 * provider intent, or dispatch. Pending-session/issuer/signature/revocation
 * controls live in the clerk suite and are preserved, not re-litigated here.
 */
const baseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://deep:deep_local_dev_only@127.0.0.1:55432/deep_research_test";

function scratchUrl(): { adminUrl: string; url: string; dbName: string } {
  const parsed = new URL(baseUrl);
  const dbName = `deep_norrow_w05_${process.pid}_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
  const adminUrl = baseUrl;
  parsed.pathname = `/${dbName}`;
  return { adminUrl, url: parsed.toString(), dbName };
}

const scratch = scratchUrl();
const url = scratch.url;
let pool: pg.Pool;
let boss: PgBoss;
let app: FastifyInstance;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: scratch.adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${scratch.dbName}"`);
  } finally {
    await admin.end();
  }
  pool = createPool(url);
  await migrate(pool);
  boss = await createQueue(url);
  app = await buildApp({
    pool,
    boss,
    config: loadConfig({
      DATABASE_URL: url,
      NODE_ENV: "test",
      APP_AUTH_MODE: "development",
      NORROW_GUEST_BOOTSTRAP_ENABLED: "true",
      NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890",
      DEV_ALLOW_FIXTURE_ROUTE: "true",
    }),
  });
}, 120_000);

beforeEach(async () => {
  await pool.query("TRUNCATE accounts CASCADE");
});

afterAll(async () => {
  await app.close();
  await boss.stop({ graceful: false, timeout: 2000 });
  await pool.end();
  const admin = new pg.Client({ connectionString: scratch.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE "${scratch.dbName}"`);
  } finally {
    await admin.end();
  }
}, 60_000);

async function member() {
  const session = await app.inject({ method: "POST", url: "/v1/dev/session", payload: {} });
  expect(session.statusCode).toBe(200);
  const body = session.json() as { token: string; accountId: string };
  await app.inject({ method: "POST", url: "/v1/consent/member",
    headers: { authorization: `Bearer ${body.token}` }, payload: { grant: true } });
  return { ...body, headers: { authorization: `Bearer ${body.token}` } };
}

async function counts() {
  const runs = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM runs")).rows[0]!.n;
  const reservations = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM reservations")).rows[0]!.n;
  const intents = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM provider_intents")).rows[0]!.n;
  return { runs, reservations, intents };
}

describe("W05 canonical route-admission tuple", () => {
  it("keeps the 5 known allowlisted messages with canonical code/status", () => {
    expect(publicRouteAdmissionDenial(Object.assign(new Error("Fixture route is disabled."),
      { code: "permission_denied", statusCode: 403 })))
      .toEqual({ code: "permission_denied", status: 403, message: "Fixture route is disabled." });
    expect(publicRouteAdmissionDenial(Object.assign(new Error("Live route is not enabled."),
      { code: "permission_denied", statusCode: 403 })))
      .toEqual({ code: "permission_denied", status: 403, message: "Live route is not enabled." });
    expect(publicRouteAdmissionDenial(Object.assign(new Error("Structured research is disabled."),
      { code: "permission_denied", statusCode: 403 })))
      .toEqual({ code: "permission_denied", status: 403, message: "Structured research is disabled." });
    expect(publicRouteAdmissionDenial(Object.assign(new Error("Live route requires an authorized key and budget."),
      { code: "permission_denied", statusCode: 403 })))
      .toEqual({ code: "permission_denied", status: 403,
        message: "Live route requires an authorized key and budget." });
    expect(publicRouteAdmissionDenial(Object.assign(new Error("Live spend cap is exhausted."),
      { code: "allowance_exhausted", statusCode: 403 })))
      .toEqual({ code: "allowance_exhausted", status: 402, message: "Live spend cap is exhausted." });
  });

  it("never leaks private messages, codes, or prototype keys", () => {
    const secret = "sponsor secret cap=999 key=sk-hidden";
    const privateDenied = publicRouteAdmissionDenial(
      Object.assign(new Error(secret), { code: "permission_denied", statusCode: 403 }));
    expect(privateDenied).toEqual({ code: "permission_denied", status: 403,
      message: "The request was not accepted." });
    expect(JSON.stringify(privateDenied)).not.toContain("sk-hidden");

    const unknown = publicRouteAdmissionDenial(
      Object.assign(new Error("private sponsor cap detail"), { code: "private_sponsor_cap", statusCode: 403 }));
    expect(unknown).toEqual({ code: "internal_failure", status: 500,
      message: "The request could not be completed." });
    expect(JSON.stringify(unknown)).not.toContain("private sponsor");

    for (const proto of ["__proto__", "constructor", "prototype", "toString"]) {
      const polluted = publicRouteAdmissionDenial(
        Object.assign(new Error("polluted"), { code: proto, statusCode: 403 }));
      expect(polluted).toEqual({ code: "internal_failure", status: 500,
        message: "The request could not be completed." });
    }
  });

  it("denies a disabled fixture route with no reservation, intent, or dispatch", async () => {
    const disabled = await buildApp({ pool, boss,
      config: loadConfig({ DATABASE_URL: url, NODE_ENV: "test", APP_AUTH_MODE: "development",
        NORROW_GUEST_BOOTSTRAP_ENABLED: "true",
        NORROW_GUEST_PROOF_PEPPER: "nonsecret-isolated-test-pepper-1234567890",
        DEV_ALLOW_FIXTURE_ROUTE: "false" }) });
    try {
      const m = await member();
      const before = await counts();
      const denied = await disabled.inject({ method: "POST", url: "/v1/runs",
        headers: { ...m.headers, "idempotency-key": randomUUID() },
        payload: { question: "Denied fixture question", routeMode: "fixture",
          consentPolicyVersion: CONSENT_POLICY_VERSION } });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ code: "permission_denied",
        message: "Fixture route is disabled." });
      expect(await counts()).toEqual(before);
    } finally {
      await disabled.close();
    }
  });
});
