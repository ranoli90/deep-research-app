import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";

// Held-out AUD02 controls: failure/race + storage/navigation/deletion/
// duplicate-ack through the real mounted App. Expiry 2027 resists clock rot.
const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 200 }));
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
const baseContext = { guestContextId: id(201), conversationId: id(202), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 0, consentGranted: true };

type Call = { method: string; path: string; body: any };
const ok = (value: any) => Response.json(value);

async function seedGuest(draftText: string, extra: Record<string, unknown> = {}, context = baseContext) {
  await held.device.saveBootstrap(context, proof);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: draftText, consentGranted: true, routeMode: "controlled-research", ...extra });
}

function stubFetch(calls: Call[], routes: (method: string, path: string, body: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = String(init.method ?? "GET");
    calls.push({ method, path: u.pathname, body });
    return routes(method, u.pathname, body);
  }));
}

const guestSession = { controlVersion: 1, acceptedTurnCount: 1, consentGranted: true, conversationVersion: 1 };
const admitted = (runId: string) => ({ runId, lifecycle: "queued", phase: "preparing", labeledDemo: false });
const queuedSnap = (runId: string) => ({ runId, lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
const ackFor = (body: any) => ({ code: "AUTH_REQUIRED_NEXT_TURN", submissionId: body.submissionId, controlVersion: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() });

beforeEach(async () => {
  held.id = 200;
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

async function mountGuest() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: false } as any} />); });
  return renderer;
}
const composerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchComposer");
const sheetOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "GuestSignInSheet");
async function waitHydrated(renderer: TestRenderer.ReactTestRenderer) {
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
}

it("D-CTL-08 double-tap during a slow admission sends exactly once", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  let release!: (value: any) => void;
  stubFetch(calls, (method, path) => {
    if (method === "POST" && path === "/v1/runs") return new Promise((resolve) => { release = resolve; });
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(210)}`) return ok(queuedSnap(id(210)));
    if (path === `/v1/runs/${id(210)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await act(async () => { composerOf(renderer).props.onChange("Best laptop under $2k?"); });
  await act(async () => { composerOf(renderer).props.onSend(); });
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  await act(async () => { composerOf(renderer).props.onSend(); });
  await act(async () => { release(ok(admitted(id(210)))); });
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1);
  expect((await held.device.load()).firstRequest?.phase).toBe("accepted");
  await act(async () => { renderer.unmount(); });
});

it("D-CTL-09 storage-not-ready blocks the send with no admission attempt", async () => {
  // The ready gate is observable through a member hydrate whose restored
  // snapshot still carries interrupted cleanup: no preflight, no admission,
  // draft preserved. (Guest snapshots intentionally carry no cleanup marker.)
  const member = "11111111-1111-4111-8111-111111111111";
  held.session.hydrate = async () => ({ token: "member-token", accountId: member,
    state: { ...emptyState(), draft: "Best laptop under $2k?", consentGranted: true, signedIn: true,
      routeMode: "controlled-research", pendingContentInvalidation: id(211) } });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: member, actorKind: "member" });
    return ok({});
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(
    <AppInner auth={{ loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => "member-token" } as any} />); });
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
  expect(String(composerOf(renderer).props.draft)).toBe("Best laptop under $2k?");
  await act(async () => { composerOf(renderer).props.onSend(); });
  await act(async () => {});
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(0);
  expect(calls.filter((c) => c.path === "/v1/settings")).toHaveLength(0);
  expect(calls.filter((c) => c.path === "/v1/guest/bootstrap")).toHaveLength(0);
  expect(String(composerOf(renderer).props.draft)).toBe("Best laptop under $2k?");
  await act(async () => { renderer.unmount(); });
});

it("D-CTL-10 revoked consent routes to settings with the draft preserved", async () => {
  const context = { ...baseContext, consentGranted: false };
  await held.device.saveBootstrap(context, proof);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: "Best laptop under $2k?", consentGranted: false, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, () => ok({}));
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await act(async () => { composerOf(renderer).props.onSend(); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "ProfilePanel")).toHaveLength(1));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(0);
  const saved = await held.device.load();
  expect(saved.state.draft).toBe("Best laptop under $2k?");
  await act(async () => { renderer.unmount(); });
});

it("D-CTL-11 duplicate register acknowledgements keep a single pending action", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(212)));
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(212)}`) return ok(queuedSnap(id(212)));
    if (path === `/v1/runs/${id(212)}/events`) return ok({ events: [] });
    if (method === "POST" && path === "/v1/guest/pending-actions") return ok(ackFor(body));
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await act(async () => { composerOf(renderer).props.onChange("Best laptop under $2k?"); });
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  await act(async () => { composerOf(renderer).props.onChange("What about battery life?"); });
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(true));
  const first = (await held.device.load()).pendingAction?.submissionId;
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/guest/pending-actions")).toHaveLength(2));
  const registers = calls.filter((c) => c.method === "POST" && c.path === "/v1/guest/pending-actions");
  expect(registers.every((r) => r.body.submissionId === first)).toBe(true);
  expect((await held.device.load()).pendingAction?.submissionId).toBe(first);
  expect(sheetOf(renderer).props.visible).toBe(true);
  await act(async () => { renderer.unmount(); });
});

it("D-CTL-12 logout during the await clears the journal without resurrecting the draft", async () => {
  const run = { runId: id(213), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false };
  await seedGuest("Best laptop under $2k?", { run, status: "progress", tab: "settings" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === `/v1/runs/${id(213)}`) return ok(queuedSnap(id(213)));
    if (path === `/v1/runs/${id(213)}/events`) return ok({ events: [] });
    if (method === "DELETE" && path === "/v1/guest") return ok({});
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  const header = () => renderer.root.find((node) => String(node.type) === "ResearchHeader");
  await act(async () => { header().props.onSettings(); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "ProfilePanel")).toHaveLength(1));
  const panel = () => renderer.root.find((node) => String(node.type) === "ProfilePanel");
  panel().props.onLogout();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "DELETE" && c.path === "/v1/guest")).toHaveLength(1);
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
  const relaunched: Call[] = [];
  stubFetch(relaunched, () => ok({}));
  const second = await mountGuest();
  await vi.waitFor(() => expect(composerOf(second).props.editable).toBe(true));
  await act(async () => {});
  expect(composerOf(second).props.draft).toBe("");
  expect(relaunched.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(0);
  await act(async () => { second.unmount(); });
});
