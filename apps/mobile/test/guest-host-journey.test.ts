import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { beginGuestActionResume, beginGuestAuth, beginGuestClaim, completeGuestAuth, completeGuestClaim, createGuestPendingAction, dismissGuestPendingAction, holdGuestAuthAttempt, markGuestActionDispatched, reopenGuestPendingAction, validateGuestActionResume } from "../src/auth/guest-pending-action";
import { createProtectedContentStore } from "../src/protected-content";
import { emptyState } from "../src/state";
import { memoryStore } from "../src/persist";
import { sha256Hex } from "../src/sha256";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proof = "p".repeat(43), memberToken = "verified-member-token";
const context = { guestContextId: id(1), conversationId: id(2), conversationVersion: 1, expiresAt: "2026-09-22T00:00:00.000Z", consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 1, consentGranted: true };
const at = new Date("2026-09-21T08:00:00.000Z");

afterEach(() => { api.activateSession(null); api.clearGuest(); vi.unstubAllGlobals(); });

it("GUEST-01/02/CLAIM-01 synthetic first reader, dismissed second, exact claim/continuation, then ordinary third Send", async () => {
  const ordinary = memoryStore({ "deep.install.v2": "1" }), device = createGuestDeviceStore(createProtectedContentStore(ordinary, memoryStore()), memoryStore());
  const calls: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const headers = init.headers as Record<string, string>;
    calls.push({ path, body, headers });
    if (path === "/v1/runs" && headers["x-norrow-guest-proof"]) return Response.json({ runId: id(3), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === "/v1/guest/pending-actions") return Response.json({ code: "AUTH_REQUIRED_NEXT_TURN", submissionId: id(4), expiresAt: "2026-09-21T09:00:00.000Z", controlVersion: 1 }, { status: 202 });
    if (path.endsWith("/attempts/begin")) return Response.json({ submissionId: id(4), authAttemptId: body.authAttemptId, attemptRevision: body.authAttemptId === id(5) ? 1 : 2, state: "authenticating" });
    if (path.endsWith("/attempts/end")) return Response.json({ submissionId: id(4), authAttemptId: body.authAttemptId, attemptRevision: 1, state: "dismissed" });
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(8), authMode: "clerk" });
    if (path === "/v1/guest/claim" || path === "/v1/guest/claims/resolve") return Response.json({ type: "claim_accepted", submissionId: id(4), requestId: id(7), accountId: id(8), conversationId: id(2), conversationVersion: 1, controlVersion: 2, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: "consent.v1" });
    if (path === "/v1/guest/actions/resume") return Response.json({ type: "continuation_dispatched", submissionId: id(4), claimRequestId: id(7), accountId: id(8), conversationId: id(2), conversationVersion: 1, receiptId: id(9), runId: id(10), memberConversationId: id(11), kind: "follow_up" });
    if (path === "/v1/runs") return Response.json({ runId: id(12), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    throw new Error(`Unexpected synthetic route ${path}`);
  }));

  await device.saveBootstrap(context, proof); api.activateGuest(proof, context.guestContextId);
  await api.guest.createRun(proof, "Best laptop under $2,000?", id(13), context.conversationId);
  const reader = { ...emptyState(), draft: "What about battery life?", conversationId: context.conversationId, status: "completed" as const,
    report: { reportId: id(14), version: 1, blocks: [], limitations: [], labeledDemo: false },
    run: { runId: id(3), lifecycle: "terminal" as const, phase: "done", outcome: "completed" as const, reportId: id(14), labeledDemo: false } };
  await device.saveSnapshot(context.guestContextId, reader, 2);
  let action = createGuestPendingAction({ submissionId: id(4), guestContextId: context.guestContextId, conversationId: context.conversationId,
    conversationVersion: 1, draftRevision: 2, draftDigest: sha256Hex(reader.draft), payload: { kind: "follow_up", text: reader.draft, parentRunId: id(3) },
    consentPolicyVersion: context.consentPolicyVersion, createdAt: at.toISOString(), expiresAt: "2026-09-21T09:00:00.000Z" });
  await device.savePendingAction(action);
  expect((await api.guest.registerAction(proof, action)).code).toBe("AUTH_REQUIRED_NEXT_TURN");

  action = beginGuestAuth(action, { id: id(5), provider: "google" }, at); await device.savePendingAction(action);
  await api.guest.beginAuthAttempt(proof, action.submissionId, id(5), "google");
  action = holdGuestAuthAttempt(action, id(5), at); await device.savePendingAction(action);
  await api.guest.endAuthAttempt(proof, action.submissionId, id(5), "dismissed");
  action = dismissGuestPendingAction(action, at); await device.savePendingAction(action);
  const restored = await device.load();
  expect(restored?.state.report?.reportId).toBe(id(14));
  expect(restored?.state.draft).toBe("What about battery life?");
  expect(restored?.pendingAction).toMatchObject({ submissionId: id(4), phase: "dismissed" });

  action = reopenGuestPendingAction(action, at);
  action = beginGuestAuth(action, { id: id(6), provider: "email" }, at); await device.savePendingAction(action);
  await api.guest.beginAuthAttempt(proof, action.submissionId, id(6), "email");
  const identity = await api.verifyMemberSession(memberToken);
  action = completeGuestAuth(action, id(6), identity.accountId, at); await device.savePendingAction(action);
  api.rotateGuestScope(); api.activateSession(memberToken, identity.accountId);
  action = beginGuestClaim(action, id(7), at); await device.savePendingAction(action);
  const claimed = await api.guest.claim(proof, memberToken, action);
  const epochs = api.sessionEpochs();
  action = completeGuestClaim(action, { ...claimed, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch }, at); await device.savePendingAction(action);
  const resumeContext = { now: at, accountId: identity.accountId, sessionActive: true, guestContextId: context.guestContextId,
    conversationId: context.conversationId, conversationVersion: 1, controlVersion: 2,
    principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch, credentialGeneration: epochs.credentialGeneration,
    draftRevision: 2, draftDigest: sha256Hex(reader.draft), consentPolicyVersion: context.consentPolicyVersion,
    authorityAllowed: true, budgetAllowed: true };
  expect(validateGuestActionResume(action, resumeContext)).toEqual({ ok: true });
  action = beginGuestActionResume(action, resumeContext); await device.savePendingAction(action);
  const continued = await api.resumeGuestAction(memberToken, action);
  action = markGuestActionDispatched(action, continued, at); await device.savePendingAction(action);
  expect(action).toMatchObject({ phase: "dispatched", dispatchReceiptId: id(9), submissionId: id(4) });
  const third = await api.createRun(memberToken, "Compare warranty support", "controlled-research", id(15), [], continued.memberConversationId);
  expect(third.runId).toBe(id(12));
  expect(calls.filter(call => call.path === "/v1/guest/pending-actions")).toHaveLength(1);
  expect(calls.filter(call => call.path === "/v1/guest/claim")).toHaveLength(1);
  expect(calls.filter(call => call.path === "/v1/guest/actions/resume")).toHaveLength(1);
  expect(calls.filter(call => call.path === "/v1/runs")).toHaveLength(2);
  expect(calls.at(-1)?.body).toMatchObject({ conversationId: id(11), question: "Compare warranty support" });
  expect(calls.at(-1)?.headers["x-norrow-guest-proof"]).toBeUndefined();
});

it("CLAIM-14 allowance_required holds the exact second action and forbids an ordinary third Send", async () => {
  api.activateSession(memberToken, id(8));
  let action = completeGuestClaim(beginGuestClaim(completeGuestAuth(beginGuestAuth(createGuestPendingAction({
    submissionId: id(4), guestContextId: id(1), conversationId: id(2), conversationVersion: 1, draftRevision: 2,
    draftDigest: sha256Hex("Second"), payload: { kind: "new_research", text: "Second" }, consentPolicyVersion: "consent.v1",
    createdAt: at.toISOString(), expiresAt: "2026-09-21T09:00:00.000Z",
  }), { id: id(6), provider: "email" }, at), id(6), id(8), at), id(7), at), {
    type: "claim_accepted", submissionId: id(4), requestId: id(7), accountId: id(8), controlVersion: 2,
    conversationId: id(2), conversationVersion: 1, principalEpoch: api.sessionEpochs().principalEpoch, viewEpoch: api.sessionEpochs().viewEpoch,
  }, at);
  const fetcher = vi.fn(async (input: string) => new URL(input).pathname === "/v1/guest/actions/resume"
    ? Response.json({ code: "allowance_exhausted" }, { status: 402 }) : Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const epochs = api.sessionEpochs();
  const current = { now: at, accountId: id(8), sessionActive: true, guestContextId: id(1), conversationId: id(2), conversationVersion: 1,
    controlVersion: 2, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch, credentialGeneration: epochs.credentialGeneration,
    draftRevision: 2, draftDigest: sha256Hex("Second"), consentPolicyVersion: "consent.v1", authorityAllowed: true, budgetAllowed: true };
  action = beginGuestActionResume(action, current);
  await expect(api.resumeGuestAction(memberToken, action)).rejects.toMatchObject({ status: 402 } satisfies Partial<ApiError>);
  action = dismissGuestPendingAction(action, at);
  expect(action).toMatchObject({ phase: "resume_pending", autoResume: false, submissionId: id(4), claim: { requestId: id(7) } });
  expect(validateGuestActionResume(action, current)).toEqual({ ok: false, code: "dismissed" });
  expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === "/v1/runs")).toHaveLength(0);
});
