import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";

// Held-out AUD05 invalidation matrix: subject switch, account deletion,
// content invalidation and view change each clear exactly their owned scope
// and never remount stale bytes under a new principal. Identity is keyed on
// account/principal epochs, never on bearer strings.
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
const M = id(601);
const memberToken = "member-token";

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

const queuedSnap = (runId: string) => ({ runId, lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });

function readerState(runId: string, reportId: string, extra: Record<string, unknown> = {}) {
  return { ...emptyState(), consentGranted: true, signedIn: true, routeMode: "controlled-research",
    run: { runId, lifecycle: "terminal", phase: "done", outcome: "completed", reportId, labeledDemo: false },
    status: "completed" as const,
    report: { reportId, version: 1, blocks: [{ id: "answer", kind: "answer", text: "Result.", claimIds: [], citationIds: ["cite-1"] }], limitations: [], labeledDemo: false, changeSummary: null },
    readingAnchor: { reportId, blockId: "answer", offset: 0 },
    ...extra };
}

beforeEach(async () => {
  held.id = 600;
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

const composerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchComposer");
const sectionsOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "ReportSections");
const sourceSheetOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "SourceSheet");
const allText = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children ?? "")).join(" ");

it("F-SWITCH-05 subject switch hides the reader, kills callbacks and never remounts", async () => {
  let cleared = 0;
  held.session.hydrate = async () => ({ token: "token-one", accountId: M, state: readerState(id(610), id(611)) });
  held.session.clear = async () => { cleared++; };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${id(610)}`) return ok({ runId: id(610), lifecycle: "terminal", phase: "done", outcome: "completed", reportId: id(611), labeledDemo: false });
    if (path === `/v1/runs/${id(610)}/events`) return ok({ events: [] });
    return ok({});
  });
  const authOne = { loaded: true, signedIn: true, subject: "clerk-M1", getToken: async () => "token-one" } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={authOne} />); });
  await vi.waitFor(() => expect(sectionsOf(renderer)).toHaveLength(1));
  const before = calls.length;
  const authTwo = { loaded: true, signedIn: true, subject: "clerk-M2", getToken: async () => "token-two" } as any;
  await act(async () => { renderer.update(<AppInner auth={authTwo} />); });
  await act(async () => {});
  expect(composerOf(renderer).props.draft).toBe("");
  expect(allText(renderer)).toMatch(/Account changed/);
  expect(sectionsOf(renderer)).toHaveLength(0);
  expect(cleared).toBeGreaterThanOrEqual(1);
  expect(calls.length).toBe(before);
  await act(async () => { renderer.unmount(); });
});

it("F-DELETE-06 account deletion clears the device and leaves no readable session", async () => {
  let cleared = 0;
  held.session.hydrate = async () => ({ token: memberToken, accountId: M,
    state: { ...readerState(id(620), id(621)), tab: "settings" } });
  held.session.clear = async () => { cleared++; };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (method === "POST" && path === "/v1/account/deletion") return ok({ fileCleanupPending: false });
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => memberToken } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "ProfilePanel")).toHaveLength(1));
  const panel = () => renderer.root.find((node) => String(node.type) === "ProfilePanel");
  await act(async () => { await panel().props.onDelete(); });
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  expect(calls.filter((c) => c.method === "POST" && c.path === "/v1/account/deletion")).toHaveLength(1);
  expect(cleared).toBeGreaterThanOrEqual(1);
  expect(sectionsOf(renderer)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("F-CONTENT-07 invalidation marker redacts the open reader before any refetch", async () => {
  let redacted: { token: string; runId: string } | null = null;
  held.session.hydrate = async () => ({ token: memberToken, accountId: M,
    state: { ...readerState(id(630), id(631)), tab: "library" } });
  held.session.redactRunContent = async (token: string, runId: string) => { redacted = { token, runId }; };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${id(630)}`) {
      return ok({ runId: id(630), contentInvalidated: true, lifecycle: "terminal", phase: "done", outcome: "completed", reportId: id(631), labeledDemo: false });
    }
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => memberToken } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "LibraryList")).toHaveLength(1));
  const list = () => renderer.root.find((node) => String(node.type) === "LibraryList");
  await act(async () => { await list().props.onOpen(id(630)); });
  await vi.waitFor(() => expect(redacted).not.toBeNull());
  expect(redacted).toEqual({ token: memberToken, runId: id(630) });
  expect(sectionsOf(renderer)).toHaveLength(0);
  expect(calls.filter((c) => c.path === `/v1/reports/${id(631)}`)).toHaveLength(0);
  expect(allText(renderer)).toMatch(/deleted source/);
  await act(async () => { renderer.unmount(); });
});

it("F-FOCUS-09 source focus drops on view change and is never persisted", async () => {
  const snapshots: any[] = [];
  held.session.hydrate = async () => ({ token: memberToken, accountId: M, state: readerState(id(640), id(641)) });
  held.session.persist = async (sess: any) => { snapshots.push(sess.state); };
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === `/v1/runs/${id(640)}`) return ok({ runId: id(640), lifecycle: "terminal", phase: "done", outcome: "completed", reportId: id(641), labeledDemo: false });
    if (path === `/v1/runs/${id(640)}/events`) return ok({ events: [] });
    if (path === "/v1/sources/src-1") {
      return ok({ passageId: "p1", sourceId: "src-1", title: "T", exactText: "E", accessLevel: "public" });
    }
    if (method === "GET" && path === `/v1/runs/${id(642)}`) return ok(queuedSnap(id(642)));
    if (path === `/v1/runs/${id(642)}/events`) return ok({ events: [] });
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => memberToken } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(sectionsOf(renderer)).toHaveLength(1));
  const sections = () => renderer.root.find((node) => String(node.type) === "ReportSections");
  await act(async () => { await sections().props.onOpenSource("src-1", "answer"); });
  await vi.waitFor(() => expect(sourceSheetOf(renderer).length).toBeGreaterThanOrEqual(1));
  const header = () => renderer.root.find((node) => String(node.type) === "ResearchHeader");
  await act(async () => { header().props.onLibrary(); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "LibraryList")).toHaveLength(1));
  const list = () => renderer.root.find((node) => String(node.type) === "LibraryList");
  await act(async () => { await list().props.onOpen(id(642)); });
  await vi.waitFor(() => expect(calls.some((c) => c.path === `/v1/runs/${id(642)}/events`)).toBe(true));
  expect(sourceSheetOf(renderer)).toHaveLength(0);
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snap of snapshots) {
    expect(snap).not.toHaveProperty("sourceFocus");
    expect(snap).not.toHaveProperty("focusedPassage");
  }
  await act(async () => { renderer.unmount(); });
});
