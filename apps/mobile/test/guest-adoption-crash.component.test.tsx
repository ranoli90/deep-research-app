import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";
import { beginGuestActionResume, beginGuestAuth, beginGuestClaim, completeGuestAuth, completeGuestClaim, createGuestPendingAction, markGuestActionDispatched } from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

// R04: a crash between the terminal handoff journal and the member snapshot
// must never discard the only accepted child. The journal now binds the
// dispatch receipt to the exact child run/conversation, and hydration verifies
// and restores that child without creating a replacement paid request.
const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 500 }));
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
vi.mock("../src/native-document-digest", () => ({ nativeDocumentDigest: async () => new Uint8Array(32) }));
vi.mock("../src/haptics", () => ({ productHaptic: () => undefined }));
vi.mock("../src/use-keyboard-inset", () => ({ useKeyboardInset: () => ({ keyboardOpen: false, keyboardInset: 0, keyboardOpenRef: { current: false }, keyboardInsetRef: { current: 0 }, dismissKeyboard: () => undefined }) }));
vi.mock("../src/product-styles", () => ({ makeStyles: () => new Proxy({}, { get: () => ({}) }) }));
vi.mock("../src/ResearchComposer", () => ({ ResearchComposer: "ResearchComposer" }));
vi.mock("../src/auth/GuestSignInSheet", () => ({ GuestSignInSheet: "GuestSignInSheet" }));
vi.mock("../src/auth/ClerkSessionTaskView", () => ({ ClerkSessionTaskView: "ClerkSessionTaskView" }));
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
const proof = "p".repeat(43), memberToken = "member-token";
const M = id(301), other = id(330);
const CHILD_RUN = id(323), CHILD_CONV = id(324), RECEIPT = id(322), SUBMISSION = id(320), CLAIM_REQ = id(321);
const OLD_RUN = id(500), OLD_CONV = id(501), OLD_REPORT = id(502);
const baseContext = { guestContextId: id(302), conversationId: id(303), conversationVersion: 1, expiresAt: "2026-09-22T00:00:00.000Z", consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 1, consentGranted: true };

type Call = { method: string; path: string; body: any; auth: string | null };
const ok = (value: any) => Response.json(value);
function stubFetch(calls: Call[], routes: (method: string, path: string, body: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = String(init.method ?? "GET");
    calls.push({ method, path: u.pathname, body, auth: headers.authorization ?? null });
    return routes(method, u.pathname, body);
  }));
}
function freshWindow() {
  const now = Date.now();
  return { createdAt: new Date(now - 5 * 60_000).toISOString(), expiresAt: new Date(now + 23 * 3600_000).toISOString(), now: new Date(now) };
}
const queuedSnap = (runId: string) => ({ runId, lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });

beforeEach(async () => {
  held.id = 500;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T01:00:00.000Z"));
  const ordinary = memoryStore(), native = memoryStore(), secure = memoryStore();
  const content = createProtectedContentStore(ordinary, native);
  await content.setItem("deep.install.v2", "1");
  held.device = createGuestDeviceStore(content, secure);
  held.session = { hydrate: async () => ({ token: null, accountId: null, state: emptyState() }), activate: async () => undefined,
    rotateCredential: async () => undefined, persist: async () => undefined, persistRequired: async () => undefined,
    saveAdmission: async () => undefined, finishAdmission: async () => undefined, flush: async () => undefined, clear: async () => undefined,
    redactRunContent: async () => undefined, readCorrectionDocuments: async () => null, finishCorrectionDocuments: async () => undefined };
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => callback());
});
afterEach(() => { api.activateSession(null); api.clearGuest(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Reconstruct the server-accepted child journal a crash would leave behind:
// phase "dispatched" with the exact receipt -> run/conversation binding, while
// the member snapshot is still whatever the member had before adoption.
function buildResuming(actionAccount: string) {
  const w = freshWindow();
  const text = "child question";
  const original = createGuestPendingAction({ submissionId: SUBMISSION, guestContextId: baseContext.guestContextId, conversationId: baseContext.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex(text), payload: { kind: "new_research", text },
    consentPolicyVersion: baseContext.consentPolicyVersion, createdAt: w.createdAt, expiresAt: w.expiresAt });
  const authed = completeGuestAuth(beginGuestAuth(original, { id: id(305), provider: "google" }, w.now), id(305), actionAccount, w.now);
  const claimed = completeGuestClaim(beginGuestClaim(authed, CLAIM_REQ, w.now), { type: "claim_accepted", submissionId: SUBMISSION, requestId: CLAIM_REQ, accountId: actionAccount,
    conversationId: baseContext.conversationId, conversationVersion: 1, controlVersion: 1, principalEpoch: 1, viewEpoch: 1 }, w.now);
  const resuming = beginGuestActionResume(claimed, { now: w.now, accountId: actionAccount, sessionActive: true, guestContextId: baseContext.guestContextId,
    conversationId: baseContext.conversationId, conversationVersion: 1, controlVersion: 1, principalEpoch: 1, viewEpoch: 1, credentialGeneration: 0,
    draftRevision: 0, draftDigest: sha256Hex(text), consentPolicyVersion: baseContext.consentPolicyVersion, authorityAllowed: true, budgetAllowed: true });
  return { resuming, w, text };
}
async function seedResuming(actionAccount = M) {
  const { resuming, text } = buildResuming(actionAccount);
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: text, consentGranted: true, routeMode: "controlled-research" });
  await held.device.savePendingAction(resuming);
  return resuming;
}
async function seedDispatched(actionAccount = M) {
  const { resuming, w } = buildResuming(actionAccount);
  const dispatched = markGuestActionDispatched(resuming, { type: "continuation_dispatched", submissionId: SUBMISSION, claimRequestId: CLAIM_REQ, accountId: actionAccount,
    conversationId: baseContext.conversationId, conversationVersion: 1, receiptId: RECEIPT, runId: CHILD_RUN, memberConversationId: CHILD_CONV }, w.now);
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "child question", consentGranted: true, routeMode: "controlled-research" });
  await held.device.savePendingAction(dispatched);
  return dispatched;
}
function seedMemberHydrate(extra: Record<string, unknown> = {}) {
  held.session.hydrate = async () => ({ token: memberToken, accountId: M,
    state: { ...emptyState(), consentGranted: true, signedIn: true, routeMode: "controlled-research", ...extra } });
}
const oldMemberState = { conversationId: OLD_CONV, status: "completed" as const,
  run: { runId: OLD_RUN, lifecycle: "terminal" as const, phase: "done", outcome: "completed" as const, reportId: OLD_REPORT, labeledDemo: false },
  report: { reportId: OLD_REPORT, version: 1, blocks: [], limitations: [], labeledDemo: false, changeSummary: null } };
const memberAuth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => memberToken } as any;
const guestAuth = { loaded: true, signedIn: false } as any;
async function mountWith(auth: any) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  return renderer;
}
const composerOf = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.find((node) => String(node.type) === "ResearchComposer");
async function waitHydrated(renderer: TestRenderer.ReactTestRenderer) { await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true)); }
function postAdoptions(calls: Call[]) { return calls.filter((c) => c.method === "POST" && ["/v1/guest/actions/resume", "/v1/guest/actions/resolve", "/v1/runs"].includes(c.path)); }

it("R04 kill between terminal journal and member snapshot restores the exact child over an unrelated old member report", async () => {
  seedMemberHydrate({ draft: "member draft", ...oldMemberState });
  await seedDispatched();
  const snapshots: any[] = [];
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { snapshots.push(snapshot); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/auth/capabilities") return ok({ apple: false, google: true, emailCode: false, termsUrl: null, privacyUrl: null });
    if (path === `/v1/runs/${CHILD_RUN}`) return ok(queuedSnap(CHILD_RUN));
    if (path === `/v1/runs/${CHILD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await waitHydrated(renderer);
  await vi.waitFor(() => expect(snapshots.some((s) => s.conversationId === CHILD_CONV && s.run?.runId === CHILD_RUN)).toBe(true));
  expect(await held.device.load()).toBeNull();
  expect(postAdoptions(calls)).toHaveLength(0);
  expect(calls.some((c) => c.method === "GET" && c.path === `/v1/runs/${CHILD_RUN}`)).toBe(true);
  // The unrelated old member report is not adopted as the child result.
  expect(renderer.root.findAll((node) => String(node.type) === "ReportSections")).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("R04 kill between terminal journal and member snapshot restores the exact child with no prior member run", async () => {
  seedMemberHydrate({ draft: "member draft" });
  await seedDispatched();
  const snapshots: any[] = [];
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { snapshots.push(snapshot); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${CHILD_RUN}`) return ok(queuedSnap(CHILD_RUN));
    if (path === `/v1/runs/${CHILD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await waitHydrated(renderer);
  await vi.waitFor(() => expect(snapshots.some((s) => s.conversationId === CHILD_CONV && s.run?.runId === CHILD_RUN)).toBe(true));
  expect(await held.device.load()).toBeNull();
  expect(postAdoptions(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("R04 kill after the member snapshot but before cleanup clears the journal without rewriting the child", async () => {
  seedMemberHydrate({ conversationId: CHILD_CONV, run: { runId: CHILD_RUN, lifecycle: "queued", phase: "queued", outcome: null, reportId: null, labeledDemo: false }, status: "progress" });
  await seedDispatched();
  const snapshots: any[] = [];
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { snapshots.push(snapshot); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${CHILD_RUN}`) return ok(queuedSnap(CHILD_RUN));
    if (path === `/v1/runs/${CHILD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await waitHydrated(renderer);
  await vi.waitFor(async () => expect(await held.device.load()).toBeNull());
  expect(snapshots).toHaveLength(0);
  expect(postAdoptions(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("R04 cleanup failure keeps the journal and a remount still restores the exact child", async () => {
  seedMemberHydrate({ draft: "member draft", ...oldMemberState });
  await seedDispatched();
  const snapshots: any[] = [];
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { snapshots.push(snapshot); };
  const realClear = held.device.clear.bind(held.device);
  let failClear = true;
  held.device.clear = async () => { if (failClear) { failClear = false; throw new Error("cleanup unavailable"); } return realClear(); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${CHILD_RUN}`) return ok(queuedSnap(CHILD_RUN));
    if (path === `/v1/runs/${CHILD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const first = await mountWith(memberAuth);
  await vi.waitFor(async () => expect((await held.device.load())?.pendingAction?.phase).toBe("dispatched"));
  expect(postAdoptions(calls)).toHaveLength(0);
  await act(async () => { first.unmount(); });
  const second = await mountWith(memberAuth);
  await vi.waitFor(async () => expect(await held.device.load()).toBeNull());
  expect(snapshots.some((s) => s.conversationId === CHILD_CONV && s.run?.runId === CHILD_RUN)).toBe(true);
  expect(postAdoptions(calls)).toHaveLength(0);
  await act(async () => { second.unmount(); });
});

it("R04 a verified member B never adopts member A's dispatched child", async () => {
  seedMemberHydrate({ draft: "member draft", ...oldMemberState });
  await seedDispatched(other);
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${OLD_RUN}`) return ok(queuedSnap(OLD_RUN));
    if (path === `/v1/runs/${OLD_RUN}/events`) return ok({ events: [] });
    if (path === `/v1/runs/${CHILD_RUN}`) return ok(queuedSnap(CHILD_RUN));
    if (path === `/v1/runs/${CHILD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await waitHydrated(renderer);
  expect((await held.device.load())?.pendingAction?.authenticatedAccountId).toBe(other);
  // The member's own run is restored and refreshed; member A's child is never touched.
  expect(calls.some((c) => c.method === "GET" && c.path === `/v1/runs/${OLD_RUN}`)).toBe(true);
  expect(calls.every((c) => c.path !== `/v1/runs/${CHILD_RUN}`)).toBe(true);
  expect(postAdoptions(calls)).toHaveLength(0);
  expect(composerOf(renderer).props.draft).toBe("member draft");
  await act(async () => { renderer.unmount(); });
});

it("R04 no verified member session never adopts the dispatched child", async () => {
  await seedDispatched();
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === `/v1/runs/${CHILD_RUN}`) return ok(queuedSnap(CHILD_RUN));
    if (path === `/v1/runs/${CHILD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(guestAuth);
  await act(async () => { await Promise.resolve(); });
  expect((await held.device.load())?.pendingAction?.phase).toBe("dispatched");
  expect(calls.every((c) => c.path !== `/v1/runs/${CHILD_RUN}`)).toBe(true);
  expect(postAdoptions(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("R04 kill while the continuation request is in flight holds it reconcile-only and never resends", async () => {
  seedMemberHydrate({ draft: "member draft", ...oldMemberState });
  await seedResuming();
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${OLD_RUN}`) return ok(queuedSnap(OLD_RUN));
    if (path === `/v1/runs/${OLD_RUN}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await waitHydrated(renderer);
  const heldAction = (await held.device.load())?.pendingAction;
  expect(heldAction?.phase).toBe("resume_reconcile");
  expect(heldAction?.autoResume).toBe(false);
  expect(heldAction?.submissionId).toBe(SUBMISSION);
  expect(heldAction?.claim?.requestId).toBe(CLAIM_REQ);
  // No replacement resume, no replacement run: the original outcome must be resolved.
  expect(postAdoptions(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});
