import { applyRemoteInvalidation, redactInvalidatedContent } from "./src/remote-invalidation";
import { adoptCorrectionFile, correctionFilesFor, authoritativeCorrection, resolveCorrectionDocuments, adoptCorrectionSnapshot, type CorrectionSelection } from "./src/correction-documents-flow";
import { prepareCorrectionDocuments, submitCorrectionDocuments } from "./src/correction-documents";
import { ProfilePanel } from "./src/ProfilePanel";
import { claimIdForReportBlock, claimsForReportBlock, pickUniqueClaimId, uniqueAnswerClaimId, prepareVerificationRequest, submitVerificationRequest, readVerificationRun, type PendingVerificationRequest } from "./src/verification-request";
import { prepareSourceDeletion, sameSourceDeletionTarget, sourceDeletionTarget, type SourceDeletionTarget } from "./src/source-deletion";
import { submitSourceDeletion } from "./src/source-deletion-flow";
import { createSourceFocus } from "./src/source-focus";
import { createReadingRestoration } from "./src/reading-position";
import { nativeDocumentDigest } from "./src/native-document-digest";
import { prepareAdmission, submitAdmission, readAdmittedRun, type AdmittedRun } from "./src/admission-retry";
import { SourceSheet } from "./src/SourceSheet";
import { readSourceDetail } from "./src/source-view";
import { activeCorrectionDraft, editCorrectionDraft, rebaseCorrectionDraft, runPendingCorrection } from "./src/correction-draft";
import { AttachmentPanel } from "./src/AttachmentPanel";
import { ResearchActivity } from "./src/ResearchActivity";
import { ResearchBriefCard } from "./src/ResearchBriefCard";
import { ResearchComposer } from "./src/ResearchComposer";
import { ReportSections } from "./src/ReportView";
import { LibraryList } from "./src/LibraryList";
import { EmptyHome } from "./src/EmptyHome";
import { ResearchHeader } from "./src/ResearchHeader";
import { PendingBanners } from "./src/PendingBanners";
import { ReportActions } from "./src/ReportActions";
import { CorrectionPanel } from "./src/CorrectionPanel";
import { productHaptic } from "./src/haptics";
import { useKeyboardInset } from "./src/use-keyboard-inset";
import { composerDockBottomInset } from "./src/composer-keyboard";
import { composerPlaceholder } from "./src/composer-copy";
import { adoptPublicEvents, liveActivityFollowsLatest, userReleasedLiveFollow } from "./src/research-activity";
import { clarificationPromptFromEvents, researchBriefView } from "./src/research-brief";
import { continueRunRequest, runAssumptionsMutation } from "./src/pending-input";
import { queryAuthorizationApproveBody, queryAuthorizationPending } from "./src/query-authorization";
import { humanChangeSummary } from "./src/correction-copy";
import { citationNumbers } from "./src/citation-chips";
import { draftFromFollowUp, followUpSuggestions, routeFollowUp } from "./src/follow-ups";
import { bindFollowUpExplain, recordFollowUpExplain, visibleFollowUpExplains } from "./src/follow-up-explain";
import { adoptReturnedChild } from "./src/constraint-delta";
import { runMutatingFollowUp, unresolvedFollowUp, type MutatingFollowUpKind } from "./src/follow-up-admission";
import { clearDocumentPickerCache, pickDocument } from "./src/native-documents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  useColorScheme,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { color, space } from "@deep/design";
import { makeStyles } from "./src/product-styles";
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
  const [followLiveActivity, setFollowLiveActivity] = useState(true);
  const followLiveRef = useRef(true);
  const liveScrollY = useRef(0);
  const [sourceClaim, setSourceClaim] = useState<{ blockId: string; claimIds: string[]; selectedClaimId: string | null; text: string; claimTexts: { id: string; text: string }[] } | null>(null);
  const [flagClaimId, setFlagClaimId] = useState<string | null>(null);
  const followUpBusy = useRef(false);
  const announcedReport = useRef<string | null>(null);

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
  const { keyboardOpen, keyboardInset, keyboardOpenRef, keyboardInsetRef, dismissKeyboard } = useKeyboardInset();
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
  useEffect(() => {
    followLiveRef.current = true;
    setFollowLiveActivity(true);
    liveScrollY.current = 0;
  }, [state.run?.runId]);
  useEffect(() => {
    if (!hydrated) return;
    const id = state.report?.reportId;
    if (!id || announcedReport.current === id) return;
    announcedReport.current = id;
    productHaptic("complete");
  }, [hydrated, state.report?.reportId]);

  const briefView = researchBriefView({
    lifecycle: state.run?.lifecycle,
    status: state.status,
    brief: state.run?.brief,
    clarificationSummary: clarificationPromptFromEvents(state.events),
    hasReport: Boolean(state.report),
    pendingInputType: state.run?.pendingInput?.type,
  });
  const queryApprovalPending = queryAuthorizationPending(state.run);
  const finishedReport = composerFollowsReport(state);
  const composerContinues = finishedReport;
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
        const next = { ...emptyState(), draft: prev.signedIn ? "" : prev.draft, signedIn: true, error: null, routeMode: prev.routeMode, reducedMotion: prev.reducedMotion };

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
      const incoming = adoptPublicEvents(ev.events);
      const currentUi = latestUi.current;
      const sameSnapshot = currentUi.run?.runId === snap.runId
        && currentUi.run?.lifecycle === snap.lifecycle
        && currentUi.run?.phase === snap.phase
        && currentUi.run?.outcome === snap.outcome
        && currentUi.run?.reportId === snap.reportId
        && currentUi.run?.brief?.revision === snap.brief?.revision
        && currentUi.run?.pendingQueryAuthorization?.id === snap.pendingQueryAuthorization?.id
        && currentUi.run?.pendingInput?.id === snap.pendingInput?.id
        && currentUi.run?.pendingInput?.type === snap.pendingInput?.type
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
        let next: typeof s;
        try {
          next = applySnapshot(s, snap);
        } catch (error) {
          return { ...s, error: error instanceof Error ? error.message : "Pending search approval is invalid. Public search will not continue." };
        }
        next = { ...next, events: sameRun ? mergeEvents(s.events, incoming) : incoming };
        if (report) {
          next = {
            ...next,
            report: {
              reportId: report.reportId,
              version: report.version,
              blocks: report.blocks,
              claims: Array.isArray(report.claims)
                ? report.claims.filter((row: { id?: unknown; text?: unknown }) => typeof row?.id === "string" && typeof row?.text === "string")
                  .map((row: { id: string; text: string }) => ({ id: row.id, text: row.text }))
                : undefined,
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
      if (keyboardOpenRef.current || keyboardInsetRef.current > 0) {
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
      if (r.next.run !== latestUi.current.run || r.next.tab !== latestUi.current.tab) {
        stopPolling();
        api.selectRun(null);
        api.closeSource();
        setSentQuestion(null);
        setClarifyAnswer("");
        setEditingAssumptions(false);
        setShowAttach(false);
        setActivityExpanded(false);
      }
      setState(r.next);
      return true;
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
      const adopted = await runPendingCorrection({
        pending: current.pendingCorrection,
        parentRunId: current.run.runId,
        question: text,
        expectedBriefRevision: current.run.brief.revision,
        evidencePolicy,
        current: guard.current,
        save: async (saved) => {
          await sessionStorage.persistRequired(token, { ...latestUi.current, pendingCorrection: saved });
          if (!guard.current()) throw new SupersededRequest();
          setState((s) => ({ ...s, pendingCorrection: saved }));
        },
        post: (parentRunId, question, expectedBriefRevision, policy, idempotencyKey) =>
          api.correct(token, parentRunId, expectedBriefRevision, question,
            correctionMode==="replace_question"?{kind:"replace_question",question,evidencePolicy:policy}:undefined,
            idempotencyKey),
        adopt: async (body) => {
          api.selectRun(body.runId);
          api.closeSource();
          setShowAttach(false);
          setSentQuestion(text);
          setViewState((s) => ({
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
              runId: body.runId,
              lifecycle: "queued",
              phase: "preparing",
              outcome: null,
              reportId: null,
              labeledDemo: s.run?.labeledDemo === true,
            },
          }));
          await refreshRun(token, body.runId);
          startPolling(token, body.runId);
        },
      });
      if (!guard.current()) throw new SupersededRequest();
      await sessionStorage.persistRequired(token, { ...latestUi.current, pendingCorrection: adopted.phase === "adopted" ? null : adopted });
      if (!guard.current()) throw new SupersededRequest();
      setViewState((s) => ({ ...s, pendingCorrection: null, error: null }));
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
    submitting.current = false;
    correctionAttempt.current = null;
    verifying.current = false;
    deletingSource.current = false;
    const result = startNewResearch(latestUi.current);
    if (!result.ok) {
      setViewState((s) => ({ ...s, error: result.reason }));
      return;
    }
    dismissKeyboard();
    stopPolling();
    api.selectRun(null);
    api.closeSource();
    setShowAttach(false);
    setShowCorrectionOptions(false);
    setShowVerification(false);
    setSentQuestion(null);
    setActivityExpanded(false);
    setSourceClaim(null);
    setClarifyAnswer("");
    setEditingAssumptions(false);
    setViewState(result.next);
  }

  async function onContinueClarification() {
    if (!token || !state.run || clarifying.current) return;
    if (queryAuthorizationPending(latestUi.current.run) || queryAuthorizationPending(state.run)) {
      setViewState((s) => ({ ...s, error: "Approve the exact search terms before public search can continue." }));
      return;
    }
    if (latestUi.current.offline) {
      setViewState((s) => ({ ...s, error: "You are offline. The draft and last report stay on this device." }));
      return;
    }
    const runId = state.run.runId;
    const answer = clarifyAnswer.trim();
    const field = state.run.pendingInput?.field;
    if (editingAssumptions) {
      const values = clarifyAnswer.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!values.length) {
        setViewState((s) => ({ ...s, error: "Enter the assumptions to keep." }));
        return;
      }
      clarifying.current = true;
      const guard = api.captureView();
      try {
        const revision = state.run.brief?.revision;
        if (!revision) throw new Error("Refresh this run before replacing assumptions.");
        const adopted = await runAssumptionsMutation({
          pending: latestUi.current.pendingAssumptions,
          parentRunId: runId,
          action: "replace",
          values,
          expectedBriefRevision: revision,
          current: guard.current,
          save: async (saved) => {
            await sessionStorage.persistRequired(token, { ...latestUi.current, pendingAssumptions: saved });
            if (!guard.current()) throw new SupersededRequest();
            setState((s) => ({ ...s, pendingAssumptions: saved }));
          },
          post: (parentRunId, body, idempotencyKey) => api.confirmAssumptions(token, parentRunId, body, idempotencyKey),
          adopt: async (body) => {
            setEditingAssumptions(false);
            setClarifyAnswer("");
            AccessibilityInfo.announceForAccessibility("Assumptions updated.");
            await adoptReturnedChild({
              parentRunId: runId,
              body,
              requireRunId: true,
              selectRun: api.selectRun,
              refresh: (runId) => refreshRun(token, runId),
              poll: (runId) => startPolling(token, runId),
            });
          },
        });
        await sessionStorage.persistRequired(token, { ...latestUi.current, pendingAssumptions: adopted.phase === "adopted" ? null : adopted });
        if (!guard.current()) throw new SupersededRequest();
        setViewState((s) => ({ ...s, pendingAssumptions: null, error: null }));
      } catch (e) {
        if (isSupersededRequest(e)) return;
        if (isExpiredSession(e)) await onAuthFailure();
        else if (isOfflineError(e)) {
          setViewState((s) => ({ ...s, offline: true, error: "You are offline. The draft and last report stay on this device." }));
        } else setViewState((s) => ({ ...s, error: e instanceof Error ? e.message : "Could not update assumptions." }));
      } finally { clarifying.current = false; guard.release(); }
      return;
    }
    if (!briefView.blocking) {
      clarifying.current = true;
      const guard = api.captureView();
      try {
        const revision = state.run.brief?.revision;
        if (!revision) throw new Error("Refresh this run before confirming assumptions.");
        const adopted = await runAssumptionsMutation({
          pending: latestUi.current.pendingAssumptions,
          parentRunId: runId,
          action: "confirm",
          expectedBriefRevision: revision,
          current: guard.current,
          save: async (saved) => {
            await sessionStorage.persistRequired(token, { ...latestUi.current, pendingAssumptions: saved });
            if (!guard.current()) throw new SupersededRequest();
            setState((s) => ({ ...s, pendingAssumptions: saved }));
          },
          post: (parentRunId, body, idempotencyKey) => api.confirmAssumptions(token, parentRunId, body, idempotencyKey),
          adopt: async () => {
            AccessibilityInfo.announceForAccessibility("Assumptions confirmed.");
            await refreshRun(token, runId);
          },
        });
        await sessionStorage.persistRequired(token, { ...latestUi.current, pendingAssumptions: adopted.phase === "adopted" ? null : adopted });
        if (!guard.current()) throw new SupersededRequest();
        setViewState((s) => ({ ...s, pendingAssumptions: null, error: null }));
      } catch (e) {
        if (isSupersededRequest(e)) return;
        if (isExpiredSession(e)) await onAuthFailure();
        else if (isOfflineError(e)) {
          setViewState((s) => ({ ...s, offline: true, error: "You are offline. The draft and last report stay on this device." }));
        } else setViewState((s) => ({ ...s, error: e instanceof Error ? e.message : "Could not confirm assumptions." }));
      } finally { clarifying.current = false; guard.release(); }
      return;
    }
    if (!answer) {
      setViewState((s) => ({ ...s, error: field === "geography" ? "Enter a jurisdiction. The app will not assume a country." : "Answer the detail above to continue." }));
      return;
    }
    clarifying.current = true;
    try {
      await api.continueRun(token, state.run.runId, continueRunRequest({
        pendingInput: state.run.pendingInput,
        value: answer,
      }));
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

  async function onExplainFollowUp(message: string) {
    const current = latestUi.current;
    if (!token || !current.run || followUpBusy.current) return;
    const text = message.trim();
    if (!text) return;
    followUpBusy.current = true;
    const parentRunId = current.run.runId;
    const runActive = current.run.lifecycle === "queued" || current.run.lifecycle === "running";
    const reportReady = composerFollowsReport(current);
    const routed = routeFollowUp(text, { reportReady, runActive });
    const mutates = routed.kind === "deepen" || routed.kind === "steer" || routed.kind === "add_source" || routed.kind === "change_constraint";
    const guard = api.captureView();
    try {
      const revision = current.run.brief?.revision;
      if (mutates) {
        if (typeof revision !== "number") throw new Error("Refresh this run before sending additional research.");
        if (unresolvedFollowUp(current.pendingFollowUp)
          && (current.pendingFollowUp!.parentRunId !== parentRunId || current.pendingFollowUp!.message !== text)) {
          throw new Error("Retry the saved follow-up before sending a different request.");
        }
        const adopted = await runMutatingFollowUp({
          pending: current.pendingFollowUp,
          parentRunId,
          message: text,
          expectedBriefRevision: revision,
          kind: routed.kind as MutatingFollowUpKind,
          current: guard.current,
          save: async (saved) => {
            await sessionStorage.persistRequired(token, { ...latestUi.current, pendingFollowUp: saved });
            if (!guard.current()) throw new SupersededRequest();
            setState((s) => ({ ...s, pendingFollowUp: saved }));
          },
          post: (runId, message, expectedBriefRevision, idempotencyKey) =>
            api.explainFollowUp(token, runId, { message, expectedBriefRevision }, idempotencyKey),
          adopt: async (body) => {
            await adoptReturnedChild({
              parentRunId,
              body,
              requireRunId: true,
              selectRun: api.selectRun,
              refresh: (runId) => refreshRun(token, runId),
              poll: (runId) => startPolling(token, runId),
            });
          },
        });
        await sessionStorage.persistRequired(token, { ...latestUi.current, pendingFollowUp: adopted.phase === "adopted" ? null : adopted });
        if (!guard.current()) throw new SupersededRequest();
        setViewState((s) => ({ ...s, pendingFollowUp: null, draft: s.draft.trim() === text ? "" : s.draft, error: null }));
        return;
      }
      const body = await api.explainFollowUp(token, parentRunId, {
        message: text,
        expectedBriefRevision: revision,
      }) as { kind?: string; answer?: string; evidenceComplete?: boolean; runId?: string; briefRevision?: number; citationPassageIds?: unknown };
      if (!guard.current()) throw new SupersededRequest();
      if (body.kind === "explain") {
        if (!accountId) throw new Error("Sign in required.");
        const bound = bindFollowUpExplain({
          accountId,
          runId: parentRunId,
          reportId: current.report?.reportId ?? null,
          question: text,
          answer: typeof body.answer === "string" ? body.answer : "This report does not establish that.",
          evidenceComplete: body.evidenceComplete === true,
          citationPassageIds: body.citationPassageIds,
        });
        setViewState((s) => {
          const recorded = recordFollowUpExplain(s, bound);
          return {
            ...s,
            draft: s.draft.trim() === text ? "" : s.draft,
            error: null,
            followUpExplains: recorded.followUpExplains,
          };
        });
        return;
      }
      throw new Error("Follow-up was not accepted. Retry the saved request.");
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) setViewState((s) => ({ ...s, offline: true, error: (e as Error).message }));
      else setViewState((s) => ({ ...s, error: (e as Error).message }));
    } finally {
      followUpBusy.current = false;
      guard.release();
    }
  }

  async function onComposerFollowUp(submitted?: string) {
    const current = latestUi.current;
    const text = (submitted ?? current.draft).trim();
    if (!text) return;
    if (queryAuthorizationPending(current.run)) {
      setViewState((s) => ({ ...s, error: "Approve the exact search terms before public search can continue." }));
      return;
    }
    const runActive = current.run?.lifecycle === "queued" || current.run?.lifecycle === "running";
    const reportReady = composerFollowsReport(current);
    const routed = routeFollowUp(text, { reportReady, runActive });
    const mutates = routed.kind === "deepen" || routed.kind === "steer" || routed.kind === "add_source" || routed.kind === "change_constraint";
    if (mutates && !correctionReady) {
      setViewState((s) => ({ ...s, error: "Additional research is not available on this route. You can still ask for an explanation from this report." }));
      return;
    }
    if (routed.kind === "explain" || routed.kind === "deepen" || routed.kind === "steer" || routed.kind === "add_source" || routed.kind === "change_constraint") {
      await onExplainFollowUp(text);
      return;
    }
    if (routed.kind === "verify_challenge") {
      await onFollowUp(sourceClaim?.selectedClaimId ?? undefined);
      return;
    }
    if (routed.kind === "new_research") {
      const started = startNewResearch({ ...current, attachments: [] });
      if (!started.ok) {
        setViewState((s) => ({ ...s, error: started.reason }));
        return;
      }
      const next = { ...started.next, draft: text, attachments: [] };
      latestUi.current = next;
      setViewState(() => next);
      void onSend();
      return;
    }
    await onCorrect(text);
  }

  async function onFollowUp(selectedClaimId?: string) {
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
        const claimId = selectedClaimId ?? sourceClaim?.selectedClaimId ?? claimIdForReportBlock(state.report?.blocks, sourceClaim?.blockId);
        if (!claimId || !state.report?.version) throw new Error("Open the citation for the conclusion you want verified.");
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
        <ResearchHeader
          tab={state.tab}
          title={
            state.tab === "library"
              ? "Library"
              : state.tab === "settings"
                ? "Settings"
                : (state.run || state.report || state.pendingAdmission)
                  ? (state.run?.brief?.originalQuestion ?? state.pendingAdmission?.question ?? sentQuestion ?? "Deep")
                  : "Deep"
          }
          ink={theme.ink}
          accountId={accountId}
          signedIn={state.signedIn}
          onLibrary={() => {
            dismissKeyboard();
            setShowAttach(false);
            api.closeSource();
            setSourceClaim(null);
            setState((s) => ({ ...s, tab: "library", source: null }));
          }}
          onDone={() => { dismissKeyboard(); setState((s) => ({ ...s, tab: "research" })); }}
          onNewResearch={onNewResearch}
          onSettings={() => {
            dismissKeyboard();
            setShowAttach(false);
            api.closeSource();
            setSourceClaim(null);
            setState((s) => ({ ...s, tab: "settings", source: null }));
          }}
          styles={styles}
        />
        <PendingBanners
          styles={styles}
          pendingContentInvalidation={!!state.pendingContentInvalidation}
          pendingCorrectionDocuments={state.pendingCorrectionDocuments}
          correctionFiles={correctionFiles}
          documentPending={documentPending}
          correctionPending={correctionPending}
          uploadStatus={uploadStatus}
          pendingVerification={!!state.pendingVerification}
          verificationBusy={verificationBusy}
          pendingSourceDeletion={!!state.pendingSourceDeletion}
          sourceDeleteBusy={sourceDeleteBusy}
          onRetryCleanup={() => { if (token && state.run?.runId) void refreshRun(token, state.run.runId); }}
          onRemoveCorrectionFile={(index) => setCorrectionFiles((files) => files.filter((_, i) => i !== index))}
          onPickCorrectionDocument={() => void pickCorrectionDocument()}
          onRetryDocumentCorrection={() => void addCorrectionDocuments()}
          onResolveDocumentCorrection={() => void resolveDocumentCorrection()}
          onRetryVerification={() => void onFollowUp()}
          onResolveVerification={() => void resolvePendingVerification()}
          onRetryDeletion={() => void onDeleteSource()}
        />
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
            onScroll={(event) => {
              const y = event.nativeEvent.contentOffset.y;
              if (readerView === readerGeneration.current) scrollY.current = y;
              const live = researchActivity(latestUi.current).inProgress && !latestUi.current.report;
              if (live && userReleasedLiveFollow({ following: followLiveRef.current, offsetY: y, previousOffsetY: liveScrollY.current })) {
                followLiveRef.current = false;
                setFollowLiveActivity(false);
              }
              liveScrollY.current = y;
            }}
            onScrollBeginDrag={() => reading.current.userScrolled(readerView)}
            onScrollEndDrag={() => saveVisibleReadingPosition()}
            onMomentumScrollEnd={() => saveVisibleReadingPosition()}
            onContentSizeChange={(_width, height) => {
              reading.current.measureContent(readerView, height);
              restoreReadingPosition();
              const current = latestUi.current;
              if (liveActivityFollowsLatest({
                inProgress: researchActivity(current).inProgress,
                hasReport: Boolean(current.report),
                userReleasedFollow: !followLiveRef.current,
              })) {
                conversationScroll.current?.scrollToEnd({ animated: !current.reducedMotion });
              }
            }}
          >
            {state.pendingAdmission ? <View style={styles.card} accessibilityLabel="Saved research request">
              <Text style={styles.bodyText}>Request awaiting confirmation. Retry keeps the same question and documents.</Text>
              {state.pendingAdmission.uploads.some(u => !u.attachmentId) ? <Text style={styles.bodyText}>Select the original files again: {state.pendingAdmission.uploads.filter(u => !u.attachmentId).map(u => u.filename).join(", ")}</Text> : null}
              <Pressable disabled={uploadStatus !== null} accessibilityRole="button" accessibilityLabel="Check or withdraw saved research request" onPress={() => void resolvePendingAdmission()}><Text style={styles.link}>Check or withdraw saved request</Text></Pressable>
            </View> : null}
            {!state.run && !state.report && !state.pendingAdmission ? (
              <EmptyHome
                title="Ask anything."
                examples={["should I move to Texas", "best laptop under 2k", "research this company"]}
                onPick={(example) => setState((s) => ({ ...s, draft: example }))}
                styles={styles}
              />
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
                showJumpToLatest={activity.inProgress && !state.report && !followLiveActivity}
                onJumpToLatest={() => {
                  followLiveRef.current = true;
                  setFollowLiveActivity(true);
                  conversationScroll.current?.scrollToEnd({ animated: !latestUi.current.reducedMotion });
                }}
                onToggle={() => setActivityExpanded((value) => !value)}
                pendingInputType={state.run?.pendingInput?.type}
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
            {queryApprovalPending ? (
              <View style={styles.card} accessibilityLabel="Public search approval">
                <Text style={styles.kicker}>Approve public search</Text>
                <Text style={styles.bodyText}>This research includes a private document. Approve the exact search terms before the app queries the public web.</Text>
                {state.run?.pendingQueryAuthorization ? (
                  <>
                    <Text style={styles.kicker}>{state.run.pendingQueryAuthorization.proposedQuery}</Text>
                    {state.run.pendingQueryAuthorization.terms.map((term) => (
                      <Text key={term} style={styles.bodyText}>{term}</Text>
                    ))}
                    <Pressable
                      onPress={() => {
                        const pending = latestUi.current.run?.pendingQueryAuthorization;
                        if (!token || !state.run || !pending) {
                          setViewState((s) => ({ ...s, error: "Exact search terms are not available. Public search will not continue." }));
                          return;
                        }
                        let body;
                        try {
                          body = queryAuthorizationApproveBody(pending);
                        } catch (error) {
                          setViewState((s) => ({ ...s, error: error instanceof Error ? error.message : "Exact search terms are not available. Public search will not continue." }));
                          return;
                        }
                        void api.approveQuery(token, state.run.runId, body).then(() => refreshRun(token, state.run!.runId)).then(() => {
                          if (token && latestUi.current.run && !queryAuthorizationPending(latestUi.current.run)) {
                            startPolling(token, latestUi.current.run.runId);
                          }
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
                  </>
                ) : (
                  <Text style={styles.bodyText}>Exact search terms are not available. Public search will not continue.</Text>
                )}
              </View>
            ) : null}

            <ResearchBriefCard
              view={briefView}
              clarifyAnswer={clarifyAnswer}
              muted={theme.muted}
              field={state.run?.pendingInput?.field}
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
                <ReportSections
                  blocks={blocks}
                  detailed={detailed}
                  showOutline={detailed}
                  reducedMotion={state.reducedMotion}
                  styles={styles}
                  citationIndex={citeIndex}
                  onJump={(blockId) => {
                    const y = reading.current.jumpY(readerView, blockId);
                    if (y == null) return;
                    conversationScroll.current?.scrollTo({ y, animated: !latestUi.current.reducedMotion });
                  }}
                  onOpenSource={(id, blockId) => {
                    const block = blocks.find((item) => item.id === blockId);
                    const claimIds = claimsForReportBlock(blocks, blockId);
                    const claimTexts = (state.report?.claims ?? []).filter((claim) => claimIds.includes(claim.id));
                    setSourceClaim(blockId ? {
                      blockId,
                      claimIds,
                      selectedClaimId: pickUniqueClaimId(claimIds),
                      text: claimTexts[0]?.text ?? block?.text.slice(0, 180) ?? "",
                      claimTexts,
                    } : null);
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
                {visibleFollowUpExplains(state.followUpExplains, {
                  accountId,
                  runId: state.run?.runId,
                  reportId: state.report?.reportId ?? null,
                }).map((shown, index) => (
                  <View key={`${shown.runId}:${shown.question}:${index}`} accessibilityLabel="Follow-up explanation">
                    <Text style={styles.kicker}>You asked</Text>
                    <Text style={styles.bodyText}>{shown.question}</Text>
                    <Text style={styles.answerText}>{shown.answer}</Text>
                    {shown.citationPassageIds.length ? (
                      <View>
                        {shown.citationPassageIds.map((passageId) => {
                          const n = citeIndex[passageId];
                          const blockId = blocks.find((block) => block.citationIds.includes(passageId))?.id;
                          return (
                            <Pressable
                              key={passageId}
                              onPress={() => {
                                if (!blockId) {
                                  setViewState((s) => ({ ...s, error: "That citation is not available in this report." }));
                                  return;
                                }
                                const block = blocks.find((item) => item.id === blockId);
                                const claimIds = claimsForReportBlock(blocks, blockId);
                                const claimTexts = (state.report?.claims ?? []).filter((claim) => claimIds.includes(claim.id));
                                setSourceClaim({
                                  blockId,
                                  claimIds,
                                  selectedClaimId: pickUniqueClaimId(claimIds),
                                  text: claimTexts[0]?.text ?? block?.text.slice(0, 180) ?? "",
                                  claimTexts,
                                });
                                void onOpenSource(passageId, blockId);
                              }}
                              accessibilityRole="button"
                              accessibilityLabel={n ? `Open citation ${n}` : blockId ? "Open cited passage" : "Cited passage unavailable"}
                              hitSlop={12}
                            >
                              <Text style={styles.link}>{blockId ? (n ? `[${n}]` : "Cited passage") : "Citation unavailable"}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                    {shown.evidenceComplete ? null : (
                      <Text style={styles.caveat}>This report does not fully establish that. You can start deeper research.</Text>
                    )}
                  </View>
                ))}
                <ReportActions
                  labeledDemo={state.report.labeledDemo === true}
                  showVerification={showVerification}
                  verificationNote={verificationNote}
                  verificationBusy={verificationBusy}
                  pendingVerification={!!state.pendingVerification}
                  verificationPolicy={verificationPolicy}
                  flagSent={!!state.flagSent}
                  flagStatus={flagStatus}
                  flagOpen={flagOpen}
                  flagCategory={flagCategory}
                  flagNote={flagNote}
                  flagInclude={flagInclude}
                  styles={styles}
                  onShare={() => onShare()}
                  onToggleVerification={() => setShowVerification((open) => !open)}
                  onVerificationNote={setVerificationNote}
                  onTogglePolicy={() => setVerificationPolicy((p) => p === "reuse_snapshot" ? "refresh_sources" : "reuse_snapshot")}
                  onSubmitVerification={() => {
                    const claimId = sourceClaim?.selectedClaimId ?? uniqueAnswerClaimId(state.report?.blocks);
                    if (!claimId) {
                      setViewState((s) => ({ ...s, error: "Open the citation for the conclusion you want verified." }));
                      return;
                    }
                    void onFollowUp(claimId);
                  }}
                  onToggleFlag={() => { setFlagClaimId(null); setFlagOpen(true); }}
                  onFlagCategory={setFlagCategory}
                  onFlagNote={setFlagNote}
                  onToggleFlagInclude={() => setFlagInclude((v) => !v)}
                  onSubmitFlag={async () => {
                    if (!token || !state.report) return;
                    setFlagStatus("submitting");
                    try {
                      await api.challenge(token, state.report.reportId, {
                        ...(flagClaimId ? { claimId: flagClaimId } : {}),
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
                />
              </View>
            ) : null}
            {staleCorrection && state.run && !state.run.contentInvalidated ? (
              <CorrectionPanel
                staleCorrection={staleCorrection}
                savedBaseRevision={savedCorrection?.baseRevision}
                originalQuestion={state.run?.brief?.originalQuestion}
                correctionMode={correctionMode}
                showCorrectionOptions={showCorrectionOptions}
                pendingCorrectionDocuments={!!state.pendingCorrectionDocuments}
                correctionFiles={correctionFiles}
                documentPending={documentPending}
                correctionPending={correctionPending}
                correctionReady={correctionReady}
                correctionReserveMicro={state.run.correctionReserveMicro}
                composerContinues={composerContinues}
                correction={correction}
                evidencePolicy={evidencePolicy}
                verificationBusy={verificationBusy}
                pendingVerification={!!state.pendingVerification}
                muted={theme.muted}
                styles={styles}
                onRebase={() => {
                  const runId = state.run?.runId, revision = state.run?.brief?.revision;
                  if (token && runId && revision && api.currentRun(token, runId)) setViewState(s => rebaseCorrectionDraft(s, runId, revision));
                }}
                onToggleOptions={() => setShowCorrectionOptions((value) => !value)}
                onRemoveFile={(index) => setCorrectionFiles((files) => files.filter((_, i) => i !== index))}
                onPickDocument={() => void pickCorrectionDocument()}
                onAddDocuments={() => void addCorrectionDocuments()}
                onUseCurrentQuestion={() => {
                  const question = state.run?.brief?.originalQuestion ?? "";
                  setCorrection(question);
                  setState((s) => ({ ...s, draft: question }));
                }}
                onEvidencePolicy={setEvidencePolicy}
                onChangeCorrection={setCorrection}
                onSubmit={() => void onCorrect()}
              />
            ) : null}
          </ScrollView>
        ) : null}

        {state.source ? (
          <SourceSheet key={JSON.stringify([token, state.report?.reportId, state.source.passageId])} source={state.source} styles={styles}
            reducedMotion={state.reducedMotion} ink={theme.ink}
            canFocus={() => Boolean(token && state.run && api.currentRun(token, state.run.runId) && latestUi.current.tab === "research" && latestUi.current.source?.passageId === state.source?.passageId && latestUi.current.report?.reportId === state.report?.reportId)}
            onDelete={target => void onDeleteSource(target)} deletionPending={sourceDeleteBusy}
            offline={state.offline} admissionPending={!!state.pendingAdmission || !!state.pendingVerification || !!state.pendingCorrectionDocuments || correctionPending}
            relatedClaim={sourceClaim?.text ?? null}
            claimChoices={sourceClaim && sourceClaim.claimIds.length > 1
              ? sourceClaim.claimIds.map((id) => ({
                id,
                text: sourceClaim.claimTexts.find((claim) => claim.id === id)?.text
                  ?? state.report?.claims?.find((claim) => claim.id === id)?.text
                  ?? "Claim text is unavailable for this conclusion.",
              }))
              : []}
            selectedClaimId={sourceClaim?.selectedClaimId ?? null}
            onSelectClaim={(claimId) => setSourceClaim((current) => current ? { ...current, selectedClaimId: claimId } : current)}
            onChallenge={() => {
              const claimId = sourceClaim?.selectedClaimId;
              if (!claimId) {
                setViewState((s) => ({ ...s, error: "Choose which conclusion to challenge." }));
                return;
              }
              setFlagClaimId(claimId);
              api.closeSource();
              setState(s => ({ ...s, source: null }));
              setFlagOpen(true);
            }}
            onVerify={() => {
              const claimId = sourceClaim?.selectedClaimId;
              if (!claimId) {
                setViewState((s) => ({ ...s, error: "Choose which conclusion to verify." }));
                return;
              }
              api.closeSource();
              setState(s => ({ ...s, source: null }));
              void onFollowUp(claimId);
            }}
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
            ink={theme.muted}
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
            onAttachUrl={(file) => setState((s) => attachFile(s, file))}
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
                    replaceQuestion: false,
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
        {state.tab === "research" && !state.source && state.run?.lifecycle !== "awaiting_input" && !queryApprovalPending ? (
        <ResearchComposer
          draft={state.draft}
          muted={theme.composer.placeholder}
          sendInk={theme.composer.sendInk}
          editable={hydrated && !verificationBusy && !sourceDeleteBusy && uploadStatus === null && !correctionPending && state.run?.lifecycle !== "awaiting_input"}
          sendDisabled={!hydrated || documentPending || uploadStatus !== null || sourceDeleteBusy || !!state.pendingSourceDeletion || correctionPending || verificationBusy || state.offline || state.run?.lifecycle === "awaiting_input"}
          pendingAdmission={!!state.pendingAdmission}
          placeholder={composerPlaceholder({ inProgress: activity.inProgress && state.run?.lifecycle !== "awaiting_input", continues: composerContinues })}
          sendAccessLabel={composerContinues ? "Send follow-up" : "Start research"}
          attachOpen={attachVisible}
          inProgress={activity.inProgress && state.run?.lifecycle !== "awaiting_input"}
          reducedMotion={state.reducedMotion}
          onChange={(draft) => setState((s) => ({ ...s, draft }))}
          onSend={() => {
            const files = latestUi.current.attachments;
            if (composerContinues && files.length) {
              if (!correctionReady) {
                setViewState((s) => ({ ...s, error: "Adding documents is not available on this research route." }));
                return;
              }
              setCorrectionFiles(files);
              void addCorrectionDocuments(files);
            } else if (composerContinues || (activity.inProgress && state.run?.lifecycle !== "awaiting_input")) {
              void onComposerFollowUp(latestUi.current.draft);
            } else void onSend();
          }}
          onAttach={() => setShowAttach((open) => !open)}
          onCancel={() => void onCancel()}
          styles={{
            ...styles,
            composerDock: [styles.composerDock, { paddingBottom: composerDockBottomInset({
              keyboardOpen,
              keyboardHeight: keyboardInset,
              safeBottom: insets.bottom,
              platform: Platform.OS,
            }) }],
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
