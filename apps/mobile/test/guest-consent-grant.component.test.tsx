import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";

// Guest consent grant whole-update boundary. The server confirms the guest
// consent grant, but the reader's durable write must not merge the stale
// pre-grant `consentGranted: false` back over the freshly granted frame.
// Observable contract: the Settings toggle reads ON after the grant and the
// guest send is admitted (POST /v1/runs) instead of being rejected with the
// "Allow AI processing" gate. Mounted App plus the real guest device store.
const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 700 }));
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
const baseContext = { guestContextId: id(701), conversationId: id(702), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 0, consentGranted: false };

type Call = { method: string; path: string; body: any };
const ok = (value: any) => Response.json(value);

function stubFetch(calls: Call[], routes: (method: string, path: string, body: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = String(init.method ?? "GET");
    calls.push({ method, path: u.pathname, body });
    return routes(method, u.pathname, body);
  }));
}

beforeEach(async () => {
  held.id = 700;
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

const composerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchComposer");
const headerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchHeader");
const panelOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ProfilePanel");

async function mountGuest() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={{ loaded: true, signedIn: false } as any} />); });
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
  return renderer;
}

it("CONSENT-GUEST-01 granted guest consent survives the durable reader write and admits the send", async () => {
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "best laptop for running AI under 2k", consentGranted: false, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (method === "POST" && path === "/v1/consent") return ok({ granted: true, policyVersion: "consent.v1" });
    if (path === "/v1/session") return ok({ actorKind: "guest", guestContextId: id(701), conversationId: id(702), conversationVersion: 1,
      controlVersion: 1, acceptedTurnCount: 0, expiresAt: EXPIRY, consentGranted: true, firstTurnAvailable: true });
    if (method === "POST" && path === "/v1/runs") return ok({ runId: id(710), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(710)}`) return ok({ runId: id(710), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(710)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  expect(composerOf(renderer).props.draft).toBe("best laptop for running AI under 2k");
  await act(async () => { headerOf(renderer).props.onSettings(); });
  expect(panelOf(renderer).props.state.consentGranted).toBe(false);

  // The real persisted-store grant path: the server confirms the grant, then
  // the reader write must not resurrect the stale pre-grant flag.
  await act(async () => { await panelOf(renderer).props.onConsent(); });
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/consent")).toHaveLength(1);
  // The granted frame, not a resurrected stale one, is what remains durable.
  await vi.waitFor(async () => expect((await held.device.load()).state.consentGranted).toBe(true));

  await act(async () => { headerOf(renderer).props.onSettings(); });
  expect(panelOf(renderer).props.state.consentGranted).toBe(true);
  await act(async () => { panelOf(renderer).props.onDone(); });

  // Admitted, not rejected by the "Allow AI processing" gate.
  await act(async () => { composerOf(renderer).props.onSend(); });
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  await act(async () => { renderer.unmount(); });
});
