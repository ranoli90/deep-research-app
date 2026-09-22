import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createProtectedContentStore } from "../src/protected-content";
import { memoryStore } from "../src/persist";
import { emptyState } from "../src/state";
import { api } from "../src/api";

// F01 direct signed-out login: Settings Sign in with NO guest pending action
// and a signed-out session must open the provider chooser (Apple/Google/
// email), never an error. The pre-signed-in mount is a restoration-only
// control: every flow below mounts signed out and transitions through a real
// configured provider success. F05 clock control: time is frozen before the
// canonical fixture deadline so this suite passes under any host date.
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
const M = id(501);
const memberToken = "direct-member-token";
const legal = { apple: true, google: true, emailCode: true, termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" };

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

const guestAuth = { loaded: true, signedIn: false } as any;
const signedInAuth = (extra: Record<string, unknown> = {}) =>
  ({ loaded: true, signedIn: true, subject: "clerk-M", sessionTaskPending: false, getToken: async () => memberToken, signOut: async () => undefined, ...extra }) as any;
const providerAuth = (startProvider: () => Promise<"active" | "pending_task">) =>
  ({ ...guestAuth, startProvider }) as any;
const EXPIRY = "2026-09-22T00:00:00.000Z";
const uploadContext = { guestContextId: id(502), conversationId: id(503), conversationVersion: 1, expiresAt: EXPIRY, consentPolicyVersion: "consent.v1", controlVersion: 1, acceptedTurnCount: 0, consentGranted: true };

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
const sheetOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "GuestSignInSheet");
const headerOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ResearchHeader");
const panelOf = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.find((node) => String(node.type) === "ProfilePanel");
const allText = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAll((node) => String(node.type) === "Text").map((node) => String(node.props.children ?? "")).join(" ");
async function mountSignedOut() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<AppInner auth={guestAuth} />); });
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
  return renderer;
}
async function openSettingsSignIn(renderer: TestRenderer.ReactTestRenderer) {
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { panelOf(renderer).props.onSignIn(); });
}
const guestCalls = (calls: Call[]) => calls.filter((c) => c.path.startsWith("/v1/guest/") || (c.proof ?? null) !== null);

it("D-LOGIN-01 signed-out settings sign-in opens the provider chooser, not an error", async () => {
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    return ok({});
  });
  const renderer = await mountSignedOut();
  await openSettingsSignIn(renderer);
  const sheet = sheetOf(renderer);
  expect(sheet.props.visible).toBe(true);
  expect(sheet.props.state.step).toBe("chooser");
  expect(sheet.props.heading).toMatch(/restore/i);
  expect(sheet.props.providers.apple.available).toBe(true);
  expect(sheet.props.providers.google.available).toBe(true);
  expect(sheet.props.providers.email.available).toBe(true);
  expect(allText(renderer)).not.toMatch(/sign in elsewhere|sign in with a configured provider/i);
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(0);
  expect(guestCalls(calls)).toHaveLength(0);
  expect(await held.device.load()).toBeNull();
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-02 provider success verifies the session and binds the member Library", async () => {
  const calls: Call[] = [];
  const admitted = { runId: id(510), lifecycle: "queued", phase: "preparing", labeledDemo: false };
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    if (path === "/v1/library") return ok({ items: [{ id: id(511), title: "Saved laptop research", status: "completed", report_id: id(512) }] });
    if (method === "POST" && path === "/v1/runs") return ok(admitted);
    if (path === `/v1/runs/${id(510)}`) return ok({ runId: id(510), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(510)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountSignedOut();
  await act(async () => { composerOf(renderer).props.onChange("returning question"); });
  await openSettingsSignIn(renderer);
  expect(sheetOf(renderer).props.visible).toBe(true);
  // The native provider finishes before Clerk reports the session: the sheet
  // waits in reconciling with nothing sent, then completes once live.
  await act(async () => { renderer.update(<AppInner auth={providerAuth(async () => "active")} />); });
  let attempt!: { id: string; provider: string; operation: string };
  await act(async () => { attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" }); });
  expect(typeof attempt?.id).toBe("string");
  await act(async () => { await sheetOf(renderer).props.transport.startProvider(attempt); });
  expect(sheetOf(renderer).props.visible).toBe(true);
  expect(sheetOf(renderer).props.state.step).toBe("reconciling");
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(0);
  expect(guestCalls(calls)).toHaveLength(0);
  await act(async () => { renderer.update(<AppInner auth={signedInAuth({ startProvider: async () => "active" })} />); });
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(false));
  const sessions = calls.filter((c) => c.method === "GET" && c.path === "/v1/session");
  expect(sessions).toHaveLength(1);
  expect(sessions[0]?.auth).toBe(`Bearer ${memberToken}`);
  expect(guestCalls(calls)).toHaveLength(0);
  // The typed draft survives verification; the member reader is live.
  expect(String(composerOf(renderer).props.draft)).toBe("returning question");
  // The server-backed Library binds to the verified member bearer.
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { panelOf(renderer).props.onOpenLibrary(); });
  const list = renderer.root.find((node) => String(node.type) === "LibraryList");
  expect(list.props.token).toBe(memberToken);
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-03 sponsor-disabled still opens the chooser with exact unavailable reasons", async () => {
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
    return ok({});
  });
  const renderer = await mountSignedOut();
  await openSettingsSignIn(renderer);
  const sheet = sheetOf(renderer);
  expect(sheet.props.visible).toBe(true);
  expect(sheet.props.state.step).toBe("chooser");
  expect(sheet.props.providers.apple.available).toBe(false);
  expect(sheet.props.providers.google.available).toBe(false);
  expect(sheet.props.providers.email.available).toBe(false);
  expect(String(sheet.props.providers.google.unavailableReason ?? "")).not.toBe("");
  expect(allText(renderer)).not.toMatch(/sign in elsewhere|sign in with a configured provider/i);
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(0);
  expect(guestCalls(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-04 provider cancel and sheet dismiss hold everything with the draft intact", async () => {
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    return ok({});
  });
  const renderer = await mountSignedOut();
  await act(async () => { composerOf(renderer).props.onChange("held draft"); });
  await openSettingsSignIn(renderer);
  let attempt!: { id: string; provider: string; operation: string };
  await act(async () => { attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" }); });
  await act(async () => { await sheetOf(renderer).props.transport.cancelProvider(attempt); });
  await act(async () => { await sheetOf(renderer).props.onEvent({ type: "provider_cancelled" }); });
  expect(sheetOf(renderer).props.visible).toBe(true);
  expect(sheetOf(renderer).props.state.step).toBe("chooser");
  await act(async () => { sheetOf(renderer).props.onDismiss({ preserveDraft: true, preserveReadingPosition: true, restoreComposerFocus: true }); });
  expect(sheetOf(renderer).props.visible).toBe(false);
  expect(allText(renderer)).not.toMatch(/sign in elsewhere|sign in with a configured provider/i);
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(0);
  expect(guestCalls(calls)).toHaveLength(0);
  // The chooser reopens cleanly after dismissal.
  await act(async () => { panelOf(renderer).props.onSignIn(); });
  expect(sheetOf(renderer).props.visible).toBe(true);
  expect(sheetOf(renderer).props.state.step).toBe("chooser");
  await act(async () => { sheetOf(renderer).props.onDismiss({ preserveDraft: true, preserveReadingPosition: true, restoreComposerFocus: true }); });
  await act(async () => { panelOf(renderer).props.onDone(); });
  expect(String(composerOf(renderer).props.draft)).toBe("held draft");
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-05 logout then relogin restores a fresh member session", async () => {
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    return ok({});
  });
  const renderer = await mountSignedOut();
  await openSettingsSignIn(renderer);
  await act(async () => { renderer.update(<AppInner auth={providerAuth(async () => "active")} />); });
  await act(async () => {
    const attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "apple", operation: "provider" });
    await sheetOf(renderer).props.transport.startProvider(attempt);
  });
  expect(sheetOf(renderer).props.state.step).toBe("reconciling");
  await act(async () => { renderer.update(<AppInner auth={signedInAuth({ startProvider: async () => "active" })} />); });
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(false));
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(1);
  // Log out, then sign in again from the same signed-out settings entry.
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { panelOf(renderer).props.onLogout(); });
  await act(async () => { renderer.update(<AppInner auth={guestAuth} />); });
  await vi.waitFor(() => expect(composerOf(renderer).props.editable).toBe(true));
  await openSettingsSignIn(renderer);
  expect(sheetOf(renderer).props.visible).toBe(true);
  expect(sheetOf(renderer).props.state.step).toBe("chooser");
  await act(async () => { renderer.update(<AppInner auth={providerAuth(async () => "active")} />); });
  await act(async () => {
    const attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" });
    await sheetOf(renderer).props.transport.startProvider(attempt);
  });
  expect(sheetOf(renderer).props.state.step).toBe("reconciling");
  await act(async () => { renderer.update(<AppInner auth={signedInAuth({ startProvider: async () => "active" })} />); });
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(false));
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(2);
  expect(guestCalls(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-06 private-upload entry signs in directly and uploads under the member bearer", async () => {
  await held.device.saveBootstrap(uploadContext, "p".repeat(43));
  await held.device.saveSnapshot(uploadContext.guestContextId, { ...emptyState(), draft: "Research with my file", consentGranted: true, routeMode: "controlled-research" });
  const calls: Call[] = [];
  stubFetch(calls, (method, path, body) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (method === "POST" && path === "/v1/consent/member") return ok({ granted: true, consentEpoch: 1, policyVersion: "consent.v1", processors: [] });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    if (method === "POST" && path === "/v1/attachments") return ok({ attachmentId: id(520) });
    if (method === "POST" && path === "/v1/runs") return ok({ runId: id(521), lifecycle: "queued", phase: "preparing", labeledDemo: false });
    if (path === `/v1/runs/${id(521)}`) return ok({ runId: id(521), lifecycle: "queued", phase: "running", outcome: null, reportId: null, labeledDemo: false });
    if (path === `/v1/runs/${id(521)}/events`) return ok({ events: [] });
    return ok({});
  });
  const renderer = await mountSignedOut();
  const panel = () => renderer.root.find((node) => String(node.type) === "AttachmentPanel");
  await act(async () => { panel().props.onAttachUrl({ filename: "note.txt", mime: "text/plain", text: "private bytes" }); });
  expect(panel().props.attachments).toHaveLength(1);
  // Private upload is a sign-in entry: settings explains, sign-in opens the chooser.
  await act(async () => { composerOf(renderer).props.onSend(); });
  await vi.waitFor(() => expect(allText(renderer)).toMatch(/Sign in before adding documents/));
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { panelOf(renderer).props.onSignIn(); });
  expect(sheetOf(renderer).props.visible).toBe(true);
  await act(async () => { renderer.update(<AppInner auth={providerAuth(async () => "active")} />); });
  await act(async () => {
    const attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" });
    await sheetOf(renderer).props.transport.startProvider(attempt);
  });
  expect(sheetOf(renderer).props.state.step).toBe("reconciling");
  await act(async () => { renderer.update(<AppInner auth={signedInAuth({ startProvider: async () => "active" })} />); });
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(false));
  expect(panel().props.attachments).toHaveLength(1);
  // Consent, then the member admission carries the private file under the member bearer only.
  await act(async () => { headerOf(renderer).props.onSettings(); });
  await act(async () => { await panelOf(renderer).props.onConsent(); });
  await act(async () => { headerOf(renderer).props.onDone(); });
  await act(async () => { composerOf(renderer).props.onChange("Research with my file"); });
  composerOf(renderer).props.onSend();
  await vi.waitFor(() => expect(composerOf(renderer).props.draft).toBe(""));
  const uploads = calls.filter((c) => c.method === "POST" && c.path === "/v1/attachments");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]?.auth).toBe(`Bearer ${memberToken}`);
  expect(uploads[0]?.proof ?? null).toBeNull();
  const admissions = calls.filter((c) => c.method === "POST" && c.path === "/v1/runs");
  expect(admissions).toHaveLength(1);
  expect(admissions[0]?.body.attachmentIds).toEqual([id(520)]);
  expect(admissions[0]?.auth).toBe(`Bearer ${memberToken}`);
  expect(guestCalls(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-07 email code signs in directly with no guest funnel", async () => {
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    return ok({});
  });
  const renderer = await mountSignedOut();
  await openSettingsSignIn(renderer);
  const emailMocks = { sendEmailCode: async () => undefined, verifyEmailCode: async () => "active" as const };
  await act(async () => { renderer.update(<AppInner auth={{ ...guestAuth, ...emailMocks }} />); });
  let attempt!: { id: string; provider: string; operation: string; email: string | null };
  await act(async () => { await sheetOf(renderer).props.onEvent({ type: "choose_provider", provider: "email" }); });
  await act(async () => { attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "email", operation: "email_code", email: "member@example.com" }); });
  await act(async () => { await sheetOf(renderer).props.transport.requestEmailCode(attempt); });
  expect(sheetOf(renderer).props.state.step).toBe("code");
  // The code verifies before Clerk reports the session: wait, then finish once live.
  await act(async () => { await sheetOf(renderer).props.transport.verifyEmailCode({ ...attempt, operation: "verify_email_code" }, "123456"); });
  expect(sheetOf(renderer).props.state.step).toBe("reconciling");
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(0);
  await act(async () => { renderer.update(<AppInner auth={signedInAuth(emailMocks)} />); });
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(false));
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session" && c.auth === `Bearer ${memberToken}`)).toHaveLength(1);
  expect(guestCalls(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});

it("D-LOGIN-08 pending provider task finishes once the session is active", async () => {
  const calls: Call[] = [];
  stubFetch(calls, (method, path) => {
    if (path === "/v1/auth/capabilities") return ok(legal);
    if (path === "/v1/session") return ok({ accountId: M, actorKind: "member" });
    if (path === "/v1/settings") return ok({ liveRouteEnabled: true });
    return ok({});
  });
  const renderer = await mountSignedOut();
  await openSettingsSignIn(renderer);
  await act(async () => { renderer.update(<AppInner auth={{ ...guestAuth, startProvider: async () => "pending_task" } as any} />); });
  await act(async () => {
    const attempt = await sheetOf(renderer).props.transport.prepareAttempt({ provider: "google", operation: "provider" });
    await sheetOf(renderer).props.transport.startProvider(attempt);
  });
  // The native task owns the screen: the sheet waits in reconciling with no session yet.
  expect(sheetOf(renderer).props.state.step).toBe("reconciling");
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(0);
  await act(async () => { renderer.update(<AppInner auth={signedInAuth({ startProvider: async () => "active" })} />); });
  await vi.waitFor(() => expect(sheetOf(renderer).props.visible).toBe(false));
  expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/session")).toHaveLength(1);
  expect(guestCalls(calls)).toHaveLength(0);
  await act(async () => { renderer.unmount(); });
});
