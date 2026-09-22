import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";
import { beginGuestAuth, completeGuestAuth, createGuestPendingAction } from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

// Held-out AUD03 matrix: returning-member direct login, early private-upload
// login, second-Send claim preservation, sponsorship/existing/canceled/
// Library edges — real mounted App. Expiry 2027 resists clock rot.
const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 300 }));
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
const proof = "p".repeat(43);
const EXPIRY = "2027-01-01T00:00:00.000Z";
const M = id(301);
const memberToken = "member-token";
const baseContext = { guestContextId: id(302), conversationId: id(303), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 0, consentGranted: true };

type Call = { method: string; path: string; body: any; auth: string | null; proof: string | null };
const ok = (value: any) => Response.json(value);

function stubFetch(calls: Call[], routes: (method: string, path: string, body: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = String(init.method ?? "GET");
    calls.push({ method, path: u.pathname, body, auth: headers.authorization ?? null, proof: headers["x-norrow-guest-proof"] ?? null });
    return routes(method, u.pathname, body);
  }));
}

// Runtime-relative journal window: pending actions must live within a 24h
// validity span (GUEST_PENDING_ACTION_MAX_AGE_MS) and stay future-dated, so
// fixed calendar fixtures would rot against the wall clock (AUD06 class).
function freshWindow() {
  const now = Date.now();
  return { createdAt: new Date(now - 5 * 60_000).toISOString(), expiresAt: new Date(now + 23 * 3600_000).toISOString(), now: new Date(now) };
}
const admitted = (runId: string) => ({ runId, lifecycle: "queued", phase: "preparing", labeledDemo: false });
const queuedSnap = (runId: string) => ({ runId, lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
const terminalSnap = (runId: string, reportId: string | null) =>
  ({ runId, lifecycle: "terminal", phase: "done", outcome: "completed", reportId, labeledDemo: false });

beforeEach(async () => {
  held.id = 300;
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
afterEach(() => { api.activateSession(null); api.clearGuest(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function seedMemberHydrate(extra: Record<string, unknown> = {}) {
  held.session.hydrate = async () => ({ token: memberToken, accountId: M,
    state: { ...emptyState(), consentGranted: true, signedIn: true, routeMode: "controlled-research", ...extra } });
}
async function mountWith(auth: any) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  return renderer;
}
const guestAuth = { loaded: true, signedIn: false } as any;
const memberAuth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => memberToken } as any;
const composerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchComposer");
const sheetOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "GuestSignInSheet");
const headerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchHeader");
const panelOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ProfilePanel");
const allText = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children ?? "")).join(" ");
async function waitHydrated(renderer: TestRenderer.ReactTestRenderer) {
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
}

it("R-DIRECT-01a returning member sends with no guest funnel", async () => {
  seedMemberHydrate();
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(310)));
    if (path === `/v1/runs/${id(310)}`) return ok(queuedSnap(id(310)));
    if (path === `/v1/runs/${id(310)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await waitHydrated(renderer);
  await act(async () => { composerOf(renderer).props.onChange("Best laptop under $2k?"); });
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  const admissions = calls.filter((c) => c.method === "POST" && c.path === "/v1/runs");
  expect(admissions).toHaveLength(1);
  expect(admissions[0]?.auth).toBe(`Bearer ${memberToken}`);
  expect(admissions[0]?.body.routeMode).toBe("controlled-research");
  expect(calls.filter((c) => c.path === "/v1/guest/bootstrap")).toHaveLength(0);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions")).toHaveLength(0);
  expect(sheetOf(renderer).props.visible).toBe(false);
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("R-DIRECT-01b settings sign-in connects a verified Clerk session directly", async () => {
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "second message", consentGranted: true, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(311)));
    if (path === `/v1/runs/${id(311)}`) return ok(queuedSnap(id(311)));
    if (path === `/v1/runs/${id(311)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(guestAuth);
  await waitHydrated(renderer);
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { renderer.update(<AppInner auth={memberAuth} />); });
  await act(async () => { panelOf(renderer).props.onSignIn(); });
  await vi.waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path === "/v1/session" && c.auth === `Bearer ${memberToken}`)).toBe(true));
  expect(calls.filter((c) => c.path === "/v1/guest/bootstrap")).toHaveLength(0);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions")).toHaveLength(0);
  expect(sheetOf(renderer).props.visible).toBe(false);
  await act(async () => { headerOf(renderer).props.onDone(); });
  expect(String(composerOf(renderer).props.draft)).toBe("second message");
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { await panelOf(renderer).props.onConsent(); });
  await act(async () => { headerOf(renderer).props.onDone(); });
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it("R-DIRECT-02 returning member reads a Library item directly", async () => {
  seedMemberHydrate({ tab: "library" });
  const calls: Call[] = [];
  const reportId = id(313);
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${id(312)}`) return ok(terminalSnap(id(312), reportId));
    if (path === `/v1/runs/${id(312)}/events`) return ok({ events: [] });
    if (path === `/v1/reports/${reportId}`) {
      return ok({ reportId, version: 1, blocks: [{ id: "answer", kind: "answer", text: "Result.", claimIds: [], citationIds: [] }], limitations: [], labeledDemo: false });
    }
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "LibraryList")).toHaveLength(1));
  const list = () => renderer.root.find((node) => String(node.type) === "LibraryList");
  await act(async () => { await list().props.onOpen(id(312)); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "ReportSections")).toHaveLength(1));
  const sections = renderer.root.find((node) => String(node.type) === "ReportSections");
  expect(sections.props.blocks).toHaveLength(1);
  expect(calls.filter((c) => (c.proof ?? null) !== null)).toHaveLength(0);
  expect(calls.filter((c) => c.path.startsWith("/v1/guest/"))).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("R-UPLOAD-03 guest with documents is refused before any upload", async () => {
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "Best laptop under $2k?", consentGranted: true, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, () => ok({}));
  const renderer = await mountWith(guestAuth);
  await waitHydrated(renderer);
  const panel = () => renderer.root.find((node) => String(node.type) === "AttachmentPanel");
  await act(async () => { panel().props.onAttachUrl({ filename: "note.txt", mime: "text/plain", text: "private bytes" }); });
  expect(panel().props.attachments).toHaveLength(1);
  await act(async () => { composerOf(renderer).props.onSend(); });
  await vi.waitFor(() => expect(allText(renderer)).toMatch(/Sign in before adding documents/));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/attachments")).toHaveLength(0);
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(0);
  expect(String(composerOf(renderer).props.draft)).toBe("Best laptop under $2k?");
  await act(async () => { renderer.unmount(); });
});

it("R-UPLOAD-04 post-login upload rides the member admission under a member bearer", async () => {
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "Best laptop under $2k?", consentGranted: true, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/consent") return ok({ granted: true });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    if (method === "POST" && path === "/v1/attachments") return ok({ attachmentId: id(314) });
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(315)));
    if (path === `/v1/runs/${id(315)}`) return ok(queuedSnap(id(315)));
    if (path === `/v1/runs/${id(315)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(guestAuth);
  await waitHydrated(renderer);
  const panel = () => renderer.root.find((node) => String(node.type) === "AttachmentPanel");
  await act(async () => { panel().props.onAttachUrl({ filename: "note.txt", mime: "text/plain", text: "private bytes" }); });
  await act(async () => { composerOf(renderer).props.onSend(); });
  await vi.waitFor(() => expect(allText(renderer)).toMatch(/Sign in before adding documents/));
  await act(async () => { renderer.update(<AppInner auth={memberAuth} />); });
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { panelOf(renderer).props.onSignIn(); });
  await vi.waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path === "/v1/session" && c.auth === `Bearer ${memberToken}`)).toBe(true));
  expect(panel().props.attachments).toHaveLength(1);
  await act(async () => { headerOf(renderer).props.onDone(); });
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { await panelOf(renderer).props.onConsent(); });
  await act(async () => { headerOf(renderer).props.onDone(); });
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  const uploads = calls.filter((c) => c.method === "POST" && c.path === "/v1/attachments");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]?.auth).toBe(`Bearer ${memberToken}`);
  expect(uploads[0]?.proof ?? null).toBeNull();
  const admissions = calls.filter((c) => c.method === "POST" && c.path === "/v1/runs");
  expect(admissions).toHaveLength(1);
  expect(admissions[0]?.body.attachmentIds).toEqual([id(314)]);
  expect(admissions[0]?.auth).toBe(`Bearer ${memberToken}`);
  await act(async () => { renderer.unmount(); });
});

it("R-CLAIM-05 saved second message survives login and dispatches exactly once", async () => {
  const text = "What about battery life?";
  const window = freshWindow();
  const original = createGuestPendingAction({ submissionId: id(320), guestContextId: baseContext.guestContextId, conversationId: baseContext.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex(text), payload: { kind: "new_research", text },
    consentPolicyVersion: baseContext.consentPolicyVersion, createdAt: window.createdAt, expiresAt: window.expiresAt });
  const authing = beginGuestAuth(original, { id: id(321), provider: "google" }, window.now);
  await held.device.saveBootstrap({ ...baseContext, acceptedTurnCount: 1 }, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: text, consentGranted: true, routeMode: "controlled-research" });
  await held.device.savePendingAction(authing, null);
  const snapshots: any[] = [];
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { snapshots.push(snapshot); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/auth/capabilities") return ok({ apple: false, google: true, emailCode: false, termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" });
    if (path === "/v1/guest/pending-actions/attempts/resolve") {
      return ok({ submissionId: id(320), authAttemptId: id(321), attemptRevision: 1, state: "authenticating" });
    }
    if (path === "/v1/guest/claim") {
      return ok({ type: "claim_accepted", submissionId: id(320), requestId: body.claimRequestId, accountId: M, conversationId: baseContext.conversationId,
        conversationVersion: 1, controlVersion: 1, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: baseContext.consentPolicyVersion });
    }
    if (path === "/v1/guest/actions/resume") {
      return ok({ type: "continuation_dispatched", submissionId: id(320), claimRequestId: body.claimRequestId, accountId: M,
        conversationId: baseContext.conversationId, conversationVersion: 1, receiptId: id(322), runId: id(323), memberConversationId: id(324), kind: "new_research" });
    }
    if (path === `/v1/runs/${id(323)}`) return ok(queuedSnap(id(323)));
    if (path === `/v1/runs/${id(323)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await vi.waitFor(() => expect(calls.filter((c) => c.path === "/v1/guest/actions/resume")).toHaveLength(1));
  expect(calls.filter((c) => c.path === "/v1/guest/claim")).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/attempts/begin")).toHaveLength(0);
  expect(await held.device.load()).toBeNull();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(snapshots.some((s) => s.conversationId === id(324) && s.run?.runId === id(323))).toBe(true);
  await act(async () => { renderer.unmount(); });
});

it("R-EXIST-07 existing-account collision holds the journal and never mounts it", async () => {
  const other = id(330);
  const window = freshWindow();
  const original = createGuestPendingAction({ submissionId: id(331), guestContextId: baseContext.guestContextId, conversationId: baseContext.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex("saved question"), payload: { kind: "new_research", text: "saved question" },
    consentPolicyVersion: baseContext.consentPolicyVersion, createdAt: window.createdAt, expiresAt: window.expiresAt });
  const authing = beginGuestAuth(original, { id: id(332), provider: "google" }, window.now);
  const authed = completeGuestAuth(authing, id(332), other, window.now);
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "saved question", consentGranted: true, routeMode: "controlled-research" });
  await held.device.savePendingAction(authed, null);
  held.session.hydrate = async () => ({ token: "other-token", accountId: M, state: { ...emptyState(), draft: "member draft", signedIn: true } });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    return ok({});
  });
  const renderer = await mountWith({ loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => "other-token" } as any);
  await waitHydrated(renderer);
  // The member's own stored draft is theirs to see; the other account's
  // guest draft must never mount in its place.
  expect(composerOf(renderer).props.draft).toBe("member draft");
  expect(composerOf(renderer).props.draft).not.toBe("saved question");
  expect(allText(renderer)).toMatch(/another account is held/);
  expect(renderer.root.findAll((node) => String(node.type) === "ReportSections")).toHaveLength(0);
  expect(calls.filter((c) => c.path === "/v1/guest/claim" || c.path === "/v1/guest/actions/resume")).toHaveLength(0);
  expect((await held.device.load()).pendingAction?.authenticatedAccountId).toBe(other);
  await act(async () => { renderer.unmount(); });
});

it("R-CANCEL-08 canceled provider holds the message and login retries it as a fresh member run", async () => {
  const text = "What about battery life?";
  const window = freshWindow();
  const original = createGuestPendingAction({ submissionId: id(340), guestContextId: baseContext.guestContextId, conversationId: baseContext.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex(text), payload: { kind: "new_research", text },
    consentPolicyVersion: baseContext.consentPolicyVersion, createdAt: window.createdAt, expiresAt: window.expiresAt });
  await held.device.saveBootstrap({ ...baseContext, acceptedTurnCount: 1 }, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: text, consentGranted: true, routeMode: "controlled-research" });
  await held.device.savePendingAction(original, null);
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (path === "/v1/auth/capabilities") return ok({ apple: false, google: true, emailCode: false, termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" });
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/consent") return ok({ granted: true });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    if (path === "/v1/guest/pending-actions/attempts/begin") {
      return ok({ submissionId: body.submissionId, authAttemptId: body.authAttemptId, attemptRevision: 1, state: "authenticating" });
    }
    if (path === "/v1/guest/pending-actions/attempts/end") {
      return ok({ submissionId: body.submissionId, authAttemptId: body.authAttemptId, attemptRevision: 1, state: "cancelled" });
    }
    if (method === "POST" && path === "/v1/guest/pending-actions/cancel") {
      return ok({ type: "action_abandoned", submissionId: body.submissionId });
    }
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(341)));
    if (path === `/v1/runs/${id(341)}`) return ok(queuedSnap(id(341)));
    if (path === `/v1/runs/${id(341)}/events`) return ok({ events: [] });
    if (path === "/v1/guest/claim") {
      return ok({ type: "claim_accepted", submissionId: id(340), requestId: body.claimRequestId, accountId: M, conversationId: baseContext.conversationId,
        conversationVersion: 1, controlVersion: 1, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: baseContext.consentPolicyVersion });
    }
    if (path === "/v1/guest/actions/resume") {
      return ok({ type: "continuation_dispatched", submissionId: id(340), claimRequestId: body.claimRequestId, accountId: M,
        conversationId: baseContext.conversationId, conversationVersion: 1, receiptId: id(342), runId: id(343), memberConversationId: id(344), kind: "new_research" });
    }
    if (path === `/v1/runs/${id(343)}`) return ok(queuedSnap(id(343)));
    if (path === `/v1/runs/${id(343)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(guestAuth);
  await waitHydrated(renderer);
  await vi.waitFor(() => expect(calls.some((c) => c.path === "/v1/auth/capabilities")).toBe(true));
  await act(async () => {});
  let attempt!: { id: string; provider: string; operation: string };
  await act(async () => { attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" }); });
  expect(typeof attempt?.id).toBe("string");
  await act(async () => { await sheetOf(renderer).props.transport.cancelProvider(attempt); });
  // A provider cancel holds the exact message for retry: no claim, no new
  // attempt, the journal back at pending_auth with no dangling attempt.
  await vi.waitFor(() => expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/attempts/end")).toHaveLength(1));
  expect(calls.find((c) => c.path === "/v1/guest/pending-actions/attempts/end")?.body.reason).toBe("cancelled");
  const heldAction = (await held.device.load()).pendingAction;
  expect(heldAction?.phase).toBe("pending_auth");
  expect(heldAction?.authAttempt).toBeNull();
  expect(heldAction?.submissionId).toBe(id(340));
  expect(calls.filter((c) => c.path === "/v1/guest/claim" || c.path === "/v1/guest/actions/resume")).toHaveLength(0);
  // Retry begins a new attempt revision under the same submission, then the
  // provider success claims and dispatches exactly once.
  await act(async () => { renderer.update(<AppInner auth={{ ...memberAuth, startProvider: async () => "active" } as any} />); });
  let retry!: { id: string; provider: string; operation: string };
  await act(async () => { retry = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" }); });
  expect(retry.id).not.toBe(attempt.id);
  await act(async () => { await sheetOf(renderer).props.transport.startProvider(retry); });
  await vi.waitFor(() => expect(calls.filter((c) => c.path === "/v1/guest/actions/resume")).toHaveLength(1));
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/attempts/begin")).toHaveLength(2);
  expect(calls.filter((c) => c.path === "/v1/guest/claim")).toHaveLength(1);
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("R-LIB-09 invalidated Library item redacts before any report fetch", async () => {
  seedMemberHydrate({ tab: "library" });
  let redacted: { token: string; runId: string } | null = null;
  held.session.redactRunContent = async (token: string, runId: string) => { redacted = { token, runId }; };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${id(350)}`) {
      return ok({ runId: id(350), contentInvalidated: true, lifecycle: "terminal", phase: "done", outcome: "completed", reportId: id(351), labeledDemo: false });
    }
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "LibraryList")).toHaveLength(1));
  const list = () => renderer.root.find((node) => String(node.type) === "LibraryList");
  await act(async () => { await list().props.onOpen(id(350)); });
  await vi.waitFor(() => expect(redacted).not.toBeNull());
  expect(redacted).toEqual({ token: memberToken, runId: id(350) });
  expect(renderer.root.findAll((node) => String(node.type) === "ReportSections")).toHaveLength(0);
  expect(calls.filter((c) => c.path === `/v1/reports/${id(351)}`)).toHaveLength(0);
  expect(allText(renderer)).toMatch(/deleted source/);
  await act(async () => { renderer.unmount(); });
});

it("R-CLAIM-NULL-CONSENT null consent policy version does not block claim", async () => {
  const text = "What about battery life?";
  const window = freshWindow();
  const original = createGuestPendingAction({ submissionId: id(360), guestContextId: baseContext.guestContextId, conversationId: baseContext.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex(text), payload: { kind: "new_research", text },
    consentPolicyVersion: baseContext.consentPolicyVersion, createdAt: window.createdAt, expiresAt: window.expiresAt });
  const authing = beginGuestAuth(original, { id: id(361), provider: "google" }, window.now);
  await held.device.saveBootstrap({ ...baseContext, acceptedTurnCount: 1 }, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: text, consentGranted: true, routeMode: "controlled-research" });
  await held.device.savePendingAction(authing, null);
  const snapshots: any[] = [];
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { snapshots.push(snapshot); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/auth/capabilities") return ok({ apple: false, google: true, emailCode: false, termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" });
    if (path === "/v1/guest/pending-actions/attempts/resolve") {
      return ok({ submissionId: id(360), authAttemptId: id(361), attemptRevision: 1, state: "authenticating" });
    }
    if (path === "/v1/guest/claim") {
      return ok({ type: "claim_accepted", submissionId: id(360), requestId: body.claimRequestId, accountId: M, conversationId: baseContext.conversationId,
        conversationVersion: 1, controlVersion: 1, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: null });
    }
    if (path === "/v1/guest/actions/resume") {
      return ok({ type: "continuation_dispatched", submissionId: id(360), claimRequestId: body.claimRequestId, accountId: M,
        conversationId: baseContext.conversationId, conversationVersion: 1, receiptId: id(362), runId: id(363), memberConversationId: id(364), kind: "new_research" });
    }
    if (path === `/v1/runs/${id(363)}`) return ok(queuedSnap(id(363)));
    if (path === `/v1/runs/${id(363)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountWith(memberAuth);
  await vi.waitFor(() => expect(calls.filter((c) => c.path === "/v1/guest/actions/resume")).toHaveLength(1));
  expect(calls.filter((c) => c.path === "/v1/guest/claim")).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/attempts/begin")).toHaveLength(0);
  expect(await held.device.load()).toBeNull();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(snapshots.some((s) => s.conversationId === id(364) && s.run?.runId === id(363))).toBe(true);
  await act(async () => { renderer.unmount(); });
});
