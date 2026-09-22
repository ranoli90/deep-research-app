import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";
import { beginGuestAuth, createGuestPendingAction } from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

// Held-out AUD05 refresh matrix: same-account renewal retains action ID,
// reader generation, view lease, reading anchor and focus; identity is keyed
// on account/principal epochs, never on bearer strings. F05 clock control: the
// canonical 2026-09-22 fixture deadline is immutable and is never moved forward
// here; time is frozen before it so this whole suite passes under any host
// date. Seeded journal windows stay within the 24h validity span.
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
const proof = "p".repeat(43);
const EXPIRY = "2026-09-22T00:00:00.000Z";
const M = id(501);

type Call = { method: string; path: string; body: any; auth: string | null };
const ok = (value: any) => Response.json(value);
const err = (status: number, code: string) => new Response(JSON.stringify({ code, message: code }), { status, headers: { "content-type": "application/json" } });

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

const terminalSnap = (runId: string, reportId: string | null) =>
  ({ runId, lifecycle: "terminal", phase: "done", outcome: "completed", reportId, labeledDemo: false });
const reportBody = (reportId: string) =>
  ({ reportId, version: 1, blocks: [{ id: "answer", kind: "answer", text: "Result.", claimIds: [], citationIds: [] }], limitations: [], labeledDemo: false });
const queuedSnap = (runId: string) => ({ runId, lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
const admitted = (runId: string) => ({ runId, lifecycle: "queued", phase: "preparing", labeledDemo: false });

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

const composerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchComposer");
const sectionsOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "ReportSections");
const sourceSheetOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "SourceSheet");

function readerState(runId: string, reportId: string, extra: Record<string, unknown> = {}) {
  return { ...emptyState(), consentGranted: true, signedIn: true, routeMode: "controlled-research",
    run: { runId, lifecycle: "terminal", phase: "done", outcome: "completed", reportId, labeledDemo: false },
    status: "completed" as const,
    report: { reportId, version: 1, blocks: [{ id: "answer", kind: "answer", text: "Result.", claimIds: [], citationIds: [] }], limitations: [], labeledDemo: false, changeSummary: null },
    readingAnchor: { reportId, blockId: "answer", offset: 0 },
    ...extra };
}
const openSource = { passageId: "p1", sourceId: "s1", title: "T", exactText: "E", accessLevel: "public" };

it("F-REF-01 same-account rotation retains the reader while only the bearer churns", async () => {
  const rotations: { old: string; next: unknown }[] = [];
  const snapshots: any[] = [];
  held.session.hydrate = async () => ({ token: "token-one", accountId: M, state: readerState(id(510), id(511), {
    pendingAdmission: { version: "admission.v1", key: id(512), question: "Saved request?", routeMode: "controlled-research", uploads: [] } }) });
  held.session.rotateCredential = async (old: string, next: unknown) => { rotations.push({ old, next }); };
  held.session.persist = async (sess: any) => { snapshots.push(sess.state); };
  const calls: Call[] = [];
  let gets = 0;
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (method === "GET" && path === `/v1/runs/${id(510)}`) {
      gets++;
      if (gets === 1) return err(401, "expired");
      return ok(terminalSnap(id(510), id(511)));
    }
    if (path === `/v1/runs/${id(510)}/events`) return ok({ events: [] });
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M",
    // Models the Clerk cache: the forced refresh stores token-two, later
    // plain reads observe it (a cache that never updates would flap forever).
    getToken: (() => { let renewed = false; return async (opts?: { skipCache?: boolean }) => {
      if (opts?.skipCache) renewed = true;
      return renewed ? "token-two" : "token-one";
    }; })() } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === `/v1/runs/${id(510)}`).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
  expect(rotations).toHaveLength(1);
  expect(rotations[0]?.old).toBe("token-one");
  expect((rotations[0]?.next as any)?.token).toBe("token-two");
  // Identity continuity: the saved request ID, report and anchor all
  // survive; only transport bearers move to the renewed credential.
  expect(composerOf(renderer).props.pendingAdmission).toBe(true);
  expect(sectionsOf(renderer)).toHaveLength(1);
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snap of snapshots) {
    expect(snap.readingAnchor).toEqual({ reportId: id(511), blockId: "answer", offset: 0 });
    expect(snap.report?.reportId).toBe(id(511));
  }
  const firstRenewed = calls.findIndex((c) => c.auth === "Bearer token-two");
  expect(firstRenewed).toBeGreaterThanOrEqual(0);
  expect(calls.slice(firstRenewed + 1).every((c) => c.auth !== "Bearer token-one")).toBe(true);
  await act(async () => { renderer.unmount(); });
});

it("F-REF-02 reading anchor and open source survive the renewal with the composer usable", async () => {
  const snapshots: any[] = [];
  held.session.hydrate = async () => ({ token: "token-one", accountId: M, state: readerState(id(520), id(521), { source: openSource }) });
  held.session.persist = async (sess: any) => { snapshots.push(sess.state); };
  const calls: Call[] = [];
  let gets = 0;
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (method === "GET" && path === `/v1/runs/${id(520)}`) {
      gets++;
      if (gets === 1) return err(401, "expired");
      return ok(terminalSnap(id(520), id(521)));
    }
    if (path === `/v1/runs/${id(520)}/events`) return ok({ events: [] });
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M",
    getToken: (() => { let renewed = false; return async (opts?: { skipCache?: boolean }) => {
      if (opts?.skipCache) renewed = true;
      return renewed ? "token-two" : "token-one";
    }; })() } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === `/v1/runs/${id(520)}`).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
  // The open source sheet (focus context) is still mounted on the same
  // report after the renewal, and every durable write keeps the anchor.
  await vi.waitFor(() => expect(sourceSheetOf(renderer).length).toBeGreaterThanOrEqual(1));
  expect(sourceSheetOf(renderer)[0]?.props.source).toEqual(expect.objectContaining({ passageId: "p1" }));
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snap of snapshots) {
    expect(snap.readingAnchor).toEqual({ reportId: id(521), blockId: "answer", offset: 0 });
  }
  // Closing the sheet returns to a usable composer: the renewal wedged nothing.
  await act(async () => { sourceSheetOf(renderer)[0]?.props.onClose(); });
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
  expect(composerOf(renderer).props.sendDisabled).toBe(false);
  expect(sectionsOf(renderer)).toHaveLength(1);
  await act(async () => { renderer.unmount(); });
});

it("F-REF-03 claim-time renewal dispatches once under the renewed bearer", async () => {
  const text = "What about battery life?";
  const now = Date.now();
  const window = { createdAt: new Date(now - 5 * 60_000).toISOString(), expiresAt: new Date(now + 23 * 3600_000).toISOString(), now: new Date(now) };
  const context = { guestContextId: id(530), conversationId: id(531), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 1, consentGranted: true };
  const original = createGuestPendingAction({ submissionId: id(532), guestContextId: context.guestContextId, conversationId: context.conversationId,
    conversationVersion: 1, draftRevision: 0, draftDigest: sha256Hex(text), payload: { kind: "new_research", text },
    consentPolicyVersion: context.consentPolicyVersion, createdAt: window.createdAt, expiresAt: window.expiresAt });
  const authing = beginGuestAuth(original, { id: id(533), provider: "google" }, window.now);
  await held.device.saveBootstrap(context, proof);
  await held.device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: text, consentGranted: true, routeMode: "controlled-research",
    run: { runId: id(534), lifecycle: "terminal" as const, phase: "done", outcome: "completed", reportId: id(535), labeledDemo: false },
    status: "completed" as const, report: { reportId: id(535), version: 1, blocks: [], limitations: [], labeledDemo: false, changeSummary: null } });
  await held.device.savePendingAction(authing, null);
  let memberSnapshot: any = null;
  held.session.persistRequired = async (_value: string, snapshot: unknown) => { memberSnapshot = snapshot; };
  const calls: Call[] = [];
  let tokenReads = 0;
  stubFetch(calls, (method, path, body) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/auth/capabilities") return ok({ apple: false, google: true, emailCode: false, termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" });
    if (path === "/v1/guest/pending-actions/attempts/resolve") {
      return ok({ submissionId: id(532), authAttemptId: id(533), attemptRevision: 1, state: "authenticating" });
    }
    if (path === "/v1/guest/claim") {
      return ok({ type: "claim_accepted", submissionId: id(532), requestId: body.claimRequestId, accountId: M, conversationId: context.conversationId,
        conversationVersion: 1, controlVersion: 1, authorityAllowed: true, budgetAllowed: true, consentPolicyVersion: context.consentPolicyVersion });
    }
    if (path === "/v1/guest/actions/resume") {
      return ok({ type: "continuation_dispatched", submissionId: id(532), claimRequestId: body.claimRequestId, accountId: M,
        conversationId: context.conversationId, conversationVersion: 1, receiptId: id(536), runId: id(537), memberConversationId: id(538), kind: "new_research" });
    }
    if (path === `/v1/runs/${id(537)}`) return ok(queuedSnap(id(537)));
    if (path === `/v1/runs/${id(537)}/events`) return ok({ events: [] });
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => (++tokenReads <= 2 ? "token-one" : "token-two") } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(calls.filter((c) => c.path === "/v1/guest/actions/resume")).toHaveLength(1));
  expect(calls.filter((c) => c.path === "/v1/guest/claim")).toHaveLength(1);
  expect(calls.find((c) => c.path === "/v1/guest/claim")?.auth).toBe("Bearer token-two");
  expect(calls.find((c) => c.path === "/v1/guest/actions/resume")?.auth).toBe("Bearer token-two");
  expect(calls.filter((c) => c.path === "/v1/guest/pending-actions/attempts/begin")).toHaveLength(0);
  expect(memberSnapshot.previousReport?.reportId).toBe(id(535));
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("F-RACE-04 late old-bearer poll responses never overwrite the renewed reader", async () => {
  held.session.hydrate = async () => ({ token: "token-one", accountId: M, state: readerState(id(540), id(541)) });
  const calls: Call[] = [];
  let gets = 0;
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (method === "GET" && path === `/v1/runs/${id(540)}`) {
      gets++;
      if (gets === 1) return err(401, "expired");
      return ok(terminalSnap(id(540), id(541)));
    }
    if (path === `/v1/runs/${id(540)}/events`) return ok({ events: [] });
    if (path === `/v1/reports/${id(541)}`) return ok(reportBody(id(541)));
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M",
    getToken: (() => { let renewed = false; return async (opts?: { skipCache?: boolean }) => {
      if (opts?.skipCache) renewed = true;
      return renewed ? "token-two" : "token-one";
    }; })() } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.path === `/v1/runs/${id(540)}`).length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
  // The renewed reader keeps serving the owned report; the stale 401 does not
  // surface as an error and no refetch of the report is triggered by it.
  await vi.waitFor(() => expect(sectionsOf(renderer)).toHaveLength(1));
  const text = renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children ?? "")).join(" ");
  expect(text).not.toMatch(/expired|Session expired/);
  expect(calls.filter((c) => c.path === `/v1/reports/${id(541)}`)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("F-VIEW-08 selecting another run fences the previous run callbacks without churning the credential", async () => {
  held.session.hydrate = async () => ({ token: "token-one", accountId: M,
    state: { ...emptyState(), consentGranted: true, signedIn: true, routeMode: "controlled-research", tab: "library",
      run: { runId: id(550), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false }, status: "progress" as const } });
  const calls: Call[] = [];
  let releaseR1!: (value: any) => void;
  stubFetch(calls, (method, path) => {
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (method === "GET" && path === `/v1/runs/${id(550)}`) return new Promise((resolve) => { releaseR1 = resolve; });
    if (method === "GET" && path === `/v1/runs/${id(551)}`) return ok(queuedSnap(id(551)));
    if (path === `/v1/runs/${id(551)}/events`) return ok({ events: [] });
    if (path === `/v1/reports/${id(552)}`) return ok(reportBody(id(552)));
    return ok({});
  });
  const auth = { loaded: true, signedIn: true, subject: "clerk-M", getToken: async () => "token-one" } as any;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={auth} />); });
  await vi.waitFor(() => expect(renderer.root.findAll((node) => String(node.type) === "LibraryList")).toHaveLength(1));
  await vi.waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path === `/v1/runs/${id(550)}`)).toBe(true));
  const list = () => renderer.root.find((node) => String(node.type) === "LibraryList");
  await act(async () => { await list().props.onOpen(id(551)); });
  await vi.waitFor(() => expect(calls.some((c) => c.path === `/v1/runs/${id(551)}/events`)).toBe(true));
  // The superseded run answers late as terminal-with-report; its bytes must
  // never render under the new view lease and the credential never churns.
  await act(async () => { releaseR1(ok({ ...terminalSnap(id(550), id(552)), contentInvalidated: false })); });
  await act(async () => {});
  expect(calls.filter((c) => c.path === `/v1/reports/${id(552)}`)).toHaveLength(0);
  expect(calls.every((c) => c.auth === null || c.auth === "Bearer token-one")).toBe(true);
  await act(async () => { renderer.unmount(); });
});
