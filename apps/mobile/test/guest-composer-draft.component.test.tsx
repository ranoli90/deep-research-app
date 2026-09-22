import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";

// Held-out AUD02 matrix: guest composer draft survival/clear through the real
// mounted App. F05 clock control: the canonical 2026-09-22 fixture deadline is
// immutable and is never moved forward here; time is frozen before it so this
// whole suite passes under any host date. Explicit fixed createdAt dates keep
// the journal deterministic.
const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 100 }));
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
const EXPIRY = "2026-09-22T00:00:00.000Z";
const FIXED_AT = "2026-09-21T00:00:00.000Z";
const baseContext = { guestContextId: id(101), conversationId: id(102), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 0, consentGranted: true };

type Call = { method: string; path: string; body: any };
const ok = (value: any) => Response.json(value);
const err = (status: number, code: string) => new Response(JSON.stringify({ code, message: code }), { status, headers: { "content-type": "application/json" } });

async function seedGuest(draftText: string, run: any = null, context = baseContext) {
  await held.device.saveBootstrap(context, proof);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: draftText, consentGranted: true, routeMode: "controlled-research",
    ...(run ? { run, status: "progress" as const } : {}) });
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
  held.id = 100;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T00:00:00.000Z"));
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
async function typeDraft(renderer: TestRenderer.ReactTestRenderer, text: string) {
  await act(async () => { composerOf(renderer).props.onChange(text); });
}
function sendPressed(renderer: TestRenderer.ReactTestRenderer) {
  composerOf(renderer).props.onSend();
}

it("D-HAPPY-01 unchanged first request clears the draft and saves the reader", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/guest/bootstrap") return ok({ guestContextId: id(101), conversationId: id(102), conversationVersion: 1, proof, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1" });
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(110)));
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(110)}`) return ok(queuedSnap(id(110)));
    if (path === `/v1/runs/${id(110)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions")).toHaveLength(0);
  expect(sheetOf(renderer).props.visible).toBe(false);
  await vi.waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path === `/v1/runs/${id(110)}`)).toBe(true));
  const saved = await held.device.load();
  expect(saved.firstRequest?.phase).toBe("accepted");
  expect(saved.firstRequest?.runId).toBe(id(110));
  expect(saved.state.run?.runId).toBe(id(110));
  expect(saved.state.draft).toBe("");
  await act(async () => { renderer.unmount(); });
});

it("D-FAIL-02 transport failure preserves the draft and retries the same request", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  let attempts = 0;
  stubFetch(calls, (method, path) => {
    if (method === "POST" && path === "/v1/runs") {
      attempts++;
      if (attempts === 1) throw new Error("network down");
      return ok(admitted(id(111)));
    }
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(111)}`) return ok(queuedSnap(id(111)));
    if (path === `/v1/runs/${id(111)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  expect(String(composerOf(renderer).props.draft)).toBe("Best laptop under $2k?");
  expect(calls.some((c) => c.method === "GET" && c.path.startsWith("/v1/runs/"))).toBe(false);
  expect((await held.device.load()).firstRequest?.phase).toBe("uncertain");
  sendPressed(renderer);
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(2);
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/run-requests/resolve")).toHaveLength(1);
  expect((await held.device.load()).firstRequest?.phase).toBe("accepted");
  await act(async () => { renderer.unmount(); });
});

it("D-FAIL-03 server 5xx preserves the draft and mints no run", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (method === "POST" && path === "/v1/runs") return err(500, "run_failed");
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  expect(String(composerOf(renderer).props.draft)).toBe("Best laptop under $2k?");
  expect(calls.some((c) => c.method === "GET" && c.path === "/v1/session")).toBe(false);
  expect((await held.device.load()).firstRequest?.phase).toBe("uncertain");
  await act(async () => { renderer.unmount(); });
});

it("D-FAIL-04 idempotency readback reuses the accepted request without a second admission", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (method === "POST" && path === "/v1/runs") return err(409, "AUTH_REQUIRED_NEXT_TURN");
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "accepted", run: admitted(id(112)) });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(112)}`) return ok(queuedSnap(id(112)));
    if (path === `/v1/runs/${id(112)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  expect(String(composerOf(renderer).props.draft)).toBe("Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1);
  expect((await held.device.load()).firstRequest?.phase).toBe("accepted");
  expect((await held.device.load()).state.run?.runId).toBe(id(112));
  await act(async () => { renderer.unmount(); });
});

it("D-B-05 typing B during the A await journals B as the saved second action", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(120)));
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(120)}`) return ok(queuedSnap(id(120)));
    if (path === `/v1/runs/${id(120)}/events`) return ok({ events: [] });
    if (method === "POST" && path === "/v1/guest/pending-actions") return ok(ackFor(body));
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  await typeDraft(renderer, "What about battery life?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(true));
  const saved = await held.device.load();
  expect(saved.pendingAction?.payload).toEqual({ kind: "follow_up", text: "What about battery life?", parentRunId: id(120) });
  expect(saved.pendingAction?.phase).toBe("pending_auth");
  expect(saved.state.run?.runId).toBe(id(120));
  expect(String(composerOf(renderer).props.draft)).toBe("What about battery life?");
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1);
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/guest/pending-actions")).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it("D-B-06 unchanged B resends reuse the same submission instead of minting", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(121)));
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(121)}`) return ok(queuedSnap(id(121)));
    if (path === `/v1/runs/${id(121)}/events`) return ok({ events: [] });
    if (method === "POST" && path === "/v1/guest/pending-actions") return ok(ackFor(body));
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  await typeDraft(renderer, "What about battery life?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(true));
  const first = (await held.device.load()).pendingAction?.submissionId;
  expect(typeof first).toBe("string");
  sendPressed(renderer);
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/guest/pending-actions")).toHaveLength(2));
  const registers = calls.filter((c) => c.method === "POST" && c.path === "/v1/guest/pending-actions");
  expect(registers[0]?.body.submissionId).toBe(first);
  expect(registers[1]?.body.submissionId).toBe(first);
  expect((await held.device.load()).pendingAction?.submissionId).toBe(first);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/cancel")).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("D-B-07 edited B replaces the saved action with a fresh submission and snapshot", async () => {
  await seedGuest("");
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (method === "POST" && path === "/v1/runs") return ok(admitted(id(122)));
    if (method === "POST" && path === "/v1/run-requests/resolve") return ok({ status: "not_found" });
    if (method === "GET" && path === "/v1/session") return ok(guestSession);
    if (path === `/v1/runs/${id(122)}`) return ok(queuedSnap(id(122)));
    if (path === `/v1/runs/${id(122)}/events`) return ok({ events: [] });
    if (method === "POST" && path === "/v1/guest/pending-actions") return ok(ackFor(body));
    if (method === "POST" && path === "/v1/guest/pending-actions/cancel") {
      return ok({ type: "action_abandoned", submissionId: body.submissionId });
    }
    return ok({});
  });
  const renderer = await mountGuest();
  await waitHydrated(renderer);
  await typeDraft(renderer, "Best laptop under $2k?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  await typeDraft(renderer, "What about battery life?");
  sendPressed(renderer);
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(true));
  const first = (await held.device.load()).pendingAction?.submissionId;
  const firstDigest = (await held.device.load()).pendingAction?.payloadDigest;
  await typeDraft(renderer, "What about warranty?");
  sendPressed(renderer);
  await vi.waitFor(() => {
    const pending = calls.filter((c) => c.method === "POST" && c.path === "/v1/guest/pending-actions");
    expect(pending).toHaveLength(2);
  });
  const replaced = await held.device.load();
  expect(replaced.pendingAction?.submissionId).not.toBe(first);
  expect(replaced.pendingAction?.payload).toEqual({ kind: "follow_up", text: "What about warranty?", parentRunId: id(122) });
  expect(replaced.pendingAction?.payloadDigest).not.toBe(firstDigest);
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/cancel")).toHaveLength(1);
  expect(calls.find((c) => c.path === "/v1/guest/pending-actions/cancel")?.body.submissionId).toBe(first);
  expect(String(composerOf(renderer).props.draft)).toBe("What about warranty?");
  await act(async () => { renderer.unmount(); });
});
