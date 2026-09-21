import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";
import { beginGuestAuth, beginGuestClaim, cancelGuestPendingAction, completeGuestAuth, completeGuestClaim, createGuestPendingAction, dismissGuestPendingAction, prepareMemberClarificationReplacement } from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 10 }));
vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: () => undefined, isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }), setAccessibilityFocus: () => undefined },
  AppState: { addEventListener: () => ({ remove() {} }) }, BackHandler: { addEventListener: () => ({ remove() {} }) },
  Keyboard: { dismiss: () => undefined, addListener: () => ({ remove() {} }) }, Linking: { openURL: async () => undefined },
  Share: { share: async () => undefined }, Platform: { OS: "android", select: (x: any) => x.android },
  KeyboardAvoidingView: "KeyboardAvoidingView", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
  findNodeHandle: () => null, useColorScheme: () => "light", useWindowDimensions: () => ({ width: 390, height: 800 }),
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock("expo-status-bar", () => ({ StatusBar: "StatusBar" }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async () => null, setItem: async () => undefined } }));
vi.mock("@clerk/expo", () => ({ ClerkProvider: "ClerkProvider" }));
vi.mock("@clerk/expo/token-cache", () => ({ tokenCache: {} }));
vi.mock("../src/auth/clerk-guest-auth", () => ({ useClerkGuestAuth: () => null }));
vi.mock("expo-crypto", () => ({ getRandomBytes: () => {
  const n = held.id++; const bytes = new Uint8Array(16); bytes[15] = n; return bytes;
} }));
vi.mock("../src/native-session", () => ({
  guestDevice: new Proxy({}, { get: (_target, key: string) => (...args: any[]) => held.device[key](...args) }),
  sessionStorage: new Proxy({}, { get: (_target, key: string) => (...args: any[]) => held.session[key](...args) }),
}));
vi.mock("../src/native-documents", () => ({ clearDocumentPickerCache: () => undefined, pickDocument: async () => null }));
vi.mock("../src/native-document-digest", () => ({ nativeDocumentDigest: async () => "0".repeat(64) }));
vi.mock("../src/haptics", () => ({ productHaptic: () => undefined }));
vi.mock("../src/use-keyboard-inset", () => ({ useKeyboardInset: () => ({ keyboardOpen: false, keyboardInset: 0, keyboardOpenRef: { current: false }, keyboardInsetRef: { current: 0 }, dismissKeyboard: () => undefined }) }));
vi.mock("../src/product-styles", () => ({ makeStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock("../src/ResearchComposer", () => ({ ResearchComposer: "ResearchComposer" }));
vi.mock("../src/auth/GuestSignInSheet", () => ({ GuestSignInSheet: "GuestSignInSheet" }));
vi.mock("../src/ProfilePanel", () => ({ ProfilePanel: "ProfilePanel" }));
vi.mock("../src/SourceSheet", () => ({ SourceSheet: "SourceSheet" }));
vi.mock("../src/AttachmentPanel", () => ({ AttachmentPanel: "AttachmentPanel" }));
vi.mock("../src/ResearchActivity", () => ({ ResearchActivity: "ResearchActivity" }));
vi.mock("../src/ResearchBriefCard", () => ({ ResearchBriefCard: "ResearchBriefCard" }));
vi.mock("../src/ReportView", () => ({ ReportSections: "ReportSections" }));
vi.mock("../src/LibraryList", () => ({ LibraryList: "LibraryList" }));
vi.mock("../src/EmptyHome", () => ({ EmptyHome: "EmptyHome" }));
vi.mock("../src/ResearchHeader", () => ({ ResearchHeader: "ResearchHeader" }));
vi.mock("../src/PendingBanners", () => ({ PendingBanners: "PendingBanners" }));
vi.mock("../src/ReportActions", () => ({ ReportActions: "ReportActions" }));
vi.mock("../src/CorrectionPanel", () => ({ CorrectionPanel: "CorrectionPanel" }));

import { AppInner } from "../App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proof = "p".repeat(43), memberToken = "verified-member";
const context = { guestContextId: id(1), conversationId: id(2), conversationVersion: 1, expiresAt: "2026-09-22T00:00:00.000Z", consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 1, consentGranted: true };
async function seedAction(text = "A", withReader = false) {
  await held.device.saveBootstrap(context, proof);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: text, consentGranted: true, routeMode: "controlled-research",
    ...(withReader ? { run: { runId: id(5), lifecycle: "terminal" as const, phase: "done", outcome: "completed", reportId: id(6), labeledDemo: false },
      status: "completed" as const, report: { reportId: id(6), version: 1, blocks: [], limitations: [], labeledDemo: false, changeSummary: null } } : {}),
  });
  const pending = createGuestPendingAction({ submissionId: id(3), guestContextId: context.guestContextId, conversationId: context.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex(text), payload: { kind: "new_research", text },
    consentPolicyVersion: context.consentPolicyVersion, createdAt: "2026-09-21T00:00:00.000Z", expiresAt: context.expiresAt });
  await held.device.savePendingAction(pending);
  return pending;
}
beforeEach(async () => {
  held.id = 10;
  const ordinary = memoryStore(), native = memoryStore(), secure = memoryStore();
  const content = createProtectedContentStore(ordinary, native);
  await content.setItem("deep.install.v2", "1");
  held.device = createGuestDeviceStore(content, secure);
  held.session = { hydrate: async () => ({ token: null, accountId: null, state: emptyState() }), activate: async () => undefined,
    rotateCredential: async () => undefined, persist: async () => undefined, persistRequired: async () => undefined,
    saveAdmission: async () => undefined, finishAdmission: async () => undefined, flush: async () => undefined, clear: async () => undefined };
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
});
afterEach(() => { api.activateSession(null); api.clearGuest(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("CLAIM-14 mounted App cold-start Clerk restoration keeps storage ready after its own session epoch changes", async () => {
  held.session.hydrate = async () => ({ token: null, accountId: null, state: { ...emptyState(), draft: "question" } });
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(new URL(url).pathname); return Response.json({ accountId: id(1), actorKind: "member" }); }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: true, getToken: async () => memberToken } as any} />); });
  const composer = () => renderer.root.find(node => String(node.type) === "ResearchComposer");
  expect(composer().props.draft).toBe("question");
  await act(async () => { composer().props.onSend(); });
  await act(async () => { await Promise.resolve(); });
  expect(calls).toContain("/v1/session");
  expect(renderer.root.findAll(node => String(node.type) === "Text").map(node => String(node.props.children ?? "")).join(" ")).toMatch(/consent|processing|Allow/i);
  await act(async () => { renderer.unmount(); });
});

it("CLAIM-14 mounted App edits A to B only after exact server cancellation and archives A", async () => {
  const original = await seedAction();
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/session") return Response.json({ ...context, actorKind: "guest" });
    if (path === "/v1/guest/pending-actions/cancel") return Response.json({ type: "action_abandoned", submissionId: original.submissionId });
    if (path === "/v1/guest/pending-actions") return Response.json({ code: "AUTH_REQUIRED_NEXT_TURN", submissionId: JSON.parse(String(init.body)).submissionId, expiresAt: context.expiresAt, controlVersion: 1 }, { status: 202 });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={null} />); });
  const composer = () => renderer.root.find(node => String(node.type) === "ResearchComposer");
  expect(composer().props.draft).toBe("A");
  await act(async () => { await renderer.root.find(node => String(node.type) === "GuestSignInSheet").props.transport.dismiss(); });
  expect((await held.device.load()).pendingAction.phase).toBe("dismissed");
  await act(async () => { composer().props.onChange("B"); });
  await act(async () => { composer().props.onSend(); });
  expect(calls).toContain("/v1/guest/pending-actions/cancel");
  expect(calls).toContain("/v1/guest/pending-actions");
  const saved = await held.device.load();
  expect(saved.pendingAction.submissionId).not.toBe(original.submissionId);
  expect(saved.pendingAction.payload.text).toBe("B");
  expect(saved.state.draft).toBe("B");
  expect(renderer.root.find(node => String(node.type) === "GuestSignInSheet").props.visible).toBe(true);
  await act(async () => { renderer.unmount(); });
});

it("CLAIM-14 mounted App dismissal during in-flight claim does not dispatch or overwrite the held journal", async () => {
  const original = await seedAction("A", true);
  let releaseClaim!: (value: Response) => void;
  const claimResponse = new Promise<Response>(resolve => { releaseClaim = resolve; });
  const calls: string[] = [];
  let claimRequestId = "";
  let claimBearer = "", clerkTokenReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: true, termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" });
    if (path === "/v1/guest/pending-actions/attempts/begin") return Response.json({ submissionId: original.submissionId, authAttemptId: JSON.parse(String(init.body)).authAttemptId, attemptRevision: 1, state: "authenticating" });
    if (path === "/v1/session") return Response.json({ accountId: id(7), actorKind: "member" });
    if (path === "/v1/guest/claim") { claimRequestId = JSON.parse(String(init.body)).claimRequestId; claimBearer = (init.headers as Record<string, string>).authorization; return claimResponse; }
    if (path === "/v1/guest/actions/resume") throw new Error("dismissed action was dispatched");
    return Response.json({});
  }));
  const auth = { loaded: true, signedIn: false, getToken: async () => ++clerkTokenReads === 1 ? memberToken : "refreshed-member", verifyEmailCode: async () => undefined };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth as any} />); });
  const sheet = () => renderer.root.find(node => String(node.type) === "GuestSignInSheet");
  expect(sheet().props.visible).toBe(true);
  let attempt!: { id: string };
  await act(async () => { attempt = await sheet().props.transport.prepareAttempt({ provider: "email", operation: "email_code", email: "reader@example.test" }); });
  let completion!: Promise<void>;
  await act(async () => { completion = sheet().props.transport.verifyEmailCode(attempt, "123456"); await Promise.resolve(); });
  expect(calls).toContain("/v1/guest/claim");
  expect(claimBearer).toBe("Bearer refreshed-member");
  await act(async () => { await sheet().props.transport.dismiss(); });
  releaseClaim(Response.json({ type: "claim_accepted", submissionId: original.submissionId, requestId: claimRequestId, accountId: id(7), conversationId: context.conversationId,
    conversationVersion: 1, controlVersion: 1, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: context.consentPolicyVersion }));
  await act(async () => { await completion.catch(() => undefined); });
  expect(calls).not.toContain("/v1/guest/actions/resume");
  const saved = await held.device.load();
  expect(saved.pendingAction.autoResume).toBe(false);
  expect(saved.pendingAction.submissionId).toBe(original.submissionId);
  expect(saved.state.draft).toBe("A");
  expect(saved.state.report?.reportId).toBe(id(6));
  await act(async () => { renderer.unmount(); });
});

it("CLAIM-14 mounted App abandons a claimed A before an edited member B and never treats guest consent as member consent", async () => {
  const original = await seedAction();
  const authenticated = completeGuestAuth(beginGuestAuth(original, { id: id(8), provider: "email" }, new Date("2026-09-21T01:00:00.000Z")), id(8), id(7), new Date("2026-09-21T01:00:00.000Z"));
  const claiming = beginGuestClaim(authenticated, id(9), new Date("2026-09-21T01:00:00.000Z"));
  const claimed = dismissGuestPendingAction(completeGuestClaim(claiming, { type: "claim_accepted", submissionId: original.submissionId, requestId: id(9), accountId: id(7),
    conversationId: context.conversationId, conversationVersion: 1, controlVersion: 1, principalEpoch: 1, viewEpoch: 1 }, new Date("2026-09-21T01:00:00.000Z")), new Date("2026-09-21T01:00:00.000Z"));
  await held.device.savePendingAction(claimed, original);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: "B", consentGranted: true, routeMode: "controlled-research" });
  let requiredWrites = 0;
  held.session.persistRequired = async () => { if (++requiredWrites === 1) throw new Error("protected write unavailable"); };
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/guest/actions/abandon") return Response.json({ type: "action_abandoned", submissionId: original.submissionId, claimRequestId: id(9) });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: true, getToken: async () => memberToken } as any} />); });
  const composer = renderer.root.find(node => String(node.type) === "ResearchComposer");
  expect(composer.props.draft).toBe("B");
  await act(async () => { composer.props.onSend(); await Promise.resolve(); });
  expect(calls).toContain("/v1/guest/actions/abandon");
  expect((await held.device.load()).pendingAction.phase).toBe("cancelled");
  await act(async () => { composer.props.onSend(); await Promise.resolve(); });
  expect(calls.filter(path => path === "/v1/guest/actions/abandon")).toHaveLength(1);
  expect(calls).not.toContain("/v1/guest/actions/resume");
  expect(calls).not.toContain("/v1/runs");
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 mounted App verifies a refreshed Clerk bearer and uses it for consent and an ordinary Send", async () => {
  held.session.hydrate = async () => ({ token: "token-one", accountId: id(7), state: { ...emptyState(), draft: "third question", signedIn: true, routeMode: "controlled-research" } });
  const rotations: string[] = [];
  held.session.rotateCredential = async (old: string, next: { token: string }) => { rotations.push(`${old}:${next.token}`); };
  let tokens = 0;
  const auth = { loaded: true, signedIn: true, getToken: async () => ++tokens === 1 ? "token-one" : "token-two" };
  const calls: { path: string; bearer: string | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, bearer = (init.headers as Record<string, string> | undefined)?.authorization;
    calls.push({ path, bearer });
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/consent") return Response.json({ granted: true, policyVersion: "consent.v1" });
    if (path === "/v1/settings") return Response.json({ liveRouteEnabled: true });
    if (path === "/v1/runs") return Response.json({ runId: id(15), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(15)}`) return Response.json({ runId: id(15), lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(15)}/events`) return Response.json({ events: [] });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth as any} />); });
  const header = () => renderer.root.find(node => String(node.type) === "ResearchHeader");
  await act(async () => { header().props.onSettings(); });
  await act(async () => { await renderer.root.find(node => String(node.type) === "ProfilePanel").props.onConsent(); });
  expect(rotations).toEqual(["token-one:token-two"]);
  expect(api.currentCredential()).toBe("token-two");
  expect(calls.find(call => call.path === "/v1/consent")?.bearer).toBe("Bearer token-two");
  await act(async () => { renderer.root.find(node => String(node.type) === "ProfilePanel").props.onDone(); });
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchComposer").props.onSend(); await Promise.resolve(); });
  await vi.waitFor(() => expect(calls.some(call => call.path === "/v1/runs"), JSON.stringify({ calls, text: renderer.root.findAll(node => String(node.type) === "Text").map(node => node.props.children) })).toBe(true));
  expect(calls.find(call => call.path === "/v1/runs")?.bearer).toBe("Bearer token-two");
  expect(calls.filter(call => call.path === "/v1/consent" || call.path === "/v1/runs").every(call => call.bearer !== "Bearer token-one")).toBe(true);
  await act(async () => { renderer.unmount(); });
});

it("CLAIM-14 mounted App abandons edited clarification A, registers exact B, and resumes only B", async () => {
  await held.device.saveBootstrap(context, proof);
  const clarification = { kind: "clarification" as const, text: "A", pendingInputId: id(18), briefRevision: 2, field: "geography" };
  const saved = createGuestPendingAction({ submissionId: id(3), guestContextId: context.guestContextId, conversationId: context.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex("A"), payload: clarification,
    consentPolicyVersion: context.consentPolicyVersion, createdAt: "2026-09-21T00:00:00.000Z", expiresAt: context.expiresAt });
  await held.device.savePendingAction(saved);
  const authenticated = completeGuestAuth(beginGuestAuth(saved, { id: id(8), provider: "email" }, new Date("2026-09-21T01:00:00.000Z")), id(8), id(7), new Date("2026-09-21T01:00:00.000Z"));
  const claiming = beginGuestClaim(authenticated, id(9), new Date("2026-09-21T01:00:00.000Z"));
  const claimed = dismissGuestPendingAction(completeGuestClaim(claiming, { type: "claim_accepted", submissionId: saved.submissionId, requestId: id(9), accountId: id(7),
    conversationId: context.conversationId, conversationVersion: 1, controlVersion: 1, principalEpoch: 1, viewEpoch: 1 }, new Date("2026-09-21T01:00:00.000Z")), new Date("2026-09-21T01:00:00.000Z"));
  await held.device.savePendingAction(claimed, saved);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), consentGranted: true, routeMode: "controlled-research", status: "awaiting_input",
    run: { runId: id(5), lifecycle: "awaiting_input", phase: "planning", outcome: null, reportId: null, labeledDemo: false,
      pendingInput: { id: clarification.pendingInputId, type: "clarification", field: "geography", briefRevision: 2 } } });
  const calls: { path: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(String(init.body)) : null; calls.push({ path, body });
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/consent") return Response.json({ granted: true, policyVersion: "consent.v1" });
    if (path === "/v1/guest/actions/abandon") return Response.json({ type: "action_abandoned", submissionId: saved.submissionId, claimRequestId: id(9) });
    if (path === "/v1/guest/actions/register-member" || path === "/v1/guest/actions/resolve") return Response.json({ type: "member_action_registered", submissionId: body.submissionId,
      claimRequestId: id(9), controlVersion: 1, payloadDigest: path.endsWith("register-member") ? body.payloadDigest : calls.find(call => call.path.endsWith("register-member"))!.body.payloadDigest,
      expiresAt: context.expiresAt, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: "consent.v1" });
    if (path === "/v1/guest/actions/resume") return Response.json({ type: "continuation_dispatched", submissionId: body.submissionId, claimRequestId: id(9), accountId: id(7),
      conversationId: context.conversationId, conversationVersion: 1, receiptId: id(19), runId: id(20), memberConversationId: id(21), kind: "clarification" });
    if (path === `/v1/runs/${id(20)}`) return Response.json({ runId: id(20), lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(20)}/events`) return Response.json({ events: [] });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: true, getToken: async () => memberToken } as any} />); });
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchHeader").props.onSettings(); });
  await act(async () => { await renderer.root.find(node => String(node.type) === "ProfilePanel").props.onConsent(); });
  await act(async () => { renderer.root.find(node => String(node.type) === "ProfilePanel").props.onDone(); });
  const brief = () => renderer.root.find(node => String(node.type) === "ResearchBriefCard");
  expect(brief().props.clarifyAnswer).toBe("A");
  await act(async () => { brief().props.onClarify("B"); });
  await act(async () => { brief().props.onContinue(); await Promise.resolve(); });
  await vi.waitFor(() => expect(calls.some(call => call.path === "/v1/guest/actions/resume")).toBe(true));
  const registered = calls.find(call => call.path === "/v1/guest/actions/register-member")!.body;
  expect(registered.replacedSubmissionId).toBe(saved.submissionId);
  expect(registered.submissionId).not.toBe(saved.submissionId);
  expect(registered.payload).toEqual({ ...clarification, text: "B" });
  expect(registered.payloadDigest).toBe(sha256Hex(JSON.stringify(["clarification", "B", id(18), 2, "geography"])));
  expect(calls.filter(call => call.path === "/v1/guest/actions/abandon")).toHaveLength(1);
  expect(calls.filter(call => call.path === "/v1/guest/actions/resume")).toHaveLength(1);
  expect(calls.find(call => call.path === "/v1/guest/actions/resume")?.body.submissionId).toBe(registered.submissionId);
  expect(calls.some(call => call.path === "/v1/guest/claim" || call.path === "/v1/runs" || call.path === `/v1/runs/${id(5)}/continue`)).toBe(false);
  await act(async () => { renderer.unmount(); });
});

it("CLAIM-14 mounted App confirms an uncertain B registration before abandoning B for edited C", async () => {
  await held.device.saveBootstrap(context, proof);
  const pendingInput = { id: id(18), type: "clarification" as const, field: "geography" as const, briefRevision: 2 };
  const original = createGuestPendingAction({ submissionId: id(3), guestContextId: context.guestContextId, conversationId: context.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex("A"), payload: { kind: "clarification", text: "A", pendingInputId: pendingInput.id, briefRevision: 2, field: "geography" },
    consentPolicyVersion: context.consentPolicyVersion, createdAt: "2026-09-21T00:00:00.000Z", expiresAt: context.expiresAt });
  await held.device.savePendingAction(original);
  const auth = completeGuestAuth(beginGuestAuth(original, { id: id(8), provider: "email" }, new Date("2026-09-21T01:00:00.000Z")), id(8), id(7), new Date("2026-09-21T01:00:00.000Z"));
  const claim = completeGuestClaim(beginGuestClaim(auth, id(9), new Date("2026-09-21T01:00:00.000Z")), { type: "claim_accepted", submissionId: id(3), requestId: id(9), accountId: id(7),
    conversationId: context.conversationId, conversationVersion: 1, controlVersion: 1, principalEpoch: 1, viewEpoch: 1 }, new Date("2026-09-21T01:00:00.000Z"));
  const abandoned = cancelGuestPendingAction(claim, new Date("2026-09-21T01:00:00.000Z"));
  await held.device.savePendingAction(abandoned, original);
  const pendingB = prepareMemberClarificationReplacement(abandoned, { kind: "clarification", text: "B", pendingInputId: pendingInput.id, briefRevision: 2, field: "geography" }, id(10), 1,
    new Date("2026-09-21T01:01:00.000Z"), { principalEpoch: 1, viewEpoch: 1 });
  await held.device.replaceAbandonedAction(abandoned, pendingB);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), consentGranted: true, routeMode: "controlled-research", status: "awaiting_input",
    run: { runId: id(5), lifecycle: "awaiting_input", phase: "planning", outcome: null, reportId: null, labeledDemo: false, pendingInput } }, 1);
  const calls: { path: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(String(init.body)) : null; calls.push({ path, body });
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/consent") return Response.json({ granted: true, policyVersion: "consent.v1" });
    if (path === "/v1/guest/actions/register-member") return Response.json({ type: "member_action_registered", submissionId: body.submissionId, claimRequestId: id(9), controlVersion: 1,
      payloadDigest: body.payloadDigest, expiresAt: context.expiresAt, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: "consent.v1" });
    if (path === "/v1/guest/actions/abandon") return Response.json({ type: "action_abandoned", submissionId: body.submissionId, claimRequestId: id(9) });
    if (path === "/v1/guest/actions/resolve") return Response.json({ type: "member_action_registered", submissionId: body.submissionId, claimRequestId: id(9), controlVersion: 1,
      payloadDigest: calls.filter(call => call.path === "/v1/guest/actions/register-member").at(-1)!.body.payloadDigest,
      expiresAt: context.expiresAt, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: "consent.v1" });
    if (path === "/v1/guest/actions/resume") return Response.json({ type: "continuation_dispatched", submissionId: body.submissionId, claimRequestId: id(9), accountId: id(7),
      conversationId: context.conversationId, conversationVersion: 1, receiptId: id(19), runId: id(20), memberConversationId: id(21), kind: "clarification" });
    if (path === `/v1/runs/${id(20)}`) return Response.json({ runId: id(20), lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(20)}/events`) return Response.json({ events: [] });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: true, getToken: async () => memberToken } as any} />); });
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchHeader").props.onSettings(); });
  await act(async () => { await renderer.root.find(node => String(node.type) === "ProfilePanel").props.onConsent(); });
  await act(async () => { renderer.root.find(node => String(node.type) === "ProfilePanel").props.onDone(); });
  const brief = () => renderer.root.find(node => String(node.type) === "ResearchBriefCard");
  expect(brief().props.clarifyAnswer).toBe("B");
  await act(async () => { brief().props.onClarify("C"); });
  await act(async () => { brief().props.onContinue(); await Promise.resolve(); });
  await vi.waitFor(() => expect(calls.some(call => call.path === "/v1/guest/actions/resume")).toBe(true));
  const registrations = calls.filter(call => call.path === "/v1/guest/actions/register-member").map(call => call.body);
  expect(registrations.map(body => body.payload.text)).toEqual(["B", "C"]);
  expect(registrations[1].replacedSubmissionId).toBe(pendingB.submissionId);
  expect(calls.findIndex(call => call.path === "/v1/guest/actions/abandon")).toBeGreaterThan(calls.findIndex(call => call.path === "/v1/guest/actions/register-member"));
  expect(calls.filter(call => call.path === "/v1/guest/actions/resume")).toHaveLength(1);
  expect(calls.find(call => call.path === "/v1/guest/actions/resume")?.body.submissionId).toBe(registrations[1].submissionId);
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 mounted App forces a bounded Clerk refresh after old-bearer 401 without replaying consent or losing the draft", async () => {
  held.session.hydrate = async () => ({ token: "token-one", accountId: id(7), state: { ...emptyState(), draft: "third question", signedIn: true, routeMode: "controlled-research" } });
  const rotations: string[] = [];
  held.session.rotateCredential = async (old: string, next: { token: string }) => { rotations.push(`${old}:${next.token}`); };
  let forced = false;
  const auth = { loaded: true, signedIn: true, getToken: async (options?: { skipCache?: boolean }) => {
    if (options?.skipCache) forced = true;
    return forced ? "token-two" : "token-one";
  } };
  const calls: { path: string; bearer: string | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, bearer = (init.headers as Record<string, string> | undefined)?.authorization;
    calls.push({ path, bearer });
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/consent") return bearer === "Bearer token-one" ? Response.json({ message: "expired bearer" }, { status: 401 }) : Response.json({ granted: true, policyVersion: "consent.v1" });
    if (path === "/v1/settings") return Response.json({ liveRouteEnabled: true });
    if (path === "/v1/runs") return Response.json({ runId: id(15), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(15)}`) return Response.json({ runId: id(15), lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(15)}/events`) return Response.json({ events: [] });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth as any} />); });
  const header = () => renderer.root.find(node => String(node.type) === "ResearchHeader");
  await act(async () => { header().props.onSettings(); });
  const panel = () => renderer.root.find(node => String(node.type) === "ProfilePanel");
  await act(async () => { await panel().props.onConsent(); });
  expect(forced).toBe(true);
  expect(rotations).toEqual(["token-one:token-two"]);
  expect(calls.filter(call => call.path === "/v1/consent")).toEqual([{ path: "/v1/consent", bearer: "Bearer token-one" }]);
  await act(async () => { await panel().props.onConsent(); });
  expect(calls.filter(call => call.path === "/v1/consent").map(call => call.bearer)).toEqual(["Bearer token-one", "Bearer token-two"]);
  await act(async () => { panel().props.onDone(); });
  expect(renderer.root.find(node => String(node.type) === "ResearchComposer").props.draft).toBe("third question");
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchComposer").props.onSend(); await Promise.resolve(); });
  await vi.waitFor(() => expect(calls.some(call => call.path === "/v1/runs")).toBe(true));
  expect(calls.find(call => call.path === "/v1/runs")?.bearer).toBe("Bearer token-two");
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 mounted App treats a repeated 401 after forced refresh as revoked and does not send saved research", async () => {
  held.session.hydrate = async () => ({ token: "revoked-token", accountId: id(7), state: { ...emptyState(), draft: "keep this", signedIn: true } });
  const options: unknown[] = [], paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname; paths.push(path);
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/consent") return Response.json({ message: "revoked" }, { status: 401 });
    return Response.json({});
  }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: true, getToken: async (opts?: unknown) => { options.push(opts); return "revoked-token"; } } as any} />); });
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchHeader").props.onSettings(); });
  await act(async () => { await renderer.root.find(node => String(node.type) === "ProfilePanel").props.onConsent(); });
  expect(options).toContainEqual({ skipCache: true });
  expect(paths.filter(path => path === "/v1/consent")).toHaveLength(1);
  expect(paths).not.toContain("/v1/runs");
  expect(api.currentCredential()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("AUTH-06 mounted App discards an old in-flight run read after refresh, polls with the new bearer, then sends a third message", async () => {
  const oldRun = id(5);
  held.session.hydrate = async () => ({ token: "token-one", accountId: id(7), state: { ...emptyState(), signedIn: true, consentGranted: true,
    routeMode: "controlled-research", status: "progress", run: { runId: oldRun, lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false } } });
  let tokenReads = 0, releaseOld!: (value: Response) => void, poll!: () => void;
  const oldReply = new Promise<Response>(resolve => { releaseOld = resolve; });
  vi.stubGlobal("setInterval", (callback: () => void) => { poll = callback; return 1; });
  vi.stubGlobal("clearInterval", () => undefined);
  const calls: { path: string; bearer: string | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, bearer = (init.headers as Record<string, string> | undefined)?.authorization;
    calls.push({ path, bearer });
    if (path === "/v1/session") return Response.json({ actorKind: "member", accountId: id(7) });
    if (path === "/v1/auth/capabilities") return Response.json({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === "/v1/consent") return Response.json({ granted: true, policyVersion: "consent.v1" });
    if (path === `/v1/runs/${oldRun}` && bearer === "Bearer token-one") return oldReply;
    if (path === `/v1/runs/${oldRun}`) return Response.json({ runId: oldRun, lifecycle: "queued", phase: "searching", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${oldRun}/events`) return Response.json({ events: [] });
    if (path === "/v1/settings") return Response.json({ liveRouteEnabled: true });
    if (path === "/v1/runs") return Response.json({ runId: id(15), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(15)}`) return Response.json({ runId: id(15), lifecycle: "queued", phase: "preparing", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(15)}/events`) return Response.json({ events: [] });
    return Response.json({});
  }));
  const auth = { loaded: true, signedIn: true, getToken: async () => ++tokenReads <= 2 ? "token-one" : "token-two" };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth as any} />); });
  await vi.waitFor(() => expect(calls.some(call => call.path === `/v1/runs/${oldRun}` && call.bearer === "Bearer token-one")).toBe(true));
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchHeader").props.onSettings(); });
  await act(async () => { await renderer.root.find(node => String(node.type) === "ProfilePanel").props.onConsent(); });
  expect(api.currentCredential()).toBe("token-two");
  releaseOld(Response.json({ runId: oldRun, lifecycle: "terminal", phase: "done", outcome: "completed", reportId: id(22), labeledDemo: false }));
  await act(async () => { await Promise.resolve(); poll(); await Promise.resolve(); });
  await vi.waitFor(() => expect(calls.some(call => call.path === `/v1/runs/${oldRun}` && call.bearer === "Bearer token-two")).toBe(true));
  await act(async () => { renderer.root.find(node => String(node.type) === "ProfilePanel").props.onDone(); });
  expect(renderer.root.find(node => String(node.type) === "ResearchActivity").props.lifecycle).toBe("queued");
  await act(async () => { renderer.root.find(node => String(node.type) === "ResearchHeader").props.onNewResearch(); });
  const composer = () => renderer.root.find(node => String(node.type) === "ResearchComposer");
  await act(async () => { composer().props.onChange("third question"); });
  await act(async () => { composer().props.onSend(); await Promise.resolve(); });
  await vi.waitFor(() => expect(calls.some(call => call.path === "/v1/runs" && call.bearer === "Bearer token-two")).toBe(true));
  expect(calls.filter(call => call.path === "/v1/runs")).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});
