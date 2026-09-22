import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";

// F04 draft race: saveGuestReader/onGuestFirstSend whole-update boundary.
// Mounted App plus the real guest device store with a delayed final write:
// an edit that lands during durable storage must survive; a
// delete/cancellation that lands during it must never resurrect a stale
// frame; the polling persistence analogue preserves newer text too. No
// typing is disabled and no stale frame is resurrected. F05 clock control:
// time is frozen before the canonical fixture deadline.
const held = vi.hoisted(() => ({ device: null as any, session: null as any, id: 600 }));
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
const baseContext = { guestContextId: id(601), conversationId: id(602), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 0, consentGranted: true };

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

// Delayed real storage: the next saveSnapshot calls wait on the gate while
// every other device operation passes through untouched.
function armDelayedWrite(mode: { once: boolean }) {
  let release!: () => void;
  let gate = new Promise<void>((resolve) => { release = resolve; });
  let waiting = 0;
  const real = held.device.saveSnapshot.bind(held.device);
  const seen: unknown[][] = [];
  held.device.saveSnapshot = async (...args: unknown[]) => {
    seen.push(args);
    if (mode.once) {
      mode.once = false;
      waiting++;
      await gate;
      waiting--;
    }
    return real(...args);
  };
  return { seen, waits: () => waiting, release: () => { const r = release; gate = Promise.resolve(); r(); } };
}

beforeEach(async () => {
  held.id = 600;
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

it("RACE-01 edit during the final durable write survives with exactly one admission", async () => {
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "A", consentGranted: true, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/guest/bootstrap") return ok({ guestContextId: id(601), conversationId: id(602), conversationVersion: 1, proof, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1" });
    if (path === "/v1/session") return ok({ actorKind: "guest", guestContextId: id(601), conversationId: id(602), conversationVersion: 1, controlVersion: 1, acceptedTurnCount: 0, expiresAt: EXPIRY, consentGranted: true, firstTurnAvailable: true });
    if (method === "POST" && path === "/v1/runs") return ok({ runId: id(610), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(610)}`) return ok({ runId: id(610), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(610)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  expect(composerOf(renderer).props.draft).toBe("A");
  const delayed = armDelayedWrite({ once: true });
  // The send is in flight; the final reader write below is the delayed one.
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(delayed.waits()).toBe(1));
  // Typing is never disabled: this edit lands during the storage await.
  await act(async () => { composerOf(renderer).props.onChange("AC"); });
  await act(async () => { delayed.release(); });
  // Exactly one admission ran, and the newer text survived it in the UI and
  // in durable storage (via the autosave that follows the merged publish).
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  await vi.waitFor(() => expect(String(composerOf(renderer).props.draft)).toBe("AC"));
  await vi.waitFor(() => expect(composerOf(renderer).props.sendDisabled).toBe(false));
  let stored = (await held.device.load()).state.draft;
  if (stored !== "AC") {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    stored = (await held.device.load()).state.draft;
  }
  expect(stored).toBe("AC");
  await act(async () => { renderer.unmount(); });
});

it("RACE-02 deletion during the final write never resurrects the stale run frame", async () => {
  await held.device.saveBootstrap(baseContext, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "A", consentGranted: true, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ actorKind: "guest", guestContextId: id(601), conversationId: id(602), conversationVersion: 1, controlVersion: 1, acceptedTurnCount: 0, expiresAt: EXPIRY, consentGranted: true, firstTurnAvailable: true });
    if (method === "POST" && path === "/v1/runs") return ok({ runId: id(620), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(620)}`) return ok({ runId: id(620), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(620)}/events`) return ok({ events: [] });
    if (method === "DELETE" && path === "/v1/guest") return ok({ deleted: true });
    return ok({});
  });
  const renderer = await mountGuest();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let blocked = true;
  const real = held.device.saveSnapshot.bind(held.device);
  held.device.saveSnapshot = async (...args: unknown[]) => {
    if (blocked) await gate;
    return real(...args);
  };
  // The send's final write and the deletion's hiding write both queue behind
  // the same slow storage; the deletion is issued while the send is stuck.
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1));
  await act(async () => { headerOf(renderer).props.onSettings(); });
  const deleting = panelOf(renderer).props.onDelete();
  await act(async () => { blocked = false; release(); });
  await act(async () => { await deleting; });
  // The durable request outcome exists server-side exactly once, but the
  // reader never resurrects its stale run frame after the confirmed delete.
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/runs")).toHaveLength(1);
  expect(calls.filter((c) => c.method === "DELETE" && c.path === "/v1/guest")).toHaveLength(1);
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("RACE-03 edit during a poll refresh write survives with the run intact", async () => {
  const runId = id(630);
  await held.device.saveBootstrap({ ...baseContext, acceptedTurnCount: 1 }, proof);
  await held.device.saveSnapshot(baseContext.guestContextId, { ...emptyState(), draft: "B", consentGranted: true, routeMode: "controlled-research",
    run: { runId, lifecycle: "queued" as const, phase: "running", outcome: null, reportId: null, labeledDemo: false }, status: "progress" as const });
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === `/v1/runs/${runId}`) return ok({ runId, lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${runId}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountGuest();
  await vi.waitFor(() => expect(calls.filter((c) => c.path === `/v1/runs/${runId}`)).not.toHaveLength(0));
  expect(String(composerOf(renderer).props.draft)).toBe("B");
  const delayed = armDelayedWrite({ once: true });
  // Fire the one-second poll tick; its persistence write below is delayed.
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  await vi.waitFor(() => expect(delayed.waits()).toBe(1));
  await act(async () => { composerOf(renderer).props.onChange("B2"); });
  await act(async () => { delayed.release(); });
  await vi.waitFor(() => expect(String(composerOf(renderer).props.draft)).toBe("B2"));
  const stored = await held.device.load();
  expect(stored.state.run?.runId).toBe(runId);
  await vi.waitFor(() => expect((held.device.load() as Promise<{ state: { draft: string } }>).then((d) => d.state.draft)).resolves.toBe("B2"));
  await act(async () => { renderer.unmount(); });
});
