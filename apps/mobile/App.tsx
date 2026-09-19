import { applyRemoteInvalidation, redactInvalidatedContent } from "./src/remote-invalidation";
import { adoptCorrectionFile, correctionFilesFor, authoritativeCorrection, resolveCorrectionDocuments, adoptCorrectionSnapshot, type CorrectionSelection } from "./src/correction-documents-flow";
import { prepareCorrectionDocuments, submitCorrectionDocuments } from "./src/correction-documents";
import { ProfilePanel } from "./src/ProfilePanel";
import { prepareVerificationRequest, submitVerificationRequest, readVerificationRun, type PendingVerificationRequest } from "./src/verification-request";
import { prepareSourceDeletion, sameSourceDeletionTarget, sourceDeletionTarget, type SourceDeletionTarget } from "./src/source-deletion";
import { submitSourceDeletion } from "./src/source-deletion-flow";
import { createSourceFocus } from "./src/source-focus";
import { createReadingRestoration } from "./src/reading-position";
import { nativeDocumentDigest } from "./src/native-document-digest";
import { prepareAdmission, submitAdmission, readAdmittedRun, type AdmittedRun } from "./src/admission-retry";
import { SourceSheet } from "./src/SourceSheet";
import { readSourceDetail } from "./src/source-view";
import { activeCorrectionDraft, editCorrectionDraft, rebaseCorrectionDraft } from "./src/correction-draft";
import { AttachmentPanel } from "./src/AttachmentPanel";
import { ResearchActivity } from "./src/ResearchActivity";
import { ResearchBriefCard } from "./src/ResearchBriefCard";
import { ResearchComposer } from "./src/ResearchComposer";
import { ReportSections } from "./src/ReportView";
import { LibraryList } from "./src/LibraryList";
import { clarificationFieldFromPrompt, researchBriefView } from "./src/research-brief";
import { BackIcon, MenuIcon, PencilIcon } from "./src/icons";
import { humanChangeSummary } from "./src/correction-copy";
import { citationNumbers } from "./src/citation-chips";
import { draftFromFollowUp, followUpSuggestions } from "./src/follow-ups";
import { clearDocumentPickerCache, pickDocument } from "./src/native-documents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  AppState,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { color, space } from "@deep/design";
import { headerInitials, makeStyles } from "./src/product-styles";
import { sessionStorage } from "./src/native-session";
import { SupersededRequest } from "./src/request-scope";
import { OUTPUT_REPORT_CATEGORIES } from "@deep/contracts";
import { api, deletionPageUrl, isExpiredSession, isOfflineError, isSupersededRequest } from "./src/api";
import { activateLocalSession, clearAccountLocal, hydrateOnLaunch, logoutLocal, persistSession } from "./src/persist";
import { APPEARANCE_KEY, readAppearance, resolveAppearance } from "./src/appearance";
import { researchStatusLine, type ResearchStatusKind } from "./src/research-status";
import type { AppearancePreference } from "./src/ProfilePanel";
import {
  handleAndroidBack,
  androidBack,
  applySnapshot,
  researchActivity,
  attachFile,
  canSubmit,
  composerFollowsReport,
  emptyState,
  startNewResearch,
  expireLocalSession,
  logout as logoutState,
  mergeEvents,
  openLibraryItem,
  submitPrerequisite,
  type ReportBlock,
  type UiState,
} from "./src/state";

/** Hermes/Expo Go has no global crypto.randomUUID. */
function newId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function useTheme(preference: AppearancePreference) {
  const system = useColorScheme();
  return color[resolveAppearance(preference, system)];
}

function AppInner() {
  const [appearance, setAppearance] = useState<AppearancePreference>("system");
  const theme = useTheme(appearance);
  const insets = useSafeAreaInsets();
  const [state, setStateRaw] = useState<UiState>(emptyState());
  const [accountId, setAccountId] = useState<string | null>(null);
  const latestUi = useRef(state); latestUi.current = state;
  const redactingContent = useRef(false);
  const setState = useCallback((update: UiState | ((previous: UiState) => UiState)) => {
    const guard = api.capture();
    setStateRaw((previous) => guard.current() ? (typeof update === "function" ? update(previous) : update) : previous);
    guard.release();
  }, []);
  const setViewState = useCallback((update: UiState | ((previous: UiState) => UiState)) => {
    const guard = api.captureView();
    setStateRaw((previous) => guard.current() ? (typeof update === "function" ? update(previous) : update) : previous);
    guard.release();
  }, []);
  const [token, setToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const submitting = useRef(false);
  const deletingSource = useRef(false);
  const verifying = useRef(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationPolicy, setVerificationPolicy] = useState<"reuse_snapshot" | "refresh_sources">("reuse_snapshot");
  const [verificationNote, setVerificationNote] = useState("");
  const [editingAssumptions, setEditingAssumptions] = useState(false);
  useEffect(() => { setVerificationNote(""); setVerificationPolicy("reuse_snapshot"); }, [token]);
  const [sourceDeleteBusy, setSourceDeleteBusy] = useState(false);
  const pickingDocument = useRef(false);
  const [documentPending, setDocumentPending] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const signingIn = useRef<Promise<string> | null>(null);
  const refreshing = useRef(new Map<string, symbol>());
  const detailed = true;
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [sourceClaim, setSourceClaim] = useState<string | null>(null);

  const savedCorrection = activeCorrectionDraft(state);
  const correction = savedCorrection?.question ?? "";
  const evidencePolicy = savedCorrection?.evidencePolicy ?? "reuse_snapshot";
  const staleCorrection = Boolean(savedCorrection && state.run?.brief && savedCorrection.baseRevision !== state.run.brief.revision);
  function changeCorrection(patch: { question?: string; evidencePolicy?: "reuse_snapshot" | "refresh" }) {
    const runId = state.run?.runId, revision = state.run?.brief?.revision;
    if (!token || !runId || !revision || !api.currentRun(token, runId)) return;
    setViewState(s => editCorrectionDraft(s, runId, revision, patch));
  }
  const setCorrection = (question: string) => changeCorrection({ question });
  const setEvidencePolicy = (evidencePolicy: "reuse_snapshot" | "refresh") => changeCorrection({ evidencePolicy });
  const [correctionSelection, setCorrectionSelection] = useState<CorrectionSelection>({ owner: null, parent: null, files: [] });
  const correctionParent = state.pendingCorrectionDocuments?.parentRunId ?? state.run?.runId ?? null;
  const correctionFiles = correctionFilesFor(correctionSelection, token, correctionParent);
  function setCorrectionFiles(update: UiState["attachments"] | ((files: UiState["attachments"]) => UiState["attachments"])) {
    setCorrectionSelection(previous => ({ owner: token, parent: correctionParent,
      files: typeof update === "function" ? update(previous.owner === token && previous.parent === correctionParent ? previous.files : []) : update }));
  }
  useEffect(() => { setCorrectionFiles([]); }, [token, state.run?.runId, state.pendingSourceDeletion]);
  const [correctionPending,setCorrectionPending]=useState(false);
  const correctionAttempt=useRef<symbol|null>(null);
  const correctionMode=state.run?.labeledDemo&&state.run?.correctionMode==="legacy"?"legacy":!state.run?.labeledDemo&&state.run?.correctionMode==="replace_question"?"replace_question":"unavailable";
  const correctionReady=!state.run?.contentInvalidated&&!staleCorrection&&correctionMode!=="unavailable"&&Boolean(state.run?.brief?.revision)&&(correctionMode==="legacy"||(Number.isSafeInteger(state.run?.correctionReserveMicro)&&state.run!.correctionReserveMicro!>=0));
  useEffect(()=>{correctionAttempt.current=null;setCorrectionPending(false);},[token,state.run?.runId]);
  const clarifying = useRef(false);
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [attachName, setAttachName] = useState("note.txt");
  const [attachText, setAttachText] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const showAttachRef = useRef(false);
  showAttachRef.current = showAttach;
  const attachVisible = showAttach || (!!state.pendingAdmission && state.pendingAdmission.uploads.some((u) => !u.attachmentId));
  const attachVisibleRef = useRef(false);
  attachVisibleRef.current = attachVisible;
  const [sentQuestion, setSentQuestion] = useState<string | null>(null);
  const [showCorrectionOptions, setShowCorrectionOptions] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const keyboardOpenRef = useRef(false);
  keyboardOpenRef.current = keyboardOpen;
  function dismissKeyboard() {
    keyboardOpenRef.current = false;
    setKeyboardOpen(false);
    Keyboard.dismiss();
  }
  const [processors, setProcessors] = useState<string[]>([]);
  const [privacyFlows, setPrivacyFlows] = useState("");
  const [deletionVsSub, setDeletionVsSub] = useState("");
  const [processorDetailsOpen, setProcessorDetailsOpen] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagCategory, setFlagCategory] = useState<(typeof OUTPUT_REPORT_CATEGORIES)[number]>("inaccurate");
  const [flagNote, setFlagNote] = useState("");
  const [flagInclude, setFlagInclude] = useState(false);
  const [flagStatus, setFlagStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationScroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const reading = useRef(createReadingRestoration());
  const readerIdentity = useRef("");
  const readerGeneration = useRef(0);
  const activity = researchActivity(state);
  const statusLine = useMemo(() => researchStatusLine(state), [state]);
  useEffect(() => {
    if (state.status === "completed" || state.status === "partial" || state.status === "cancelled" || state.status === "failed") {
      setActivityExpanded(false);
    }
  }, [state.status]);

  const briefView = researchBriefView({
    lifecycle: state.run?.lifecycle,
    status: state.status,
    brief: state.run?.brief,
    clarificationSummary: state.events.find((e) => e.type === "clarify")?.publicSummary ?? "Which jurisdiction should this answer apply to?",
    hasReport: Boolean(state.report),
  });
  const finishedReport = composerFollowsReport(state);
  const composerContinues = finishedReport && correctionMode !== "unavailable";
  const blocks: ReportBlock[] = useMemo(
    () => (state.report ? state.report.blocks : []),
    [state.report],
  );
  const citeIndex = useMemo(() => citationNumbers(state.report?.blocks ?? []), [state.report?.blocks]);
  const followUps = useMemo(
    () => (composerContinues && state.report
      ? followUpSuggestions({ blocks: state.report.blocks, limitations: state.report.limitations })
      : []),
    [composerContinues, state.report],
  );
  const readerVisible = state.tab === "research" && !state.source && Boolean(state.report);
  // Identity stays in memory. Protected snapshots contain only report/block IDs.
  const readerKey = JSON.stringify([token, readerVisible, state.report?.reportId, detailed, blocks.map(b => b.id)]);
  if (readerIdentity.current !== readerKey) {
    readerIdentity.current = readerKey;
    scrollY.current = 0;
    if (readerVisible && token && state.report) {
      readerGeneration.current = reading.current.begin({ ownerKey: token, reportId: state.report.reportId }, state.readingAnchor, blocks.map(b => b.id), state.report.blocks.map(b => b.id));
    } else {
      reading.current.clear();
      readerGeneration.current = 0;
    }
  }
  const readerView = readerGeneration.current;
  const sourceFocus = useRef(createSourceFocus<View>(callback => requestAnimationFrame(callback), node => {
    const tag = findNodeHandle(node);
    if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
  }));
  const focusGeneration = sourceFocus.current.view(token ?? "", state.report?.reportId ?? "", JSON.stringify([readerView, state.tab, state.source?.passageId]));
  function closeSource() {
    sourceFocus.current.close();
    api.closeSource();
    setSourceClaim(null);
    setViewState(s => ({ ...s, source: null }));
  }
  const closeSourceRef = useRef(closeSource); closeSourceRef.current = closeSource;
  useEffect(() => () => sourceFocus.current.clear(), []);
  function restoreReadingPosition() {
    const result = reading.current.take(readerView);
    if (result.kind !== "ready") return;
    scrollY.current = result.y;
    conversationScroll.current?.scrollTo({ y: result.y, animated: false });
    if (result.note) setState(s => ({ ...s, readingAnchor: result.anchor, error: result.note! }));
  }

  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    if (!hydrated || redactingContent.current || submitting.current || deletingSource.current || verifying.current || correctionAttempt.current) return;
    const guard = api.capture();
    void persistSession(sessionStorage, { token, state }).catch(() => {
      if (guard.current()) setState((s) => s.error === "Could not save this device’s session." ? s : { ...s, error: "Could not save this device’s session." });
    }).finally(() => guard.release());
  }, [state, token, hydrated, setState]);

  function persistAnchor(reportId: string, blockId?: string) {
    const anchor = reading.current.capture(readerView, scrollY.current, blockId);
    if (!anchor || anchor.reportId !== reportId) return;
    setState(s => s.report?.reportId === reportId ? { ...s, readingAnchor: anchor } : s);
  }

  function saveVisibleReadingPosition() {
    if (state.report && !state.source) persistAnchor(state.report.reportId);
  }

  async function ensureSession() {
    if (signingIn.current) return signingIn.current;
    const pending = startSession(); signingIn.current = pending;
    try { return await pending; }
    finally { if (signingIn.current === pending) signingIn.current = null; }
  }

  async function startSession() {
    if (token) return token;
    let guard: ReturnType<typeof api.capture> | undefined;
    try {
      if (!hydrated) throw new Error("Restoring this device’s session. Try again shortly.");
      if (!storageReady) throw new Error("Device recovery failed. Use Log out and clear saved drafts and reports before signing in again.");
      const s = await api.session();
      redactingContent.current = false; api.activateSession(s.token);
      guard = api.capture();
      await activateLocalSession(sessionStorage, s);
      if (!guard.current()) { guard.release(); throw new SupersededRequest(); }
      const accepted = guard;
      setToken((previous) => accepted.current() ? s.token : previous);
      if (accepted.current()) setAccountId(s.accountId);
      setState((prev) => {
        if (!accepted.current()) return prev;
        const next = { ...emptyState(), draft: prev.signedIn ? "" : prev.draft, signedIn: true, error: null };

        return next;
      });
      guard.release();
      return s.token;
    } catch (e) {
      if (isSupersededRequest(e)) throw e;
      if (guard?.current()) api.activateSession(null);
      setState((s) => ({ ...s, error: (e as Error).message, tab: "settings" }));
      throw e;
    } finally { guard?.release(); }
  }

  async function grantConsent() {
    try {
      const t = token ?? (await ensureSession());
      await api.consent(t, true);
      setState((s) => {
        const next = { ...s, consentGranted: true, error: null };

        return next;
      });
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setState((s) => ({ ...s, error: (e as Error).message, tab: "settings" }));
    }
  }

  function clearPanels() {
    redactingContent.current = false;
    refreshing.current.clear();
    setUploadStatus(null);
    setCorrection(""); setClarifyAnswer(""); setAttachText(""); setAttachName("note.txt");
    setFlagNote(""); setFlagOpen(false); setFlagStatus("idle"); setFlagInclude(false);
    setRestoreMessage(null); setProcessors([]); setPrivacyFlows(""); setDeletionVsSub("");
  }

  async function onAuthFailure() {
    redactingContent.current = false; stopPolling(); api.activateSession(null); clearPanels();
    const cleanup = api.capture();
    setStorageReady(false);
    setToken(null); setAccountId(null); setState((s) => expireLocalSession(s));
    try {
      await clearAccountLocal(sessionStorage);
      if (cleanup.current()) setStorageReady(true);
    } catch {
      if (cleanup.current()) setState((s) => ({ ...s, error: "Session expired. Device cleanup failed; retry signing out." }));
    } finally { cleanup.release(); }
  }

  async function refreshRun(t: string, runId: string, openingState?: UiState) {
    if (!api.currentRun(t, runId)) return;
    const key = `${t}:${runId}`;
    if (refreshing.current.has(key)) return;
    const attempt = Symbol(); refreshing.current.set(key, attempt);
    let guard = api.captureView();
    try {
      const snap = await api.getRun(t, runId);
      if (!guard.current() || !api.currentRun(t, runId)) throw new SupersededRequest();
      if (snap.contentInvalidated === true) {
        // Cancel older source/correction callbacks without changing the selected run.
        api.invalidateView(t); guard.release(); guard = api.captureView();
      }
      const invalidated = await applyRemoteInvalidation(latestUi.current.run?.runId === runId ? latestUi.current : openingState ?? latestUi.current, snap, {
        current: () => guard.current() && api.currentRun(t, runId),
        hide: () => {
          redactingContent.current = true; setStorageReady(false);
          setViewState(s => guard.current() && s.run?.runId === runId ? redactInvalidatedContent({ ...s, run: snap }, runId) : s);
          setCorrectionSelection(previous => guard.current() ? { owner: t, parent: runId, files: [] } : previous);
        },
        save: (redacted, id) => sessionStorage.redactRunContent(t, id, redacted),
      });
      if (!guard.current()) throw new SupersededRequest();
      if (invalidated) {
        setViewState(s => guard.current() && s.run?.runId === runId ? { ...redactInvalidatedContent(s, runId), pendingContentInvalidation: null, offline: false } : s);
        redactingContent.current = false; setStorageReady(true); stopPolling();
        return;
      }
      const ev = await api.events(t, runId, 0);
      const incoming = ev.events ?? [];
      const currentUi = latestUi.current;
      const sameSnapshot = currentUi.run?.runId === snap.runId
        && currentUi.run?.lifecycle === snap.lifecycle
        && currentUi.run?.phase === snap.phase
        && currentUi.run?.outcome === snap.outcome
        && currentUi.run?.reportId === snap.reportId
        && currentUi.run?.brief?.revision === snap.brief?.revision
        && (incoming.at(-1)?.sequence ?? -1) === (currentUi.events.at(-1)?.sequence ?? -1)
        && (!snap.reportId || currentUi.report?.reportId === snap.reportId);
      if (sameSnapshot && !currentUi.offline) return;
      const report = snap.reportId && currentUi.report?.reportId !== snap.reportId
        ? await api.report(t, snap.reportId)
        : snap.reportId && currentUi.report?.reportId === snap.reportId
          ? null
          : null;
      setViewState((s) => {
        if (!guard.current() || s.pendingContentInvalidation) return s;
        if (!s.signedIn || s.pendingSourceDeletion || deletingSource.current || !api.currentRun(t, runId)) return s;
        const sameRun = s.run?.runId === snap.runId;
        let next = applySnapshot(s, snap);
        next = { ...next, events: sameRun ? mergeEvents(s.events, incoming) : incoming };
        if (report) {
          next = {
            ...next,
            report: {
              reportId: report.reportId,
              version: report.version,
              blocks: report.blocks,
              limitations: report.limitations ?? [],
              labeledDemo: report.labeledDemo,
              changeSummary: report.changeSummary ?? null,
            },
          };
        } else if (snap.runId && s.run?.runId !== snap.runId) {
          next = { ...next, report: null };
        } else if (!snap.reportId && (snap.lifecycle === "awaiting_input" || snap.lifecycle === "queued" || snap.lifecycle === "running")) {
          next = { ...next, report: null };
        }

        return next;
      });
      setViewState((s) => (s.offline ? { ...s, offline: false, error: null } : s));
    } catch (e) {
      if (isSupersededRequest(e) || !guard.current()) return;
      if (redactingContent.current) {
        setViewState(s => guard.current() ? { ...s, error: "Deleted source content is hidden. Disk cleanup is unconfirmed; reconnect or reopen to retry before starting research." } : s);
        return;
      }
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) {
        setViewState((s) => {
          const next = { ...s, offline: true, error: (e as Error).message };

          return next;
        });
      } else setViewState((s) => ({ ...s, error: (e as Error).message }));
    } finally { guard.release(); if (refreshing.current.get(key) === attempt) refreshing.current.delete(key); }
  }

  function stopPolling() {
    if (poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  }

  function startPolling(t: string, runId: string) {
    if (!api.currentRun(t, runId)) return;
    stopPolling();
    poll.current = setInterval(() => {
      void refreshRun(t, runId);
    }, 1000);
  }

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardOpenRef.current && latestUi.current.tab === "research") {
        dismissKeyboard();
        return true;
      }
      if (showAttachRef.current) {
        showAttachRef.current = false;
        setShowAttach(false);
        return true;
      }
      if (latestUi.current.source) {
        api.closeSource();
        return handleAndroidBack(latestUi.current, update => setViewState(update), () => closeSourceRef.current());
      }
      const r = androidBack(latestUi.current);
      setState(r.next);
      return r.consumed;
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (v) setState((s) => ({ ...s, reducedMotion: true }));
    });
    const motionSub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
      setState((s) => (s.reducedMotion === v ? s : { ...s, reducedMotion: v }));
    });
    let mounted = true;
    void AsyncStorage.getItem(APPEARANCE_KEY)
      .then((raw) => { if (mounted) setAppearance(readAppearance(raw)); })
      .catch(() => undefined);
    const hydration = api.capture();
    void Promise.resolve().then(clearDocumentPickerCache).then(() => hydrateOnLaunch(sessionStorage)).then(async ({ token: t, accountId, state: saved }) => {
      if (!hydration.current()) return;
      api.activateSession(t);
      const restored = api.capture();
      let s = saved;
      if (t) {
        try {
          const identity = await api.sessionInfo(t);
          if (identity.accountId !== accountId) { restored.release(); await onAuthFailure(); return; }
        } catch (error) {
          if (isSupersededRequest(error)) { restored.release(); return; }
          if (isExpiredSession(error)) { restored.release(); await onAuthFailure(); return; }
          s = { ...saved, offline: true, error: "Could not refresh this session. Saved content remains on this device; new research is disabled until reconnected." };
        }
      }
      if (!restored.current()) { restored.release(); return; }
      setStorageReady(!s.pendingContentInvalidation);
      redactingContent.current = !!s.pendingContentInvalidation;
      setToken((previous) => restored.current() ? t : previous);
      if (restored.current()) setAccountId(accountId);
      setState((previous) => restored.current() ? s : previous);
      if (t && s.run?.runId && !s.pendingSourceDeletion) {
        api.selectRun(s.run.runId);
        void refreshRun(t, s.run.runId, s);
        startPolling(t, s.run.runId);
      }
      restored.release();
    }).catch(() => setState((s) => ({ ...s, error: "Device session storage or temporary-file cleanup is unavailable. Try again when device storage is available." })))
      .finally(() => { hydration.release(); if (mounted) setHydrated(true); });
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      setKeyboardOpen(true);
      setKeyboardInset(e.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      setKeyboardOpen(false);
      setKeyboardInset(0);
    });
    const appSub = AppState.addEventListener("change", (st) => {
      if (st !== "active") {
        void sessionStorage.flush().catch(() => setState(s => ({ ...s, error: "Could not save this device’s session." })));
        return;
      }
      void api.health()
        .then(() => setState((s) => (s.offline ? { ...s, offline: false, error: null } : s)))
        .catch((e) => {
          if (isOfflineError(e)) {
            setState((s) => ({ ...s, offline: true, error: (e as Error).message }));
          }
        });
    });
    return () => {
      mounted = false;
      sub.remove();
      motionSub.remove();
      show.remove();
      hide.remove();
      appSub.remove();
      api.activateSession(null);
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  useEffect(() => {
    if (state.tab !== "settings" || !token) return;
    void api.settings(token).then((s: {
      processors?: string[];
      privacyDisclosure?: { dataFlows?: string; deletionVsSubscription?: string };
    }) => {
      if (Array.isArray(s.processors)) setProcessors(s.processors);
      if (s.privacyDisclosure?.dataFlows) setPrivacyFlows(s.privacyDisclosure.dataFlows);
      if (s.privacyDisclosure?.deletionVsSubscription) setDeletionVsSub(s.privacyDisclosure.deletionVsSubscription);
    }).catch(() => {
      /* keep last known processors; signed-out path shows the sign-in prompt */
    });
  }, [state.tab, token]);

  async function onPickDocument() {
    if (!hydrated || pickingDocument.current || submitting.current || deletingSource.current || state.pendingContentInvalidation || state.pendingSourceDeletion || verifying.current || state.pendingVerification || state.pendingCorrectionDocuments || correctionAttempt.current) return;
    if (!token || !state.signedIn) { setState(s => ({ ...s, tab: "settings", error: "Sign in before selecting a document." })); return; }
    if (state.attachments.length >= 3) { setState(s => ({ ...s, error: "Attachment limit is 3 files." })); return; }
    const guard = api.capture();
    pickingDocument.current = true; setDocumentPending(true);
    try {
      const file = await pickDocument(guard.current);
      if (file && guard.current()) setState(s => guard.current() && !deletingSource.current && !s.pendingSourceDeletion ? attachFile(s, file) : s);
    } catch (error) {
      if (guard.current() && !isSupersededRequest(error)) setState(s => guard.current() ? { ...s, error: (error as Error).message } : s);
    } finally { guard.release(); pickingDocument.current = false; setDocumentPending(false); }
  }

  async function onSend() {
    if (!hydrated || submitting.current || pickingDocument.current || deletingSource.current || verifying.current || correctionAttempt.current) return;
    if (!storageReady) return;
    const current = latestUi.current;
    const gate = canSubmit(current.pendingAdmission ? { ...current, offline: false } : current);
    if (!gate.ok) {
      const tab = submitPrerequisite(state);
      setViewState((s) => ({ ...s, error: gate.reason ?? "Cannot send", tab }));
      return;
    }
    const accountGuard = api.capture();
    try {
      submitting.current = true;
      setUploadStatus("Preparing saved request…");
      api.selectRun(null);
      stopPolling();
      const t = token ?? (await ensureSession());
      const guard = api.captureView();
      let created;
      try {
        const pending = current.pendingAdmission ?? await prepareAdmission(current.draft, current.routeMode, current.attachments, newId, nativeDocumentDigest, guard.current);
        created = await submitAdmission(pending, current.attachments, {
          digest: nativeDocumentDigest,
          preflight: async () => {
            const settings = await api.settings(t);
            if (!guard.current()) throw new SupersededRequest();
            setState(s => guard.current() ? { ...s, offline: false } : s);
            return settings;
          },
          current: guard.current,
          progress: setUploadStatus,
          save: async draft => {
            await sessionStorage.saveAdmission(t, draft);
            if (!guard.current()) throw new SupersededRequest();
            setState(s => ({ ...s, pendingAdmission: draft, attachments: s.pendingAdmission ? s.attachments : s.attachments.map((f,i) => ({ ...f, id: draft.uploads[i]?.key })) }));
          },
          upload: (file, key) => file.bytes ? api.attachBytes(t, file.filename, file.mime, file.bytes, key) : api.attach(t, file.filename, file.mime, file.text, key),
          admit: (draft, ids) => api.createRun(t, draft.question, draft.routeMode, draft.key, ids),
        });
        if (!guard.current()) throw new SupersededRequest();
      } finally { guard.release(); }
      await adoptAdmission(t, created);
    } catch (e) {
      if (!accountGuard.current() || isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) {
        setViewState((s) => {
          const next = {
            ...s,
            offline: true,
            error: (e as Error).message,
          };

          return next;
        });
      } else setViewState((s) => ({ ...s, error: (e as Error).message }));
    } finally { accountGuard.release(); submitting.current = false; setUploadStatus(null); }
  }

  async function adoptAdmission(t: string, created: AdmittedRun) {
      const guard = api.captureView();
      try {
      const current = latestUi.current;
      const next: UiState = {
          ...current,
          pendingAdmission: null,
          status: "progress" as const,
          error: null,
          draft: "",
          events: [],
          correctionDraft: null,
          source: null,
          readingAnchor: null,
          attachments: [],
          report: null,
          previousReport: current.report
            ? { reportId: current.report.reportId, blocks: current.report.blocks }
            : current.previousReport,
          run: {
            runId: created.runId,
            lifecycle: created.lifecycle,
            phase: created.phase,
            outcome: null,
            reportId: null,
            labeledDemo: created.labeledDemo,
          },
      };
      await sessionStorage.finishAdmission(t, next);
      if (!guard.current()) throw new SupersededRequest();
      api.selectRun(created.runId);
      setSentQuestion(current.pendingAdmission?.question ?? current.draft);
      setViewState(next);
      setShowAttach(false);
      AccessibilityInfo.announceForAccessibility(
        "Research in progress. Cancel is available. Closing the app will not stop the job.",
      );
      await refreshRun(t, created.runId, next);
      startPolling(t, created.runId);
      } finally { guard.release(); }
  }

  async function resolvePendingAdmission() {
    if (!token || !state.pendingAdmission || submitting.current || !storageReady) return;
    const guard = api.captureView(); submitting.current = true; setUploadStatus("Checking saved request…");
    try {
      const result = await api.resolveRunRequest(token, state.pendingAdmission.key);
      if (!guard.current()) throw new SupersededRequest();
      if (result.status === "accepted") await adoptAdmission(token, readAdmittedRun(result.run));
      else if (result.status === "withdrawn") {
        await sessionStorage.saveAdmission(token, null);
        if (!guard.current()) throw new SupersededRequest();
        setState(s => ({ ...s, pendingAdmission: null, offline: false, error: "No active request remains for this key. The saved request is withdrawn; you can edit and send again." }));
      } else throw new Error("The saved request could not be resolved. Retry checking it.");
    } catch (error) {
      if (!guard.current() || isSupersededRequest(error)) return;
      if (isExpiredSession(error)) await onAuthFailure();
      else setState(s => ({ ...s, error: (error as Error).message }));
    } finally { guard.release(); submitting.current = false; setUploadStatus(null); }
  }

  async function onCancel() {
    if (!token || !state.run) return;
    try { await api.cancel(token, state.run.runId); await refreshRun(token, state.run.runId); }
    catch (error) {
      if (isSupersededRequest(error)) return;
      if (isExpiredSession(error)) await onAuthFailure();
      else setState((s) => ({ ...s, error: "Could not confirm cancellation. Retry or reopen this run." }));
    }
  }

  async function onStatusRetry(kind: ResearchStatusKind) {
    if (kind === "offline") {
      try {
        await api.health();
        setState((s) => ({ ...s, offline: false, error: null }));
        const runId = latestUi.current.run?.runId;
        if (token && runId) void refreshRun(token, runId);
      } catch (error) {
        if (isOfflineError(error)) setState((s) => ({ ...s, offline: true, error: null }));
        else if (!isSupersededRequest(error)) setState((s) => ({ ...s, error: (error as Error).message }));
      }
      return;
    }
    const runId = latestUi.current.run?.runId;
    if (token && runId && (kind === "waiting" || kind === "failed")) {
      void refreshRun(token, runId);
      return;
    }
    if (kind === "failed" && latestUi.current.draft.trim()) void onSend();
  }

  async function onDeleteSource(target?: SourceDeletionTarget) {
    if (!token || !storageReady || deletingSource.current || submitting.current || pickingDocument.current || verifying.current || state.pendingVerification || state.pendingCorrectionDocuments || correctionAttempt.current) return;
    const guard = api.capture();
    try {
      if (target && !sameSourceDeletionTarget(target, sourceDeletionTarget(state.source))) throw new Error("The source changed. Review deletion again.");
      const pending = state.pendingSourceDeletion ? state : prepareSourceDeletion(state, target?.sourceId ?? "");
      deletingSource.current = true; setSourceDeleteBusy(true);
      stopPolling(); api.closeSource(); api.selectRun(null);
      const confirmed = await submitSourceDeletion(pending, {
        current: guard.current,
        save: next => sessionStorage.persistRequired(token, next),
        hide: next => { setAttachText(""); setAttachName("note.txt"); setShowAttach(false); setState(s => guard.current() ? next : s); },
        remove: id => api.deleteSource(token, id),
      });
      if (guard.current()) setState({ ...confirmed, offline: false });
    } catch (error) {
      if (!guard.current() || isSupersededRequest(error)) return;
      if (isExpiredSession(error)) await onAuthFailure();
      else setState(s => ({ ...s, error: (error as Error).message, offline: isOfflineError(error) || s.offline }));
    } finally { guard.release(); deletingSource.current = false; setSourceDeleteBusy(false); }
  }

  async function onOpenSource(id: string, blockId: string) {
    try {
      const t = token;
      if (!t) {
        setViewState((s) => ({ ...s, error: "Sign in to inspect sources.", tab: "settings" }));
        return;
      }
      if (state.report) persistAnchor(state.report.reportId, blockId);
      sourceFocus.current.open(JSON.stringify([blockId, id]));
      const src = readSourceDetail(await api.source(t, id));
      setViewState((s) => ({ ...s, source: src, tab: "research" }));
      AccessibilityInfo.announceForAccessibility(`Source sheet. ${src.title}. ${src.accessLevel}.`);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setViewState((s) => ({ ...s, error: (e as Error).message }));
    }
  }

  async function pickCorrectionDocument() {
    if (!token || !storageReady || pickingDocument.current || correctionAttempt.current || submitting.current || verifying.current || deletingSource.current || state.pendingContentInvalidation || state.pendingSourceDeletion || state.pendingVerification || state.pendingAdmission) return;
    if (correctionFiles.length >= 3) return;
    const guard = api.captureView(); pickingDocument.current = true; setDocumentPending(true);
    try {
      const file = await pickDocument(guard.current);
      if (file && guard.current()) setCorrectionSelection(previous => adoptCorrectionFile(previous, token, correctionParent, file, guard.current));
    } catch (e) {
      if (guard.current() && !isSupersededRequest(e)) setViewState(s => ({ ...s, error: (e as Error).message }));
    } finally { guard.release(); pickingDocument.current = false; setDocumentPending(false); }
  }

  async function adoptDocumentCorrection(runId: string) {
    if (!token) return;
    api.selectRun(runId);
    const guard = api.captureView();
    try {
      const next = await adoptCorrectionSnapshot(runId, state, {
        current: guard.current, get: () => api.getRun(token, runId), finish: next => sessionStorage.finishCorrectionDocuments(token, next),
      });
      setState(next); setCorrectionFiles([]);
      await refreshRun(token, runId, next); startPolling(token, runId);
    } finally { guard.release(); }
  }

  async function resolveDocumentCorrection() {
    const pending = state.pendingCorrectionDocuments;
    if (!token || !pending || correctionAttempt.current || pickingDocument.current) return;
    api.selectRun(pending.parentRunId);
    const guard = api.captureView(), attempt = Symbol("resolve document correction");
    correctionAttempt.current = attempt; setCorrectionPending(true);
    try {
      const result = await resolveCorrectionDocuments(pending, state, {
        current: guard.current, read: () => sessionStorage.readCorrectionDocuments(token),
        resolve: (durable, attachmentIds) => api.resolveCorrection(token, durable.parentRunId, durable.baseRevision, durable.upload.question,
          { kind: "append_attachments", attachmentIds, evidencePolicy: "reuse_snapshot" }),
        finish: next => sessionStorage.finishCorrectionDocuments(token, next),
      });
      if ("runId" in result) await adoptDocumentCorrection(result.runId);
      else { setState(result.state); setCorrectionFiles([]); }
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setState(s => ({ ...s, error: (e as Error).message }));
    } finally { guard.release(); if (correctionAttempt.current === attempt) { correctionAttempt.current = null; setCorrectionPending(false); } }
  }

  async function addCorrectionDocuments(files = correctionFiles) {
    if (!token || !storageReady || !state.run || correctionAttempt.current || pickingDocument.current || submitting.current || verifying.current || deletingSource.current || state.pendingAdmission || state.pendingVerification || state.pendingSourceDeletion) return;
    if (!state.consentGranted) { setViewState(s => ({ ...s, error: "Consent to AI processing is required before adding documents." })); return; }
    if (!state.pendingCorrectionDocuments && (!correctionReady || correctionMode !== "replace_question" || !state.report)) return;
    const attempt = Symbol("document correction"); correctionAttempt.current = attempt; setCorrectionPending(true);
    const pendingParent = state.pendingCorrectionDocuments?.parentRunId ?? state.run.runId;
    api.selectRun(pendingParent);
    const guard = api.captureView();
    try {
      const durable = await authoritativeCorrection(state.pendingCorrectionDocuments, pendingParent, {
        current: guard.current, read: () => sessionStorage.readCorrectionDocuments(token),
      });
      const pending = durable ?? await prepareCorrectionDocuments(pendingParent, state.run.brief!.revision, files, newId, nativeDocumentDigest, guard.current);
      const runId = await submitCorrectionDocuments(pending, files, {
        current: guard.current, digest: nativeDocumentDigest, progress: setUploadStatus,
        preflight: () => api.settings(token),
        save: async saved => {
          await sessionStorage.saveCorrectionDocuments(token, saved);
          if (!guard.current()) throw new SupersededRequest();
          setState(s => ({ ...s, pendingCorrectionDocuments: saved }));
        },
        upload: (file, key) => file.bytes ? api.attachBytes(token, file.filename, file.mime, file.bytes, key) : api.attach(token, file.filename, file.mime, file.text, key),
        correct: (parent, revision, text, attachmentIds) => api.correct(token, parent, revision, text, { kind: "append_attachments", attachmentIds, evidencePolicy: "reuse_snapshot" }),
      });
      if (!guard.current()) throw new SupersededRequest();
      await adoptDocumentCorrection(runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setState(s => ({ ...s, error: (e as Error).message }));
    } finally { guard.release(); setUploadStatus(null); if (correctionAttempt.current === attempt) { correctionAttempt.current = null; setCorrectionPending(false); } }
  }

  async function onCorrect(submitted?: string) {
    const current = latestUi.current;
    if (!token || !current.run || current.pendingContentInvalidation || redactingContent.current || correctionAttempt.current || verifying.current || current.pendingVerification || current.pendingCorrectionDocuments || current.pendingAdmission || current.pendingSourceDeletion) return;
    if (current.offline) {
      setViewState((s) => ({ ...s, error: "You are offline. The draft and last report stay on this device." }));
      return;
    }
    if (!current.consentGranted) {
      setViewState((s) => ({ ...s, error: "Consent to AI processing is required before a correction is sent.", tab: "settings" }));
      return;
    }
    const text = (submitted ?? correction).trim();
    if (!text) {
      setViewState((s) => ({ ...s, error: "Write a correction first. The draft and last report stay on this device." }));
      return;
    }
    if(!correctionReady||!current.run.brief?.revision) {
      setViewState((s)=>({...s,error:"Corrections are unavailable for this run. Refresh its status before trying again."}));return;
    }
    const attempt=Symbol("correction"),guard=api.captureView();correctionAttempt.current=attempt;setCorrectionPending(true);
    try {
      const child = await api.correct(token, current.run.runId, current.run.brief.revision, text,
        correctionMode==="replace_question"?{kind:"replace_question",question:text,evidencePolicy}:undefined);
      if(!guard.current())throw new SupersededRequest();
      api.selectRun(child.runId);
      api.closeSource();
      setShowAttach(false);
      setSentQuestion(text);
      setViewState((s) => {
        const next = {
          ...s,
          status: "progress" as const,
          correctionDraft: null,
          draft: "",
          error: null,
          events: [],
          source: null,
          readingAnchor: null,
          report: null,
          previousReport: s.report ? { reportId: s.report.reportId, blocks: s.report.blocks } : s.previousReport,
          run: {
            runId: child.runId,
            lifecycle: "queued",
            phase: "preparing",
            outcome: null,
            reportId: null,
            labeledDemo: s.run?.labeledDemo === true,
          },
        };

        return next;
      });
      await refreshRun(token, child.runId);
      startPolling(token, child.runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) {
        setViewState((s) => ({ ...s, offline: true, error: (e as Error).message }));
      } else setViewState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      guard.release();
      if(correctionAttempt.current===attempt){correctionAttempt.current=null;setCorrectionPending(false);}
    }
  }

  function onNewResearch() {
    if (correctionPending || verificationBusy || sourceDeleteBusy || submitting.current || deletingSource.current || verifying.current || correctionAttempt.current) return;
    const result = startNewResearch(latestUi.current);
    if (!result.ok) {
      setViewState((s) => ({ ...s, error: result.reason }));
      return;
    }
    stopPolling();
    api.selectRun(null);
    api.closeSource();
    setShowAttach(false);
    setShowCorrectionOptions(false);
    setShowVerification(false);
    setSentQuestion(null);
    setActivityExpanded(false);
    setSourceClaim(null);
    setViewState(result.next);
  }

  async function onContinueClarification() {
    if (!token || !state.run || clarifying.current) return;
    if (latestUi.current.offline) {
      setViewState((s) => ({ ...s, error: "You are offline. The draft and last report stay on this device." }));
      return;
    }
    const answer = clarifyAnswer.trim();
    const field = clarificationFieldFromPrompt(briefView.materialClarification);
    if (editingAssumptions) {
      const values = clarifyAnswer.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!values.length) {
        setViewState((s) => ({ ...s, error: "Enter the assumptions to keep." }));
        return;
      }
      clarifying.current = true;
      try {
        await api.confirmAssumptions(token, state.run.runId, values);
        setEditingAssumptions(false);
        setClarifyAnswer("");
        AccessibilityInfo.announceForAccessibility("Assumptions updated.");
        await refreshRun(token, state.run.runId);
      } catch (e) {
        if (isSupersededRequest(e)) return;
        if (isExpiredSession(e)) await onAuthFailure();
        else if (isOfflineError(e)) {
          setViewState((s) => ({ ...s, offline: true, error: "You are offline. The draft and last report stay on this device." }));
        } else setViewState((s) => ({ ...s, error: e instanceof Error ? e.message : "Could not update assumptions." }));
      } finally { clarifying.current = false; }
      return;
    }
    if (!briefView.blocking) {
      clarifying.current = true;
      try {
        await api.confirmAssumptions(token, state.run.runId);
        AccessibilityInfo.announceForAccessibility("Assumptions confirmed.");
        await refreshRun(token, state.run.runId);
      } catch (e) {
        if (isSupersededRequest(e)) return;
        if (isExpiredSession(e)) await onAuthFailure();
        else if (isOfflineError(e)) {
          setViewState((s) => ({ ...s, offline: true, error: "You are offline. The draft and last report stay on this device." }));
        } else setViewState((s) => ({ ...s, error: e instanceof Error ? e.message : "Could not confirm assumptions." }));
      } finally { clarifying.current = false; }
      return;
    }
    if (!answer) {
      setViewState((s) => ({ ...s, error: field === "geography" ? "Enter a jurisdiction. The app will not assume a country." : "Answer the detail above to continue." }));
      return;
    }
    clarifying.current = true;
    try {
      await api.continueRun(token, state.run.runId, [{ field, value: answer }]);
      setViewState((s) => {
        const next = { ...s, status: "progress" as const, error: null };

        return next;
      });
      AccessibilityInfo.announceForAccessibility("Clarification saved. Research continues on the server.");
      await refreshRun(token, state.run.runId);
      startPolling(token, state.run.runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) {
        setViewState((s) => {
          const next = { ...s, offline: true, error: (e as Error).message };

          return next;
        });
      } else setViewState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      clarifying.current = false;
    }
  }

  async function adoptVerification(pending: PendingVerificationRequest, runId: string) {
    if (!token) return;
    if (runId === pending.parentRunId) throw new Error("Verification resolved to its parent instead of a child. Retry the saved request.");
    api.selectRun(runId);
    const guard = api.captureView();
    try {
      const snap = readVerificationRun(await api.getRun(token, runId), runId);
      if (!guard.current()) throw new SupersededRequest();
      let next = applySnapshot({ ...state, pendingVerification: null, previousReport: state.report ? { reportId: state.report.reportId, blocks: state.report.blocks } : state.previousReport, report: null, source: null, events: [], readingAnchor: null, correctionDraft: null }, snap);
      next = { ...next, error: null, offline: false, tab: "research" };
      await sessionStorage.persistRequired(token, next);
      if (!guard.current()) throw new SupersededRequest();
      setState(next);
      await refreshRun(token, runId, next); startPolling(token, runId);
    } finally { guard.release(); }
  }

  async function onFollowUp() {
    if (!token || !storageReady || verifying.current || submitting.current || deletingSource.current || state.pendingContentInvalidation || state.pendingSourceDeletion || state.pendingAdmission || state.pendingCorrectionDocuments || correctionAttempt.current) return;
    if (latestUi.current.offline) {
      setViewState((s) => ({ ...s, error: "You are offline. The draft and last report stay on this device." }));
      return;
    }
    if (!latestUi.current.consentGranted) {
      setViewState((s) => ({ ...s, error: "Consent to AI processing is required before verification is sent.", tab: "settings" }));
      return;
    }
    const guard = api.capture();
    try {
      verifying.current = true; setVerificationBusy(true);
      let pending = state.pendingVerification;
      if (!pending) {
        if (state.report?.labeledDemo) throw new Error("Demo reports do not support evidence verification.");
        const claimId = state.report?.blocks.find(b => b.kind === "answer" && b.claimIds.length)?.claimIds[0] ?? state.report?.blocks.find(b => b.claimIds.length)?.claimIds[0];
        if (!claimId || !state.report?.version) throw new Error("Reopen a current report with a supported claim before requesting verification.");
        pending = prepareVerificationRequest({ run: state.run, report: state.report, reportId: state.report.reportId, reportVersion: state.report.version, claimId, note: verificationNote, evidencePolicy: verificationPolicy, idempotencyKey: newId(), pendingAdmission: state.pendingAdmission, pendingSourceDeletion: state.pendingSourceDeletion });
      }
      api.selectRun(pending.parentRunId); stopPolling();
      const accepted = await submitVerificationRequest(pending, {
        current: guard.current,
        save: async saved => {
          await sessionStorage.persistRequired(token, { ...state, pendingVerification: saved });
          if (!guard.current()) throw new SupersededRequest();
          setState(s => ({ ...s, pendingVerification: saved }));
        },
        post: (id, request) => api.followUp(token, id, request),
      });
      if (guard.current()) await adoptVerification(pending, accepted.runId);
    } catch (error) {
      if (!guard.current() || isSupersededRequest(error)) return;
      if (isExpiredSession(error)) await onAuthFailure();
      else setState(s => ({ ...s, error: (error as Error).message }));
    } finally { guard.release(); verifying.current = false; setVerificationBusy(false); }
  }

  async function resolvePendingVerification() {
    const pending = state.pendingVerification;
    if (!token || !pending || verifying.current) return;
    const guard = api.capture();
    try {
      verifying.current = true; setVerificationBusy(true);
      const result = await api.resolveRunRequest(token, pending.request.idempotencyKey, pending);
      if (!guard.current()) throw new SupersededRequest();
      if (result.status === "accepted") await adoptVerification(pending, readAdmittedRun(result.run).runId);
      else if (result.status === "withdrawn") {
        const next = { ...state, pendingVerification: null, error: "The saved verification request is withdrawn. No new verification will start under this key." };
        await sessionStorage.persistRequired(token, next);
        if (guard.current()) setState(next);
      } else throw new Error("Verification status could not be confirmed. Retry the saved request.");
    } catch (error) {
      if (guard.current() && !isSupersededRequest(error)) setState(s => ({ ...s, error: (error as Error).message }));
    } finally { guard.release(); verifying.current = false; setVerificationBusy(false); }
  }

  async function onShare(reportId?: string) {
    const id = reportId ?? state.report?.reportId;
    if (!token || !id || state.pendingContentInvalidation || state.pendingSourceDeletion || deletingSource.current) return;
    try {
      const md = await api.exportMd(token, id);
      const labeled = reportId
        ? (state.report?.reportId === reportId && (state.report.labeledDemo === true || state.run?.labeledDemo === true)) || state.routeMode === "fixture"
        : (state.report?.labeledDemo === true || state.run?.labeledDemo === true);
      const message = labeled ? `Sample report.\n\n${md.markdown}` : md.markdown;
      await Share.share({ message, title: "Research report" }, { dialogTitle: "Research report" });
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setState((s) => ({ ...s, error: (e as Error).message }));
    }
  }


  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]} accessibilityLabel="Deep Research">
      <StatusBar style={theme === color.dark ? "light" : "dark"} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {state.tab === "research" ? (
              <Pressable
                onPress={() => {
                  dismissKeyboard();
                  setShowAttach(false);
                  api.closeSource();
                  setSourceClaim(null);
                  setState((s) => ({ ...s, tab: "library", source: null }));
                }}
                accessibilityRole="button"
                accessibilityLabel="Library"
                hitSlop={12}
                style={styles.headerIconHit}
              >
                <MenuIcon color={theme.ink} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => { dismissKeyboard(); setState((s) => ({ ...s, tab: "research" })); }}
                accessibilityRole="button"
                accessibilityLabel="Done"
                hitSlop={12}
                style={styles.headerIconHit}
              >
                <BackIcon color={theme.ink} />
              </Pressable>
            )}
          </View>
          <Text
            style={styles.wordmark}
            accessibilityRole="header"
            numberOfLines={1}
            ellipsizeMode="tail"
            allowFontScaling
            maxFontSizeMultiplier={2}
          >
            {state.tab === "library"
              ? "Library"
              : state.tab === "settings"
                ? "Settings"
                : (state.run || state.report || state.pendingAdmission)
                  ? (state.run?.brief?.originalQuestion ?? state.pendingAdmission?.question ?? sentQuestion ?? "Deep")
                  : "Deep"}
          </Text>
          <View style={[styles.headerSide, styles.headerSideEnd]}>
            {state.tab === "research" || state.tab === "library" ? (
              <Pressable onPress={onNewResearch} accessibilityRole="button" accessibilityLabel="New research" hitSlop={12} style={styles.headerIconHit}>
                <PencilIcon color={theme.ink} />
              </Pressable>
            ) : null}
            {state.tab === "research" ? (
              <Pressable
                onPress={() => {
                  dismissKeyboard();
                  setShowAttach(false);
                  api.closeSource();
                  setSourceClaim(null);
                  setState((s) => ({ ...s, tab: "settings", source: null }));
                }}
                accessibilityRole="button"
                accessibilityLabel="Open profile and settings"
                hitSlop={12}
                style={styles.headerIconHit}
              >
                <View style={styles.headerAvatar}>
                  <Text style={styles.headerAvatarText}>{headerInitials(accountId, state.signedIn)}</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
        {state.pendingContentInvalidation ? <View style={styles.card} accessibilityLabel="Deleted source cleanup">
          <Text style={styles.bodyText}>A deleted source invalidated this report. Its saved content is hidden while device cleanup is retried.</Text>
          <Pressable accessibilityRole="button" onPress={() => { if (token && state.run?.runId) void refreshRun(token, state.run.runId); }}><Text style={styles.link}>Retry device cleanup</Text></Pressable>
        </View> : null}
        {state.pendingCorrectionDocuments ? <View style={styles.card} accessibilityLabel="Saved document correction">
          <Text style={styles.bodyText}>A document correction is saved for its original report. Retry the same request to avoid starting another correction.</Text>
          <Text style={styles.bodyText}>{state.pendingCorrectionDocuments.upload.uploads.map(u => `${u.filename}: ${u.attachmentId ? "uploaded" : "select original file again"}`).join("\n")}</Text>
          {correctionFiles.map((file, index) => <Pressable key={index} disabled={correctionPending} accessibilityRole="button" onPress={() => setCorrectionFiles(files => files.filter((_, i) => i !== index))}><Text style={styles.link}>{file.filename} · Remove selection</Text></Pressable>)}
          <Pressable disabled={documentPending || correctionPending} accessibilityRole="button" onPress={() => void pickCorrectionDocument()}><Text style={styles.link}>Select original file</Text></Pressable>
          <Pressable disabled={documentPending || correctionPending} accessibilityRole="button" onPress={() => void addCorrectionDocuments()}><Text style={styles.link}>Retry document correction</Text></Pressable>
          <Pressable disabled={documentPending || correctionPending} accessibilityRole="button" onPress={() => void resolveDocumentCorrection()}><Text style={styles.link}>Check or withdraw document correction</Text></Pressable>
          {uploadStatus ? <Text accessibilityLiveRegion="polite">{uploadStatus}</Text> : null}
        </View> : null}
        {state.pendingVerification ? <View style={styles.card} accessibilityLabel="Saved verification request">
          <Text style={styles.bodyText}>Verification is awaiting confirmation. Retry keeps the same claim, evidence policy and request identity.</Text>
          <Pressable disabled={verificationBusy} accessibilityRole="button" accessibilityLabel="Retry saved verification" onPress={() => void onFollowUp()}><Text style={styles.link}>Retry verification</Text></Pressable>
          <Pressable disabled={verificationBusy} accessibilityRole="button" accessibilityLabel="Check or withdraw verification" onPress={() => void resolvePendingVerification()}><Text style={styles.link}>Check or withdraw</Text></Pressable>
        </View> : null}
        {state.pendingSourceDeletion ? <View style={styles.card} accessibilityLabel="Pending source deletion">
          <Text style={styles.bodyText}>Source and cached reports are hidden here. Server deletion is not yet confirmed. Retry to confirm it before reopening research.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry source deletion" disabled={sourceDeleteBusy}
            onPress={() => void onDeleteSource()}><Text style={styles.link}>{sourceDeleteBusy ? "Confirming deletion…" : "Retry deletion"}</Text></Pressable>
        </View> : null}
        {state.error && statusLine?.kind !== "offline" && statusLine?.kind !== "failed" && statusLine?.kind !== "cancelled" ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {state.error}
          </Text>
        ) : null}

        {state.tab === "research" && !state.source ? (
          <ScrollView
            key={readerView}
            ref={conversationScroll}
            style={styles.body}
            contentContainerStyle={{ paddingBottom: followUps.length ? 168 : space.lg }}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Research conversation"
            scrollEventThrottle={100}
            onLayout={event => { reading.current.measureViewport(readerView, event.nativeEvent.layout.height); restoreReadingPosition(); }}
            onContentSizeChange={(_width, height) => { reading.current.measureContent(readerView, height); restoreReadingPosition(); }}
            onScroll={(event) => { if (readerView === readerGeneration.current) scrollY.current = event.nativeEvent.contentOffset.y; }}
            onScrollBeginDrag={() => reading.current.userScrolled(readerView)}
            onScrollEndDrag={() => saveVisibleReadingPosition()}
            onMomentumScrollEnd={() => saveVisibleReadingPosition()}
          >
            {state.pendingAdmission ? <View style={styles.card} accessibilityLabel="Saved research request">
              <Text style={styles.bodyText}>Request awaiting confirmation. Retry keeps the same question and documents.</Text>
              {state.pendingAdmission.uploads.some(u => !u.attachmentId) ? <Text style={styles.bodyText}>Select the original files again: {state.pendingAdmission.uploads.filter(u => !u.attachmentId).map(u => u.filename).join(", ")}</Text> : null}
              <Pressable disabled={uploadStatus !== null} accessibilityRole="button" accessibilityLabel="Check or withdraw saved research request" onPress={() => void resolvePendingAdmission()}><Text style={styles.link}>Check or withdraw saved request</Text></Pressable>
            </View> : null}
            {!state.run && !state.report && !state.pendingAdmission ? (
              <View style={styles.emptyHero} accessibilityLabel="Empty research">
                <Text style={styles.welcomeDisplay}>Ask anything.</Text>
                <View style={styles.exampleRow}>
                  {["should I move to Texas", "best laptop under 2k", "research this company"].map((example) => (
                    <Pressable
                      key={example}
                      onPress={() => setState((s) => ({ ...s, draft: example }))}
                      accessibilityRole="button"
                      accessibilityLabel={`Use example: ${example}`}
                      hitSlop={8}
                      style={styles.exampleChip}
                    >
                      <Text style={styles.exampleChipText}>{example}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Header already shows the question; a second bubble crowds the first viewport. */}

            {state.events.length > 0 || activity.inProgress ? (
              <ResearchActivity
                events={state.events}
                lifecycle={state.run?.lifecycle}
                outcome={state.run?.outcome}
                inProgress={activity.inProgress}
                reducedMotion={state.reducedMotion}
                expanded={activityExpanded}
                labeledDemo={state.run?.labeledDemo === true || state.report?.labeledDemo === true}
                accent={theme.accent}
                onToggle={() => setActivityExpanded((value) => !value)}
                styles={{ ...styles, kicker: styles.activityKicker }}
              />
            ) : null}

            {statusLine && statusLine.kind !== "waiting" && !((statusLine.kind === "failed" || statusLine.kind === "cancelled") && state.events.length > 0) ? (
              <View style={styles.statusRow} accessibilityLabel={statusLine.line} accessibilityLiveRegion="polite">
                <Text style={styles.statusText}>{statusLine.line}</Text>
                {statusLine.retry ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={() => void onStatusRetry(statusLine.kind)} hitSlop={12}>
                    <Text style={styles.link}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : !activity.inProgress && activity.terminalNotice && state.events.length === 0 ? (
              <Text style={styles.statusText} accessibilityLiveRegion="polite">{activity.terminalNotice}</Text>
            ) : null}
            {state.run?.pendingQueryAuthorization ? (
              <View style={styles.card} accessibilityLabel="Public search approval">
                <Text style={styles.kicker}>Approve public search</Text>
                <Text style={styles.bodyText}>This research includes a private document. Approve the exact search terms before the app queries the public web.</Text>
                <Text style={styles.kicker}>{state.run.pendingQueryAuthorization.proposedQuery}</Text>
                {state.run.pendingQueryAuthorization.terms.map((term) => (
                  <Text key={term} style={styles.bodyText}>{term}</Text>
                ))}
                <Pressable
                  onPress={() => {
                    const pending = latestUi.current.run?.pendingQueryAuthorization;
                    if (!token || !state.run || !pending) return;
                    void api.approveQuery(token, state.run.runId, {
                      authorizationId: pending.id,
                      queryDigest: pending.queryDigest,
                      terms: pending.terms,
                    }).then(() => refreshRun(token, state.run!.runId)).then(() => {
                      if (token && state.run) startPolling(token, state.run.runId);
                    }).catch((e) => {
                      if (isSupersededRequest(e)) return;
                      setViewState((s) => ({ ...s, error: e instanceof Error ? e.message : "Could not approve this search." }));
                    });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Approve these search terms"
                >
                  <Text style={styles.link}>Approve these terms</Text>
                </Pressable>
              </View>
            ) : null}

            <ResearchBriefCard
              view={briefView}
              clarifyAnswer={clarifyAnswer}
              muted={theme.muted}
              onClarify={setClarifyAnswer}
              onContinue={() => { void onContinueClarification(); }}
              onEdit={() => {
                setClarifyAnswer(briefView.assumptions.join("\n"));
                setEditingAssumptions(true);
                setState((s) => ({ ...s, error: null }));
              }}
              styles={{ ...styles, card: styles.clarifyCard }}
            />

            {state.report ? (
              <View style={styles.reportBody} accessibilityLabel="Research report" onLayout={(event) => {
                reading.current.measureCard(readerView, event.nativeEvent.layout.y);
                restoreReadingPosition();
              }}>
                {state.report.labeledDemo === true || state.run?.labeledDemo === true ? <Text style={styles.sampleMark}>Sample</Text> : null}
                <ReportSections
                  blocks={blocks}
                  detailed={detailed}
                  showOutline={detailed}
                  styles={styles}
                  citationIndex={citeIndex}
                  onOpenSource={(id, blockId) => {
                    const block = blocks.find((item) => item.id === blockId);
                    setSourceClaim(block?.text.slice(0, 180) ?? null);
                    void onOpenSource(id, blockId);
                  }}
                  onCitationRef={(id, node, blockId) => {
                    const guard = api.captureView();
                    sourceFocus.current.register(focusGeneration, JSON.stringify([blockId, id]), node, guard.current);
                    guard.release();
                  }}
                  onLayoutY={(blockId, y) => {
                    reading.current.measureBlock(readerView, blockId, y);
                    restoreReadingPosition();
                  }}
                />
                {state.report.changeSummary ? (
                  <Text style={styles.caveat} accessibilityLabel="Change summary">
                    {humanChangeSummary(state.report.changeSummary)}
                  </Text>
                ) : null}
                {state.report.limitations.map((l) => (
                  <Text key={l} style={styles.caveat}>
                    {l}
                  </Text>
                ))}
                <Pressable onPress={() => onShare()} accessibilityRole="button" accessibilityLabel="Share report" hitSlop={12}>
                  <Text style={styles.link}>Share report</Text>
                </Pressable>
                {!state.report.labeledDemo ? <View>
                  <Pressable onPress={() => setShowVerification((open) => !open)} accessibilityRole="button" accessibilityLabel="Recheck the answer claim" hitSlop={12}>
                    <Text style={styles.quietLink}>{showVerification ? "Hide recheck" : "Recheck answer"}</Text>
                  </Pressable>
                  {showVerification ? <>
                    <Text style={styles.bodyText}>Recheck the answer claim against the inspected source evidence. This uses your research allowance; it does not independently establish every fact.</Text>
                    <TextInput value={verificationNote} onChangeText={setVerificationNote} maxLength={4000} editable={!verificationBusy && !state.pendingVerification}
                      accessibilityLabel="Optional feedback saved with verification" placeholder="Optional feedback for this request" style={styles.input} />
                    <Text style={styles.caveat}>Feedback is saved with the request. The check assesses the selected claim and evidence; it does not assess this note.</Text>
                    <Pressable disabled={verificationBusy || !!state.pendingVerification} accessibilityRole="button" accessibilityLabel="Change verification evidence policy"
                      onPress={() => setVerificationPolicy(p => p === "reuse_snapshot" ? "refresh_sources" : "reuse_snapshot")}>
                      <Text style={styles.quietLink}>{verificationPolicy === "reuse_snapshot" ? "Use inspected evidence" : "Refresh inspected sources"}</Text>
                    </Pressable>
                    <Pressable onPress={() => void onFollowUp()} disabled={verificationBusy || !!state.pendingVerification} accessibilityRole="button" accessibilityLabel="Submit answer recheck">
                      <Text style={styles.quietLink}>{verificationBusy ? "Requesting check…" : "Recheck answer claim"}</Text>
                    </Pressable>
                  </> : null}
                </View> : null}
                {state.flagSent || flagStatus === "submitted" ? (
                  <Text style={styles.caveat} accessibilityLabel="Flag submitted">Report submitted. Thank you.</Text>
                ) : flagOpen ? (
                  <View accessibilityLabel="Report generated output">
                    <Text style={styles.kicker}>Report this generated answer</Text>
                    {OUTPUT_REPORT_CATEGORIES.map((cat) => (
                      <Pressable
                        key={cat}
                        onPress={() => setFlagCategory(cat)}
                        accessibilityRole="button"
                        accessibilityLabel={`Category ${cat}`}
                        accessibilityState={{ selected: flagCategory === cat }}
                      >
                        <Text style={flagCategory === cat ? styles.link : styles.bodyText}>{cat}</Text>
                      </Pressable>
                    ))}
                    <TextInput
                      value={flagNote}
                      onChangeText={setFlagNote}
                      placeholder="Optional explanation"
                      accessibilityLabel="Report explanation"
                      style={styles.input}
                      multiline
                    />
                    <Pressable
                      onPress={() => setFlagInclude((v) => !v)}
                      accessibilityRole="button"
                      accessibilityLabel="Include report excerpt"
                      accessibilityState={{ selected: flagInclude }}
                    >
                      <Text style={styles.link}>{flagInclude ? "Include excerpt: yes" : "Include excerpt: no"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        if (!token || !state.report) return;
                        setFlagStatus("submitting");
                        try {
                          await api.challenge(token, state.report.reportId, {
                            claimId: state.report.blocks.find((b) => b.id === "answer")?.claimIds[0],
                            category: flagCategory,
                            note: flagNote,
                            includeExcerpt: flagInclude,
                          });
                          setFlagStatus("submitted");
                          setState((s) => ({ ...s, flagSent: true }));
                        } catch (error) {
                          if (isSupersededRequest(error)) return;
                          setFlagStatus("error");
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Submit generated-output report"
                      disabled={flagStatus === "submitting"}
                    >
                      <Text style={styles.link}>{flagStatus === "submitting" ? "Submitting…" : "Submit report"}</Text>
                    </Pressable>
                    {flagStatus === "error" ? <Text style={styles.error}>Could not submit. Try again.</Text> : null}
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setFlagOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Flag this generated answer"
                  >
                    <Text style={styles.link}>Flag this answer</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
            {staleCorrection && state.run && !state.run.contentInvalidated ? (
              <View accessibilityLabel="Correction">
                {staleCorrection ? <>
                  <Text style={styles.bodyText}>This saved correction was written for version {savedCorrection?.baseRevision}. Review it against the current question before submitting: {state.run?.brief?.originalQuestion}</Text>
                  <Pressable disabled={correctionPending} accessibilityRole="button" accessibilityLabel="Use saved correction for current version" onPress={() => {
                    const runId = state.run?.runId, revision = state.run?.brief?.revision;
                    if (token && runId && revision && api.currentRun(token, runId)) setViewState(s => rebaseCorrectionDraft(s, runId, revision));
                  }}><Text style={styles.link}>Use this correction for the current version</Text></Pressable>
                </> : null}
                {correctionMode !== "unavailable" ? (
                  <Pressable onPress={() => setShowCorrectionOptions((value) => !value)} accessibilityRole="button" accessibilityLabel="Documents and evidence options" accessibilityState={{ expanded: showCorrectionOptions }} hitSlop={12}>
                    <Text style={styles.link}>{showCorrectionOptions ? "Hide documents and evidence options" : "Documents and evidence options"}</Text>
                  </Pressable>
                ) : null}
                {showCorrectionOptions && correctionMode === "replace_question" && !state.pendingCorrectionDocuments ? <View>
                  <Text style={styles.bodyText}>Add documents to this report using the same question and saved evidence. Research will reassess the answer. The total limit is three documents, including existing files.</Text>
                  {correctionFiles.map((file, index) => <Pressable key={index} disabled={correctionPending} accessibilityRole="button" accessibilityLabel={`Remove ${file.filename}`} onPress={() => setCorrectionFiles(files => files.filter((_, i) => i !== index))}><Text style={styles.link}>{file.filename} · Remove</Text></Pressable>)}
                  <Pressable disabled={documentPending || correctionPending || correctionFiles.length >= 3} accessibilityRole="button" accessibilityLabel="Select document for correction" onPress={() => void pickCorrectionDocument()}><Text style={styles.link}>Select document for this report</Text></Pressable>
                  <Pressable disabled={documentPending || correctionPending || !correctionFiles.length || !correctionReady} accessibilityRole="button" accessibilityLabel="Add documents and update report" onPress={() => void addCorrectionDocuments()}><Text style={styles.link}>Add documents and update report</Text></Pressable>
                  <Text style={styles.bodyText}>Selected file bytes stay in memory until submitted. After closing the app, select unconfirmed files again.</Text>
                </View> : null}
                {showCorrectionOptions && correctionMode==="replace_question"?<>
                  <Text style={styles.bodyText}>Write the complete updated question. Its conclusions will be checked again.</Text>
                  <Pressable disabled={correctionPending} onPress={()=>{
                    const question = state.run?.brief?.originalQuestion ?? "";
                    setCorrection(question);
                    setState((s) => ({ ...s, draft: question }));
                  }} accessibilityRole="button" accessibilityLabel="Use current question">
                    <Text style={styles.link}>Edit current question</Text>
                  </Pressable>
                  {(["reuse_snapshot","refresh"] as const).map((policy)=><Pressable key={policy} disabled={correctionPending} onPress={()=>setEvidencePolicy(policy)} accessibilityRole="radio" accessibilityState={{checked:evidencePolicy===policy,disabled:correctionPending}} accessibilityLabel={policy==="reuse_snapshot"?"Reuse previously read source versions":"Read sources again"}>
                    <Text style={styles.bodyText}>{evidencePolicy===policy?"● ":"○ "}{policy==="reuse_snapshot"?"Reuse previously read source versions":"Read sources again"}</Text>
                  </Pressable>)}
                  <Text style={styles.bodyText}>Reused versions may be older. Refresh requests new evidence; uploaded files retain their supplied bytes.</Text>
                </>:null}
                {!composerContinues ? (
                  <>
                    {correctionMode==="unavailable"?<Text style={styles.bodyText}>Corrections are not available on this research route.</Text>:null}
                    {correctionReady&&Number.isSafeInteger(state.run.correctionReserveMicro)&&state.run.correctionReserveMicro!>=0?<Text style={styles.bodyText}>Reserves US${(state.run.correctionReserveMicro!/1_000_000).toFixed(2)} of research allowance. Your earlier report remains available.</Text>:null}
                    <TextInput
                      value={correction}
                      onChangeText={setCorrection}
                      placeholder={correctionMode==="replace_question"?"Your complete revised research question":"Actually, the budget is 120 EUR"}
                      multiline
                      maxLength={20_000}
                      editable={!correctionPending&&!verificationBusy&&!state.pendingVerification&&correctionMode!=="unavailable"}
                      placeholderTextColor={theme.muted}
                      style={styles.input}
                      allowFontScaling
                      maxFontSizeMultiplier={2}
                      accessibilityLabel={correctionMode==="replace_question"?"Revised research question":"Correction field"}
                    />
                    <Pressable onPress={() => void onCorrect()} disabled={correctionPending||!!state.pendingCorrectionDocuments||!correctionReady} accessibilityState={{disabled:correctionPending||!!state.pendingCorrectionDocuments||!correctionReady,busy:correctionPending}} accessibilityRole="button" accessibilityLabel="Submit correction">
                      <Text style={styles.link}>{correctionPending?"Updating…":"Update research"}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        {state.source ? (
          <SourceSheet key={JSON.stringify([token, state.report?.reportId, state.source.passageId])} source={state.source} styles={styles}
            canFocus={() => Boolean(token && state.run && api.currentRun(token, state.run.runId) && latestUi.current.tab === "research" && latestUi.current.source?.passageId === state.source?.passageId && latestUi.current.report?.reportId === state.report?.reportId)}
            onDelete={target => void onDeleteSource(target)} deletionPending={sourceDeleteBusy}
            offline={state.offline} admissionPending={!!state.pendingAdmission || !!state.pendingVerification || !!state.pendingCorrectionDocuments || correctionPending}
            relatedClaim={sourceClaim}
            onChallenge={() => { api.closeSource(); setState(s => ({ ...s, source: null })); setFlagOpen(true); }}
            onVerify={() => { api.closeSource(); setState(s => ({ ...s, source: null })); void onFollowUp(); }}
            onOpenOriginal={(url) => {
              const guard = api.captureView();
              void Linking.openURL(url).catch(() => {
                if (guard.current()) setViewState(s => ({ ...s, error: "Could not open the original source." }));
              }).finally(() => guard.release());
            }}
            onClose={closeSource} />
        ) : null}

        {state.tab === "library" && !state.source && !state.pendingContentInvalidation && !state.pendingSourceDeletion && !sourceDeleteBusy && !state.pendingVerification && !state.pendingCorrectionDocuments && !correctionPending && !verificationBusy ? (
          <LibraryList
            token={token}
            reloadKey={`${state.run?.runId ?? ""}:${state.report?.reportId ?? ""}:${state.status}`}
            styles={styles}
            onOpen={async (id) => {
              if (state.pendingContentInvalidation || state.pendingSourceDeletion || deletingSource.current || verifying.current || state.pendingVerification || state.pendingCorrectionDocuments || correctionAttempt.current) return;
              api.selectRun(id);
              if (!token) return;
              const opening = openLibraryItem(latestUi.current, id);
              setState((s) => openLibraryItem(s, id));
              await refreshRun(token, id, opening);
              startPolling(token, id);
            }}
            onShare={(reportId) => onShare(reportId)}
          />
        ) : null}
        {state.tab === "settings" && !state.source ? (
          <ProfilePanel
            styles={styles}
            processors={processors}
            privacyFlows={privacyFlows}
            deletionVsSub={deletionVsSub}
            restoreMessage={restoreMessage}
            state={state}
            accountLabel={accountId ? `Account ${accountId.slice(0, 8)}` : "Development account"}
            appearance={appearance}
            onDone={() => setState((s) => ({ ...s, tab: "research" }))}
            onOpenLibrary={() => setState((s) => ({ ...s, tab: "library" }))}
            onAppearance={(value) => {
              setAppearance(value);
              void AsyncStorage.setItem(APPEARANCE_KEY, value).catch(() => undefined);
            }}
            processorDetailsOpen={processorDetailsOpen}
            onToggleProcessorDetails={() => setProcessorDetailsOpen((open) => !open)}
            onOpenDeletionPage={() => void Linking.openURL(deletionPageUrl)}
            onConsent={grantConsent}
            onSignIn={() => { void ensureSession().catch(() => undefined); }}
            onRestore={async () => {
              if (!token) {
                setRestoreMessage("Sign in first. Restore still requires a store sandbox.");
                return;
              }
              try {
                await api.restorePurchases(token);
                setRestoreMessage("Unexpected restore success; purchases remain gated.");
              } catch (e) {
      if (isSupersededRequest(e)) return;
                setRestoreMessage(e instanceof Error ? e.message : "Restore is unavailable until a store sandbox is connected.");
              }
            }}
            onMode={(routeMode) => setState((s) => s.pendingAdmission ? { ...s, error: "Check or withdraw the saved request before changing research mode." } : { ...s, routeMode })}
            onDelete={async () => {
              if (!token) return;
              try {
                stopPolling();
                const result = await api.deleteAccount(token);
                api.activateSession(null); clearPanels();
                setToken(null); setAccountId(null); setState({ ...emptyState(), error: result.fileCleanupPending ? "Account access removed. Stored file deletion is queued for retry." : null });
                await clearAccountLocal(sessionStorage);
              } catch (error) {
                if (isSupersededRequest(error)) return;
                setState((s) => ({ ...s, error: "Could not confirm complete deletion. Retry deletion or device cleanup." }));
              }
            }}
            onLogout={() => {
              stopPolling();
              api.activateSession(null); clearPanels();
              void logoutLocal(sessionStorage).then(() => setStorageReady(true)).catch(() => setState((s) => ({ ...s, error: "Device cleanup failed. Retry signing out." })));
              setToken(null);
              setAccountId(null);
              setState((s) => logoutState(s));
            }}
            onRevoke={async () => {
              if (!token) return;
              try { if (correctionAttempt.current) api.invalidateView(token); await api.consent(token, false); setCorrectionFiles([]); setState((s) => ({ ...s, consentGranted: false })); }
              catch (error) {
                if (isSupersededRequest(error)) return;
                setState((s) => ({ ...s, error: "Could not confirm consent revocation. Retry." }));
              }
            }}
          />
        ) : null}

        {state.tab === "research" && !state.source ? (
          <View
            style={attachVisible ? undefined : { height: 0, overflow: "hidden" }}
            pointerEvents={attachVisible ? "auto" : "none"}
            accessibilityElementsHidden={!attachVisible}
            importantForAccessibility={attachVisible ? "auto" : "no-hide-descendants"}
          >
          <AttachmentPanel styles={styles} muted={theme.muted} attachments={state.attachments}
            pending={documentPending || uploadStatus !== null} visible={attachVisible} status={uploadStatus} filename={attachName} text={attachText}
            onFilename={setAttachName} onText={setAttachText} onPick={() => void onPickDocument()}
            onRemove={index => setState(s => ({ ...s, attachments: s.attachments.filter((_, i) => i !== index) }))}
            onAttachNote={() => {
                if (deletingSource.current || state.pendingContentInvalidation || state.pendingSourceDeletion || verifying.current || state.pendingVerification || state.pendingCorrectionDocuments || correctionAttempt.current) return;
                setState((s) =>
                  attachFile(s, {
                    filename: attachText.trimStart().startsWith("#") ? "note.md" : "note.txt",
                    mime: attachText.trimStart().startsWith("#") ? "text/markdown" : "text/plain",
                    text: attachText,
                  }),
                );
                setAttachText("");
              }} />
          </View>
        ) : null}
        {state.tab === "research" && !state.source && followUps.length > 0 ? (
          <View style={styles.followRow} accessibilityLabel="Suggested follow-ups">
            {followUps.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setState((s) => ({
                  ...s,
                  draft: draftFromFollowUp({
                    prompt: item.prompt,
                    originalQuestion: s.run?.brief?.originalQuestion,
                    replaceQuestion: correctionMode === "replace_question",
                  }),
                }))}
                accessibilityRole="button"
                accessibilityLabel={`Follow up: ${item.prompt}`}
                hitSlop={12}
                style={styles.followChipHit}
              >
                <Text style={styles.followChip}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {state.tab === "research" && !state.source ? (
        <ResearchComposer
          draft={state.draft}
          muted={theme.composer.placeholder}
          sendInk={theme.composer.sendInk}
          editable={hydrated && !verificationBusy && !sourceDeleteBusy && uploadStatus === null && !correctionPending && state.run?.lifecycle !== "awaiting_input"}
          sendDisabled={!hydrated || documentPending || uploadStatus !== null || sourceDeleteBusy || !!state.pendingSourceDeletion || correctionPending || verificationBusy || state.offline || state.run?.lifecycle === "awaiting_input" || (composerContinues && !correctionReady)}
          pendingAdmission={!!state.pendingAdmission}
          placeholder={composerContinues ? "Ask anything" : "What should I research?"}
          sendAccessLabel={composerContinues ? "Send follow-up" : "Start research"}
          attachOpen={attachVisible}
          inProgress={activity.inProgress && state.run?.lifecycle !== "awaiting_input"}
          onChange={(draft) => setState((s) => ({ ...s, draft }))}
          onSend={() => {
            if (composerContinues) {
              const files = latestUi.current.attachments;
              if (files.length) {
                setCorrectionFiles(files);
                void addCorrectionDocuments(files);
              } else void onCorrect(latestUi.current.draft);
            }
            else if (finishedReport) {
              setViewState((s) => ({
                ...s,
                error: correctionMode === "unavailable"
                  ? "Corrections are not available on this research route. Start new research to ask something else."
                  : "Review the saved correction, or start new research.",
              }));
            } else void onSend();
          }}
          onAttach={() => setShowAttach((open) => !open)}
          onCancel={() => void onCancel()}
          styles={{
            ...styles,
            composerDock: [styles.composerDock, { paddingBottom: keyboardOpen
              ? (Platform.OS === "android" ? Math.max(keyboardInset - Math.max(insets.bottom, 0), space.xs) + 16 : space.xs)
              : Math.max(insets.bottom, space.sm) }],
          }}
        />
        ) : null}


      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}
