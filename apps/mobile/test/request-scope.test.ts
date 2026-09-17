import { afterEach, expect, it, vi } from "vitest";
import { api, isExpiredSession, isSupersededRequest } from "../src/api.js";
import { createRequestScope } from "../src/request-scope.js";

afterEach(() => { api.activateSession(null); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it("W03 a late account-A report cannot enter account B even when transport ignores abort", async () => {
  const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
  api.activateSession("account-a"); api.selectRun("run-a");
  const pending = api.report("account-a", "report-a").catch((error) => error);
  api.activateSession("account-b"); api.selectRun("run-b");
  response.resolve(Response.json({ reportId: "report-a", private: "account A only" }));
  expect(isSupersededRequest(await pending)).toBe(true);
});

it("W03 an old unauthorized response cannot sign out the new account", async () => {
  const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
  api.activateSession("account-a");
  const pending = api.library("account-a").catch((error) => error);
  api.activateSession("account-b");
  response.resolve(Response.json({ message: "expired" }, { status: 401 }));
  const result = await pending;
  expect(isSupersededRequest(result)).toBe(true);
  expect(isExpiredSession(result)).toBe(false);
});

it("W03 switching selected runs discards the old snapshot but retains account-level requests", async () => {
  const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
  api.activateSession("account-a"); api.selectRun("old-run");
  const pending = api.getRun("account-a", "old-run").catch((error) => error);
  api.selectRun("new-run");
  response.resolve(Response.json({ runId: "old-run" }));
  expect(isSupersededRequest(await pending)).toBe(true);
  const scope = createRequestScope(); scope.setSession("a");
  const accountRead = scope.capture("account", "a"), viewRead = scope.capture("view", "a");
  scope.selectRun("next");
  expect(accountRead.current()).toBe(true); expect(viewRead.current()).toBe(false);
  accountRead.release(); viewRead.release();
});

it("W03 closing the source sheet invalidates a late passage response", async () => {
  const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
  api.activateSession("a"); api.selectRun("run");
  const pending = api.source("a", "passage").catch((error) => error);
  api.closeSource(); response.resolve(Response.json({ exactText: "closed source" }));
  expect(isSupersededRequest(await pending)).toBe(true);
});

it("W03 rejects old token/run requests before network and accepts the current report", async () => {
  const fetcher = vi.fn(async () => Response.json({ reportId: "current" })); vi.stubGlobal("fetch", fetcher);
  api.activateSession("b"); api.selectRun("new");
  await expect(api.report("a", "private")).rejects.toThrow("superseded");
  await expect(api.getRun("b", "old")).rejects.toThrow("superseded");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await api.report("b", "current")).toEqual({ reportId: "current" });
});

it("W03 signing out during an anonymous sign-in request prevents the late credential from activating", async () => {
  const response = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => response.promise));
  api.activateSession(null);
  const pending = api.session().catch((error) => error);
  api.activateSession(null); // Explicit sign-out invalidates even when no token has arrived yet.
  response.resolve(Response.json({ token: "late-secret", accountId: "a" }));
  expect(isSupersededRequest(await pending)).toBe(true);
});
it.each(["reuse_snapshot","refresh"] as const)("W06 mobile sends an explicit replacement patch with %s",async(evidencePolicy)=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({runId:"child"}));vi.stubGlobal("fetch",fetcher);api.activateSession("a");api.selectRun("parent");
 await api.correct("a","parent",3,"What changed?",{kind:"replace_question",question:"What changed?",evidencePolicy});
 expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({expectedBriefRevision:3,correctionText:"What changed?",patch:{kind:"replace_question",question:"What changed?",evidencePolicy}});
});
it("W06 late correction acceptance cannot switch a newly selected run",async()=>{
 const response=deferred<Response>();vi.stubGlobal("fetch",vi.fn(()=>response.promise));api.activateSession("a");api.selectRun("parent");
 const pending=api.correct("a","parent",1,"New question",{kind:"replace_question",question:"New question",evidencePolicy:"reuse_snapshot"}).catch((e)=>e);
 api.selectRun("different");response.resolve(Response.json({runId:"child"}));
 expect(isSupersededRequest(await pending)).toBe(true);expect(api.currentRun("a","different")).toBe(true);
});
it("W06 malformed executable correction patches never reach the network",()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);api.activateSession("a");api.selectRun("parent");
 expect(()=>api.correct("a","parent",1,"New question",{kind:"replace_question",question:"New question",evidencePolicy:"reuse_snapshot",budgetMicro:999} as never)).toThrow();
 expect(fetcher).not.toHaveBeenCalled();
});
