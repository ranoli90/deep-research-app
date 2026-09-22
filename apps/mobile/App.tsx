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
import { activeCorrectionDraft, editCorrectionDraft, rebaseCorrectionDraft, runPendingCorrection, unresolvedCorrection } from "./src/correction-draft";
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
import { continueRunRequest, runAssumptionsMutation, unresolvedAssumptions } from "./src/pending-input";
import { queryAuthorizationApproveBody, queryAuthorizationPending } from "./src/query-authorization";
import { humanChangeSummary } from "./src/correction-copy";
import { citationNumbers } from "./src/citation-chips";
import { draftFromFollowUp, followUpSuggestions, routeFollowUp } from "./src/follow-ups";
import { bindFollowUpExplain, recordFollowUpExplain, visibleFollowUpExplains } from "./src/follow-up-explain";
import { adoptReturnedChild, persistOwnedJournalSnapshot, revokeConsentWithinAccount, type ViewHandle } from "./src/constraint-delta";
import { runMutatingFollowUp, unresolvedFollowUp, type MutatingFollowUpKind } from "./src/follow-up-admission";
import { clearDocumentPickerCache, pickDocument } from "./src/native-documents";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getRandomBytes } from "expo-crypto";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { useClerkGuestAuth, type ClerkGuestAuth } from "./src/auth/clerk-guest-auth";
import { GuestSignInSheet, type GuestSignInTransport } from "./src/auth/GuestSignInSheet";
import { ClerkSessionTaskView } from "./src/auth/ClerkSessionTaskView";
import { initialGuestSignInSheetState, reduceGuestSignInSheet, type GuestSignInSheetEvent, type GuestSignInSheetState, type GuestProviderAvailability } from "./src/auth/guest-sign-in-sheet-state";
import { beginGuestActionResume, beginGuestAuth, beginGuestClaim, cancelGuestAuthAttempt, cancelGuestPendingAction, completeGuestAuth, completeGuestClaim, confirmMemberClarificationRegistration, createGuestPendingAction, dismissGuestPendingAction, holdGuestAuthAttempt, holdGuestClaimForReconciliation, holdGuestResumeForConsent, holdGuestResumeForReconciliation, markGuestActionDispatched, prepareMemberClarificationReplacement, readGuestPendingAction, reopenGuestPendingAction, validateGuestActionResume, type GuestPendingAction, type GuestPendingActionPayload } from "./src/auth/guest-pending-action";
import { readGuestContext, type GuestContext, type GuestFirstRequest } from "./src/auth/guest-device";
import { sha256Hex } from "./src/sha256";
import {
  AccessibilityInfo,
  findNodeHandle,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { color, space } from "@deep/design";
import { makeStyles } from "./src/product-styles";
import { guestDevice, sessionStorage } from "./src/native-session";
import { SupersededRequest } from "./src/request-scope";
import { DEFAULT_RUN_BUDGET_MICRO, OUTPUT_REPORT_CATEGORIES } from "@deep/contracts";
import { api, ApiError, deletionPageUrl, isExpiredSession, isOfflineError, isSupersededRequest } from "./src/api";
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
  mergeConsent,
  mergeEvents,
  openLibraryItem,
  submitPrerequisite,
  withConsent,
  type ReportBlock,
  type UiState,
} from "./src/state";

/** Hermes/Expo Go has no global crypto.randomUUID. */
function newId(): string {
  const bytes = getRandomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function useTheme(preference: AppearancePreference) {
  const system = useColorScheme();
  return color[resolveAppearance(preference, system)];
}

export function AppInner({ auth }: { auth: ClerkGuestAuth | null }) {
  const authRef = useRef(auth); authRef.current = auth;
  const [appearance, setAppearance] = useState<AppearancePreference>("system");
  const system = useColorScheme();
  const theme = useTheme(appearance);
  const insets = useSafeAreaInsets();
  const [state, setStateRaw] = useState<UiState>(emptyState());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [guestContext, setGuestContext] = useState<GuestContext | null>(null);
  const guestContextRef = useRef<GuestContext | null>(null);
  const guestProof = useRef<string | null>(null);
  const [guestPending, setGuestPending] = useState<GuestPendingAction | null>(null);
  const guestPendingRef = useRef<GuestPendingAction | null>(null);
  const abandonedGuestActions = useRef<GuestPendingAction[]>([]);
  const guestFirstRequest = useRef<GuestFirstRequest | null>(null);
  const guestDraftRevision = useRef(0);
  const taskContinuationAttempt = useRef<string | null>(null);
  const [taskContinuationId, setTaskContinuationId] = useState<string | null>(null);
  const taskViewClosing = useRef(false);
  const [guestSheetVisible, setGuestSheetVisible] = useState(false);
  const [guestSheetState, setGuestSheetState] = useState<GuestSignInSheetState>(initialGuestSignInSheetState);
  // Direct member login owns the same provider chooser but no guest journal:
  // signed out with no pending action, the sheet collects a real provider
  // session and restores the member reader. Claim-and-resume stays distinct.
  const [directLogin, setDirectLogin] = useState(false);
  const directLoginRef = useRef(false);
  const [guestCapabilities, setGuestCapabilities] = useState<{ apple: boolean; google: boolean; emailCode: boolean; termsUrl: string | null; privacyUrl: string | null }>({ apple: false, google: false, emailCode: false, termsUrl: null, privacyUrl: null });
  const composerInput = useRef<TextInput>(null);
  const guestRefreshing = useRef(false);
  const guestRunEpoch = useRef(0);
  const latestUi = useRef(state);
  // Every committed render field follows the newest render so draft/tab edits
  // are never lost. Consent is versioned: a render echo of a pre-decision
  // frame carries the same (lower) revision and must never roll the ref below
  // a confirmed consent decision, so an echo can never resurrect consent.
  latestUi.current = state.consentRevision >= latestUi.current.consentRevision
    ? state
    : { ...state, consentGranted: latestUi.current.consentGranted, consentRevision: latestUi.current.consentRevision };
  const mutationJournalWrite = useRef<Promise<void>>(Promise.resolve());
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
  type MutationJournalField = "pendingFollowUp" | "pendingAssumptions" | "pendingCorrection";
  async function persistMutationJournal<K extends MutationJournalField>(
    t: string,
    guard: ViewHandle,
    field: K,
    saved: UiState[K],
    parentRunId: string,
  ) {
    if (!guard.current()) throw new SupersededRequest();
    const credential = memberAuthority();
    const acceptedRunId = saved && typeof saved === "object" && "acceptedRunId" in saved
      ? saved.acceptedRunId
      : undefined;
    const stillOwned = () => {
      try {
        const bearer = credential();
        return api.currentRun(bearer, parentRunId)
          || (typeof acceptedRunId === "string" && api.currentRun(bearer, acceptedRunId));
      } catch { return false; }
    };
    const operation = persistOwnedJournalSnapshot({
      field,
      saved,
      currentState: () => latestUi.current,
      persist: (next) => sessionStorage.persistRequired(credential(), next),
      current: () => guard.current(),
      stillOwned,
      synchronize: (next) => {
        latestUi.current = next;
        // Keep React's queued state from later replacing the authoritative
        // durable phase. Consent revocation intentionally keeps the journal
        // while invalidating only the operation's view lease.
        setStateRaw((previous) => stillOwned()
          ? { ...previous, [field]: saved }
          : previous);
      },
      render: (journal) => setViewState((s) => ({ ...s, [field]: journal })),
    });
    mutationJournalWrite.current = operation.then(() => undefined, () => undefined);
    await operation;
  }
  const [token, setToken] = useState<string | null>(null);
  // Assign only at verified session transitions. A render queued before a
  // credential rotation must not roll these refs back to its stale token.
  const memberTokenRef = useRef<string | null>(token);
  const memberAccountRef = useRef<string | null>(accountId);
  const activeClerkSubjectRef = useRef<string | null>(null);
  const credentialRefresh = useRef<Promise<string> | null>(null);
  /** A member operation may outlive a routine Clerk bearer rotation, never a principal change. */
  function memberAuthority(expectedAccount = memberAccountRef.current): () => string {
    const principalEpoch = api.sessionEpochs().principalEpoch;
    if (!expectedAccount || memberAccountRef.current !== expectedAccount || !memberTokenRef.current) throw new SupersededRequest();
    return () => {
      const current = memberTokenRef.current;
      if (!current || memberAccountRef.current !== expectedAccount || api.sessionEpochs().principalEpoch !== principalEpoch || api.currentCredential() !== current) throw new SupersededRequest();
      return current;
    };
  }
  // A Clerk account switch is a principal boundary even before the next API
  // request. Hide the old reader synchronously; retain no callback authority.
  useLayoutEffect(() => {
    const boundSubject = activeClerkSubjectRef.current;
    if (!boundSubject || !memberAccountRef.current || !auth?.loaded) return;
    if (auth.signedIn && auth.subject === boundSubject) return;
    stopPolling(); api.activateSession(null); api.clearGuest();
    activeClerkSubjectRef.current = null;
    memberTokenRef.current = null; memberAccountRef.current = null;
    guestContextRef.current = null; guestProof.current = null; guestPendingRef.current = null;
    const hidden = emptyState(); latestUi.current = hidden;
    setToken(null); setAccountId(null); setGuestContext(null); setGuestPending(null); setGuestSheetVisible(false);
    directLoginRef.current = false; setDirectLogin(false);
    setStorageReady(false); setStateRaw({ ...hidden, error: "Account changed. Reopen the app to restore the current account safely." });
    void clearAccountLocal(sessionStorage).then(() => setStorageReady(true)).catch(() => {
      setStateRaw(s => ({ ...s, error: "Account changed. Device cleanup failed; retry sign-out before continuing." }));
    });
  }, [auth?.loaded, auth?.signedIn, auth?.subject]);
  useEffect(() => {
    api.setMemberCredentialProvider(async (expected, forceRefresh = false) => {
      const previous = memberTokenRef.current, owner = memberAccountRef.current;
      if (!previous || !owner || expected !== previous) throw new SupersededRequest();
      if (credentialRefresh.current) return credentialRefresh.current;
      const work = (async () => {
        const fresh = await authRef.current?.getToken(forceRefresh ? { skipCache: true } : undefined);
        if (!fresh) throw new ApiError(0, "Sign-in cannot be refreshed. Your saved research remains on this device.");
        if (fresh === previous) return previous;
        const verified = await api.verifyMemberSession(fresh);
        if (verified.accountId !== owner || memberTokenRef.current !== previous || memberAccountRef.current !== owner) throw new SupersededRequest();
        await sessionStorage.rotateCredential(previous, { token: fresh, accountId: owner });
        if (memberTokenRef.current !== previous || memberAccountRef.current !== owner) throw new SupersededRequest();
        api.rotateCredential(fresh, owner);
        memberTokenRef.current = fresh; setToken(fresh);
        return fresh;
      })();
      credentialRefresh.current = work;
      try { return await work; }
      finally { if (credentialRefresh.current === work) credentialRefresh.current = null; }
    });
    return () => api.setMemberCredentialProvider(null);
  }, []);
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
  // The selection is bound to the stable member account, never the rotating
  // bearer: a same-account refresh keeps selected files, an account change
  // drops them fail-closed.
  const correctionFiles = correctionFilesFor(correctionSelection, accountId, correctionParent);
  function setCorrectionFiles(update: UiState["attachments"] | ((files: UiState["attachments"]) => UiState["attachments"])) {
    setCorrectionSelection(previous => ({ owner: accountId, parent: correctionParent,
      files: typeof update === "function" ? update(previous.owner === accountId && previous.parent === correctionParent ? previous.files : []) : update }));
  }
  useEffect(() => { setCorrectionFiles([]); }, [accountId, state.run?.runId, state.pendingSourceDeletion]);
  const [correctionPending,setCorrectionPending]=useState(false);
  const correctionAttempt=useRef<symbol|null>(null);
  const correctionMode=state.run?.labeledDemo&&state.run?.correctionMode==="legacy"?"legacy":!state.run?.labeledDemo&&state.run?.correctionMode==="replace_question"?"replace_question":"unavailable";
  const correctionReady=!state.run?.contentInvalidated&&!staleCorrection&&correctionMode!=="unavailable"&&Boolean(state.run?.brief?.revision)&&(correctionMode==="legacy"||(Number.isSafeInteger(state.run?.correctionReserveMicro)&&state.run!.correctionReserveMicro!>=0));
  useEffect(()=>{correctionAttempt.current=null;setCorrectionPending(false);},[accountId,state.run?.runId]);
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
  // Reader identity is the stable principal (guest context or member
  // account), never the rotating bearer string: a same-account credential
  // refresh retains reading position and focus; only a true principal change
  // starts a new reader generation.
  const readerOwner = guestContext?.guestContextId ?? accountId ?? null;
  const readerKey = JSON.stringify([readerOwner, readerVisible, state.report?.reportId, detailed, blocks.map(b => b.id)]);
  if (readerIdentity.current !== readerKey) {
    readerIdentity.current = readerKey;
    scrollY.current = 0;
    if (readerVisible && readerOwner && state.report) {
      readerGeneration.current = reading.current.begin({ ownerKey: readerOwner, reportId: state.report.reportId }, state.readingAnchor, blocks.map(b => b.id), state.report.blocks.map(b => b.id));
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
  const focusGeneration = sourceFocus.current.view(readerOwner ?? "", state.report?.reportId ?? "", JSON.stringify([readerView, state.tab, state.source?.passageId]));
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
    if (guestContextRef.current && !token) {
      const contextId = guestContextRef.current.guestContextId;
      void guestDevice.saveSnapshot(contextId, state, guestDraftRevision.current).catch(() => {
        setStateRaw(s => s.error === "Could not save guest research on this device." ? s : { ...s, error: "Could not save guest research on this device." });
      });
      return;
    }
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

  function currentGuest(): { context: GuestContext; proof: string } {
    const context = guestContextRef.current, proof = guestProof.current;
    if (!context || !proof || token) throw new Error("Guest conversation is not current.");
    if (Date.parse(context.expiresAt) <= Date.now()) throw new Error("This guest conversation expired. Its saved message has not been sent.");
    return { context, proof };
  }

  async function saveGuestPending(next: GuestPendingAction, expected: GuestPendingAction | null = guestPendingRef.current) {
    const checked = readGuestPendingAction(next);
    await guestDevice.savePendingAction(checked, expected);
    guestPendingRef.current = checked; setGuestPending(checked);
  }

  /** Only an exact server abandonment makes a different submission ID admissible. */
  async function abandonSavedGuestAction(action: GuestPendingAction, memberToken: string | null = token): Promise<GuestPendingAction> {
    const current = guestPendingRef.current;
    if (!current || current.submissionId !== action.submissionId) throw new Error("The saved message changed before cancellation.");
    let receipt: any;
    if (["claimed", "member_register_pending", "member_claimed", "resume_pending", "resume_reconcile"].includes(current.phase) || !guestProof.current) {
      if (!memberToken || !current.claim) throw new Error("The accepted claim cannot be abandoned until its identity is confirmed.");
      const credential = memberAuthority(current.authenticatedAccountId);
      receipt = await api.abandonClaimedGuestAction(credential!(), current.submissionId, current.claim.requestId);
      if (receipt?.type !== "action_abandoned" || receipt.submissionId !== current.submissionId || receipt.claimRequestId !== current.claim.requestId) throw new Error("The claim abandonment receipt did not match the saved message.");
    } else {
      try { receipt = await api.guest.cancelPendingAction(guestProof.current, current.submissionId); }
      catch (error) {
        // A simultaneous claim can win the server race and revoke guest proof.
        // Only a verified member readback may then authorize member abandon.
        if (!memberToken || !current.claim) throw error;
        const credential = memberAuthority(current.authenticatedAccountId);
        const resolved = await api.resolveGuestClaim(credential!(), current.claim.requestId, current.submissionId);
        if (resolved?.type === "action_abandoned" && resolved.submissionId === current.submissionId && resolved.claimRequestId === current.claim.requestId) receipt = resolved;
        else if (resolved?.type === "claim_accepted") {
          const latest = guestPendingRef.current;
          if (!latest || latest.submissionId !== current.submissionId || latest.claim?.requestId !== current.claim.requestId) throw new Error("Claim identity changed before abandonment.");
          if (["claim_pending", "claim_reconcile"].includes(latest.phase)) {
            const epochs = api.sessionEpochs();
            await saveGuestPending(completeGuestClaim(latest, { ...resolved, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch }, new Date()), latest);
          }
          receipt = await api.abandonClaimedGuestAction(credential!(), current.submissionId, current.claim.requestId);
        } else throw error;
      }
      if (receipt?.type !== "action_abandoned" || receipt.submissionId !== current.submissionId || (receipt.claimRequestId && receipt.claimRequestId !== current.claim?.requestId)) throw new Error("The cancellation receipt did not match the saved message.");
    }
    const latest = guestPendingRef.current;
    if (!latest || latest.submissionId !== current.submissionId || latest.phase === "dispatched") throw new Error("The saved message changed while cancellation was being confirmed.");
    const cancelled = cancelGuestPendingAction(latest, new Date());
    if (cancelled.phase !== "cancelled") throw new Error("The expired saved message needs reconciliation before another can be sent.");
    await saveGuestPending(cancelled, latest);
    setGuestSheetVisible(false);
    return cancelled;
  }

  async function saveGuestReader(next: UiState) {
    const { context } = currentGuest();
    const draftAtEntry = latestUi.current.draft;
    const navAtEntry = { tab: latestUi.current.tab, source: latestUi.current.source, routeMode: latestUi.current.routeMode };
    const runAtEntry = { runId: latestUi.current.run?.runId ?? null, lifecycle: latestUi.current.run?.lifecycle ?? null };
    await guestDevice.saveSnapshot(context.guestContextId, next, guestDraftRevision.current);
    // Whole-update boundary: text typed during the durable write survives.
    // An unchanged reader publishes the accepted frame as-is; a newer draft
    // merges into it. A principal/view switch, cancellation, or revocation
    // that landed meanwhile fail closed: the stale frame is never published.
    if (guestContextRef.current?.guestContextId !== context.guestContextId || memberTokenRef.current) return;
    const latest = latestUi.current;
    // R05: navigation and run lifecycle are owned by the newest local event,
    // not by a snapshot write that began earlier. A Library navigation or a
    // local cancellation/terminal transition that lands mid-write must not be
    // overwritten by the older research/running frame. Run *content* from an
    // accepted refresh still applies when the run identity/lifecycle is unchanged.
    const runChanged = (latest.run?.runId ?? null) !== runAtEntry.runId || (latest.run?.lifecycle ?? null) !== runAtEntry.lifecycle;
    // Consent follows a version boundary, not a value comparison: a render
    // echo of the pre-grant frame carries the same (lower) revision and can
    // never regress a confirmed grant. A higher-revision revocation still wins.
    const merged = {
      ...next,
      draft: latest.draft !== draftAtEntry ? latest.draft : next.draft,
      ...mergeConsent(next, latest),
      ...(latest.tab !== navAtEntry.tab ? { tab: latest.tab } : {}),
      ...(latest.source !== navAtEntry.source ? { source: latest.source } : {}),
      ...(latest.routeMode !== navAtEntry.routeMode ? { routeMode: latest.routeMode } : {}),
      ...(runChanged ? { run: latest.run, status: latest.status } : {}),
    };
    latestUi.current = merged;
    setStateRaw(merged);
    // R05: if navigation or run lifecycle changed while the durable write was
    // open, the stale frame must not be what a restart restores. The ownership
    // guard above already passed, so this correction cannot resurrect a deleted
    // or account-switched conversation.
    if (merged.tab !== next.tab || merged.source !== next.source || merged.routeMode !== next.routeMode ||
        (merged.run?.runId ?? null) !== (next.run?.runId ?? null) ||
        (merged.run?.lifecycle ?? null) !== (next.run?.lifecycle ?? null)) {
      try { await guestDevice.saveSnapshot(context.guestContextId, merged, guestDraftRevision.current); }
      catch { /* the in-memory ownership boundary already published; a later autosave retries */ }
    }
  }

  async function refreshGuestRun(runId: string) {
    if (guestRefreshing.current) return;
    const { context, proof } = currentGuest();
    const epoch = guestRunEpoch.current;
    if (latestUi.current.run?.runId !== runId) return;
    guestRefreshing.current = true;
    try {
      const snap = await api.guest.getRun(proof, runId);
      if (guestRunEpoch.current !== epoch || guestContextRef.current?.guestContextId !== context.guestContextId || snap?.runId !== runId) throw new SupersededRequest();
      if (snap.contentInvalidated === true) {
        const redacted = redactInvalidatedContent({ ...latestUi.current, run: snap }, runId);
        await saveGuestReader(redacted);
        stopPolling();
        return;
      }
      const events = adoptPublicEvents((await api.guest.events(proof, runId, 0)).events);
      const report = snap.reportId ? await api.guest.report(proof, snap.reportId) : null;
      if (guestRunEpoch.current !== epoch || guestContextRef.current?.guestContextId !== context.guestContextId || latestUi.current.run?.runId !== runId) throw new SupersededRequest();
      let next = applySnapshot(latestUi.current, snap);
      next = { ...next, signedIn: false, events: mergeEvents(latestUi.current.events, events), offline: false };
      if (report) next = { ...next, report: {
        reportId: report.reportId, version: report.version, blocks: report.blocks,
        claims: Array.isArray(report.claims) ? report.claims.filter((row: { id?: unknown; text?: unknown }) => typeof row?.id === "string" && typeof row?.text === "string") : undefined,
        limitations: report.limitations ?? [], labeledDemo: false, changeSummary: report.changeSummary ?? null,
      } };
      await saveGuestReader(next);
    } catch (error) {
      if (error instanceof SupersededRequest) return;
      if (isOfflineError(error)) setStateRaw(s => ({ ...s, offline: true, error: "Offline. Your saved research and message remain on this device." }));
      else setStateRaw(s => ({ ...s, error: "Could not refresh guest research. Its saved content remains on this device." }));
    } finally { guestRefreshing.current = false; }
  }

  function startGuestPolling(runId: string) {
    stopPolling();
    poll.current = setInterval(() => { void refreshGuestRun(runId); }, 1000);
  }

  async function ensureGuestContext(): Promise<{ context: GuestContext; proof: string }> {
    if (guestContextRef.current && guestProof.current) return currentGuest();
    const response = await api.guest.bootstrap();
    const context = readGuestContext({
      guestContextId: response.guestContextId, conversationId: response.conversationId,
      conversationVersion: response.conversationVersion, controlVersion: 0, acceptedTurnCount: 0,
      expiresAt: response.expiresAt, consentPolicyVersion: response.consentPolicyVersion, consentGranted: false,
    });
    await guestDevice.saveBootstrap(context, response.proof);
    api.activateGuest(response.proof, context.guestContextId);
    guestContextRef.current = context; guestProof.current = response.proof; setGuestContext(context);
    return { context, proof: response.proof };
  }

  async function onGuestFirstSend() {
    if (!hydrated || !storageReady || submitting.current) return;
    submitting.current = true;
    try {
      const { context, proof } = await ensureGuestContext();
      const current = latestUi.current;
      if (current.attachments.length || current.pendingAdmission || current.pendingSourceDeletion || current.pendingContentInvalidation) throw new Error("Guest research accepts a question or public URL only. Sign in before adding documents.");
      if (!context.consentGranted || !current.consentGranted) {
        setStateRaw(s => ({ ...s, tab: "settings", error: "Allow AI processing before starting this guest research." }));
        return;
      }
      const question = current.draft.trim();
      if (!question || question.length > 20_000) throw new Error("Enter a question or public URL to research.");
      if (context.acceptedTurnCount !== 0 || current.run) throw new Error("This guest already started research. Sign in to send the next message.");
      let saved = guestFirstRequest.current;
      if (!saved) {
        saved = { id: newId(), guestContextId: context.guestContextId, question, digest: sha256Hex(question), phase: "prepared", runId: null };
        await guestDevice.saveFirstRequest(saved); guestFirstRequest.current = saved;
      }
      if (saved.question !== question) throw new Error("A different first request is already saved. Restore it before starting another.");
      let created;
      if (saved.phase !== "prepared") {
        const resolved = await api.guest.resolveRun(proof, saved.id);
        if (resolved.status === "accepted") created = readAdmittedRun(resolved.run);
        else if (resolved.status !== "not_found") throw new Error("The first request may already be running. Check it again; do not resend.");
      }
      if (!created) {
        saved = { ...saved, phase: "uncertain" };
        await guestDevice.saveFirstRequest(saved); guestFirstRequest.current = saved;
        created = readAdmittedRun(await api.guest.createRun(proof, question, saved.id, context.conversationId));
      }
      if (!created?.runId) throw new Error("The first run identity was not confirmed. Check the saved request.");
      saved = { ...saved, phase: "accepted", runId: created.runId };
      await guestDevice.saveFirstRequest(saved); guestFirstRequest.current = saved;
      const server = await api.guest.sessionInfo(proof);
      const updated = readGuestContext({ ...context, controlVersion: server.controlVersion, acceptedTurnCount: server.acceptedTurnCount, consentGranted: server.consentGranted, conversationVersion: server.conversationVersion });
      await guestDevice.updateContext(updated); guestContextRef.current = updated; setGuestContext(updated);
      guestRunEpoch.current++;
      // Merge the accepted run into the latest still-owned reader. Text typed
      // while A was awaiting (B) survives; only an unchanged A clears.
      const latest = latestUi.current;
      if (guestContextRef.current?.guestContextId !== context.guestContextId) throw new Error("The guest conversation changed while research was starting. Check it again; nothing was sent again.");
      const next: UiState = { ...latest, draft: latest.draft.trim() === question ? "" : latest.draft, routeMode: "controlled-research", status: "progress", error: null, tab: "research", events: [], report: null,
        run: { runId: created.runId, lifecycle: created.lifecycle, phase: created.phase, outcome: null, reportId: null, labeledDemo: false } };
      await saveGuestReader(next);
      void refreshGuestRun(created.runId); startGuestPolling(created.runId);
    } catch (error) {
      setStateRaw(s => ({ ...s, error: error instanceof Error ? error.message : "Could not start guest research. Your question is saved." }));
    } finally { submitting.current = false; }
  }

  async function captureGuestSecondAction(payload: GuestPendingActionPayload) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const { context: savedContext, proof } = currentGuest();
      const server = await api.guest.sessionInfo(proof);
      let context = readGuestContext({ ...savedContext, controlVersion: server.controlVersion, acceptedTurnCount: server.acceptedTurnCount, consentGranted: server.consentGranted, conversationVersion: server.conversationVersion });
      await guestDevice.updateContext(context); guestContextRef.current = context; setGuestContext(context);
      if (!context.consentGranted && latestUi.current.consentGranted) {
        const revoked = { ...withConsent(latestUi.current, false), error: "AI processing consent was revoked. Your draft and report remain saved." };
        // Mirror the confirmed server revocation (higher revision) into the
        // latest reader before the durable write so no reader/continuation
        // publishes consent that the server no longer holds. A concurrent
        // re-grant carries an even higher revision and still wins.
        latestUi.current = revoked;
        await saveGuestReader(revoked);
      }
      if (context.acceptedTurnCount !== 1 || !context.consentGranted || latestUi.current.pendingContentInvalidation || latestUi.current.pendingSourceDeletion) throw new Error("This guest conversation is not ready for another message. Check consent and retry.");
      if (latestUi.current.offline) throw new Error("Offline. Your message stays saved on this device.");
      if (payload.text.length > 4000 || !payload.text.trim()) throw new Error("Enter a message of at most 4,000 characters.");
      let pending = guestPendingRef.current ? readGuestPendingAction(guestPendingRef.current) : null;
      let replaced: GuestPendingAction | null = null;
      const now = new Date();
      if (pending) {
        if (JSON.stringify(pending.payload) !== JSON.stringify(payload)) {
          replaced = await abandonSavedGuestAction(pending, null);
          const refreshed = await api.guest.sessionInfo(proof);
          context = readGuestContext({ ...context, controlVersion: refreshed.controlVersion, acceptedTurnCount: refreshed.acceptedTurnCount, consentGranted: refreshed.consentGranted, conversationVersion: refreshed.conversationVersion });
          await guestDevice.updateContext(context); guestContextRef.current = context; setGuestContext(context);
          if (context.acceptedTurnCount !== 1 || !context.consentGranted) throw new Error("The guest conversation changed after cancellation. Your new draft was not sent.");
          pending = null;
        }
      }
      if (pending) {
        if (pending.phase === "authenticating" && !pending.autoResume && pending.authAttempt) {
          await endGuestAuthAttempt(pending.authAttempt.id, "dismissed");
          pending = guestPendingRef.current;
        }
        if (!pending) throw new Error("The saved message disappeared before sign-in could resume.");
        if (pending.phase === "dismissed" || !pending.autoResume && ["authenticated", "claim_pending", "claimed", "resume_pending"].includes(pending.phase)) {
          pending = reopenGuestPendingAction(pending, now); await saveGuestPending(pending);
        }
        if (["claim_reconcile", "resume_reconcile", "cancelled", "rejected", "expired", "dispatched"].includes(pending.phase)) throw new Error("This saved message requires reconciliation or a fresh conversation; it cannot be sent again.");
      } else {
        const expiresAt = new Date(Math.min(Date.parse(context.expiresAt), now.getTime() + 24 * 60 * 60 * 1000)).toISOString();
        if (Date.parse(expiresAt) <= now.getTime()) throw new Error("This guest conversation expired.");
        const first = latestUi.current.run;
        if (payload.kind === "follow_up" && first?.runId !== payload.parentRunId) throw new Error("The first research view changed before your follow-up was saved.");
        if (payload.kind === "clarification" && (first?.pendingInput?.id !== payload.pendingInputId || first.pendingInput.briefRevision !== payload.briefRevision || first.pendingInput.field !== payload.field)) throw new Error("The requested clarification changed. Refresh before continuing.");
        await guestDevice.saveSnapshot(context.guestContextId, latestUi.current, guestDraftRevision.current);
        pending = createGuestPendingAction({
          submissionId: newId(), guestContextId: context.guestContextId, conversationId: context.conversationId,
          conversationVersion: context.conversationVersion, draftRevision: guestDraftRevision.current,
          draftDigest: sha256Hex(payload.text), payload, consentPolicyVersion: context.consentPolicyVersion,
          createdAt: now.toISOString(), expiresAt,
        });
        if (replaced) {
          await guestDevice.replaceAbandonedAction(replaced, pending);
          abandonedGuestActions.current = [...abandonedGuestActions.current, replaced];
          guestPendingRef.current = pending; setGuestPending(pending);
        } else await saveGuestPending(pending);
      }
      if (pending.phase === "pending_auth") {
        const receipt = await api.guest.registerAction(proof, pending);
        if (receipt?.code !== "AUTH_REQUIRED_NEXT_TURN" || receipt.submissionId !== pending.submissionId || receipt.controlVersion !== context.controlVersion) throw new Error("The saved message was not confirmed by the research service.");
        if (typeof receipt.expiresAt !== "string" || !Number.isFinite(Date.parse(receipt.expiresAt)) || new Date(receipt.expiresAt).toISOString() !== receipt.expiresAt || Date.parse(receipt.expiresAt) > Date.parse(pending.expiresAt)) throw new Error("The saved message expiry did not match the guest conversation.");
        pending = readGuestPendingAction({ ...pending, expiresAt: receipt.expiresAt });
        await saveGuestPending(pending);
      }
      Keyboard.dismiss();
      setGuestSheetState(initialGuestSignInSheetState());
      setGuestSheetVisible(true);
      AccessibilityInfo.announceForAccessibility("Sign in to keep this conversation and send your saved message.");
    } catch (error) {
      setStateRaw(s => ({ ...s, error: error instanceof Error ? error.message : "The saved message could not be confirmed. It was not sent." }));
    } finally { submitting.current = false; }
  }

  async function verifiedClerkToken() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const token = await authRef.current?.getToken();
      if (token) return token;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Sign-in is not yet complete. Your message remains saved.");
  }

  async function finishGuestAuthentication(attemptId: string) {
    let pending = guestPendingRef.current;
    if (!pending || pending.phase !== "authenticating" || pending.authAttempt?.id !== attemptId) throw new Error("An older sign-in attempt cannot continue this message.");
    const memberToken = await verifiedClerkToken();
    const identity = await api.verifyMemberSession(memberToken);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identity.accountId)) throw new Error("The signed-in account identity is invalid.");
    pending = guestPendingRef.current;
    if (!pending || pending.phase !== "authenticating" || !pending.autoResume || taskViewClosing.current || pending.authAttempt?.id !== attemptId ||
      pending.draftRevision !== guestDraftRevision.current || pending.draftDigest !== sha256Hex(pending.payload.kind === "clarification" ? clarifyAnswer.trim() : latestUi.current.draft.trim())) throw new Error("The saved sign-in action changed. Its message was not claimed.");
    const completed = completeGuestAuth(pending, attemptId, identity.accountId, new Date());
    await saveGuestPending(completed, pending);
    api.rotateGuestScope();
    api.activateSession(memberToken, identity.accountId);
    const firstRunId = latestUi.current.run?.runId;
    if (firstRunId) api.selectRun(firstRunId);
    await activateLocalSession(sessionStorage, { token: memberToken, accountId: identity.accountId });
    memberTokenRef.current = memberToken; memberAccountRef.current = identity.accountId;
    activeClerkSubjectRef.current = authRef.current?.subject ?? null;
    setToken(memberToken); setAccountId(identity.accountId);
    // Guest consent is never a member consent grant: this is a distinct
    // revocation decision, so it advances the consent revision and a stale
    // guest grant echo can never resurrect itself in the member reader.
    setStateRaw(s => ({ ...withConsent(s, false), signedIn: true, error: null }));
    await claimAndResumeGuest(completed, memberToken, identity.accountId);
  }

  async function claimAndResumeGuest(action: GuestPendingAction, memberToken: string, memberAccountId: string) {
    const credential = memberAuthority(memberAccountId);
    let pending = guestPendingRef.current;
    if (!pending || pending.submissionId !== action.submissionId || !pending.autoResume) throw new Error("The saved action was dismissed before claim.");
    const { proof, context } = { proof: guestProof.current, context: guestContextRef.current };
    if (!proof || !context || pending.authenticatedAccountId !== memberAccountId) throw new Error("Guest claim is no longer attached to this account.");
    let claim;
    if (pending.phase === "authenticated") {
      const previous = pending;
      pending = beginGuestClaim(pending, newId(), new Date()); await saveGuestPending(pending, previous);
      try { claim = await api.guest.claim(proof, credential(), pending); }
      catch (error) {
        const latest = guestPendingRef.current;
        if (latest?.submissionId === pending.submissionId && latest.phase === "claim_pending") await saveGuestPending(holdGuestClaimForReconciliation(latest), latest);
        throw new Error("Claim outcome is unknown. Resolve the saved claim; it will not be sent again.");
      }
    } else if (pending.phase === "claim_pending" || pending.phase === "claim_reconcile") {
      claim = await api.resolveGuestClaim(credential(), pending.claim!.requestId, pending.submissionId);
    } else if (pending.phase === "claimed" || pending.phase === "resume_pending") {
      claim = await api.resolveGuestClaim(credential(), pending.claim!.requestId, pending.submissionId);
    } else throw new Error("The saved claim is not ready to continue.");
    if (claim) {
      const latest = guestPendingRef.current;
      if (!latest || latest.submissionId !== pending.submissionId || latest.claim?.requestId !== pending.claim?.requestId || latest.phase === "cancelled") throw new Error("The saved claim changed while the server was responding.");
      pending = latest;
      const epochs = api.sessionEpochs();
      if (pending.phase !== "claimed" && pending.phase !== "resume_pending") {
        pending = completeGuestClaim(pending, { ...claim, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch }, new Date());
        await saveGuestPending(pending, latest);
      } else if (claim.type !== "claim_accepted" || claim.submissionId !== pending.submissionId || !pending.claim || claim.requestId !== pending.claim.requestId || claim.accountId !== memberAccountId || claim.conversationId !== pending.conversationId || claim.conversationVersion !== pending.conversationVersion || claim.controlVersion !== pending.claim.controlVersion) {
        throw new Error("The saved claim readback did not match this conversation.");
      }
      if (claim.authorityAllowed !== true || claim.budgetAllowed !== true) {
        await saveGuestPending(dismissGuestPendingAction(pending, new Date()), pending);
        throw new Error(claim.budgetAllowed === false ? "Your account needs a research allowance before this saved message can run." : "Current account authority must be confirmed before this saved message can run.");
      }
      // Guest consent is never member consent. A null or stale member consent
      // version retains the exact claim and presents explicit member-consent
      // UX via the real consent route; resume posts nothing until granted.
      if (claim.consentPolicyVersion == null || claim.consentPolicyVersion !== context.consentPolicyVersion) {
        setStateRaw(s => ({ ...s, tab: "settings", error: "Grant AI processing consent in Settings to continue the saved message. It remains saved and will continue once." }));
        throw new Error("Member consent is required before this saved message can run. The exact saved claim is retained.");
      }
    }
    if (!guestPendingRef.current?.autoResume || guestPendingRef.current.submissionId !== pending.submissionId) throw new Error("The saved message was dismissed. Claim remains held; nothing was continued.");
    const epochs = api.sessionEpochs();
    const current = latestUi.current;
    const currentPendingText = pending.payload.kind === "clarification" ? clarifyAnswer.trim() : current.draft.trim();
    const verdict = validateGuestActionResume(pending, {
      now: new Date(), accountId: memberAccountId, sessionActive: true,
      guestContextId: context.guestContextId, conversationId: context.conversationId, conversationVersion: context.conversationVersion,
      controlVersion: pending.claim!.controlVersion, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch,
      credentialGeneration: epochs.credentialGeneration, draftRevision: guestDraftRevision.current,
      draftDigest: sha256Hex(currentPendingText), consentPolicyVersion: context.consentPolicyVersion,
      authorityAllowed: claim?.authorityAllowed === true, budgetAllowed: claim?.budgetAllowed === true,
    });
    if (!verdict.ok) throw new Error(`Saved message is held because its ${verdict.code} changed. It was not sent.`);
    pending = beginGuestActionResume(pending, {
      now: new Date(), accountId: memberAccountId, sessionActive: true,
      guestContextId: context.guestContextId, conversationId: context.conversationId, conversationVersion: context.conversationVersion,
      controlVersion: pending.claim!.controlVersion, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch,
      credentialGeneration: epochs.credentialGeneration, draftRevision: guestDraftRevision.current,
      draftDigest: sha256Hex(currentPendingText), consentPolicyVersion: context.consentPolicyVersion,
      authorityAllowed: true, budgetAllowed: true,
    });
    await saveGuestPending(pending, guestPendingRef.current);
    let result;
    try { result = await api.resumeGuestAction(credential(), pending); }
    catch (error) {
      const latest = guestPendingRef.current;
      if (!latest || latest.submissionId !== pending.submissionId || latest.phase !== "resume_pending") throw new Error("Continuation state changed while the server was responding. The original request remains held.");
      if (error instanceof ApiError && error.status === 402) {
        await saveGuestPending(dismissGuestPendingAction(latest, new Date()), latest);
        throw new Error("Your account needs a research allowance. The exact saved second message can be continued after funding; nothing was sent again.");
      }
      // A definitive 403 consent_required denial is not an unknown outcome:
      // the server did not dispatch. Retain the exact claim, present explicit
      // consent UX, and continue once after the real grant. Unknown outcomes
      // stay held for reconciliation and are never resent.
      if (error instanceof ApiError && error.status === 403 && error.code === "consent_required") {
        await saveGuestPending(holdGuestResumeForConsent(latest), latest);
        setStateRaw(s => ({ ...s, tab: "settings", error: "Grant AI processing consent in Settings to continue the saved message. It remains saved and will continue once." }));
        throw new Error("Member consent is required before this saved message can run. The exact saved claim is retained.");
      }
      await saveGuestPending(holdGuestResumeForReconciliation(latest), latest);
      throw new Error("Continuation outcome is unknown. Resolve the saved request; it will not be sent again.");
    }
    const latest = guestPendingRef.current;
    if (!latest || latest.submissionId !== pending.submissionId || latest.phase !== "resume_pending") throw new Error("Continuation identity changed while the server was responding. Resolve the original request.");
    if (!latest.autoResume) {
      await saveGuestPending(holdGuestResumeForReconciliation(latest), latest);
      throw new Error("The saved message was dismissed. Resolve its exact dispatched result before continuing.");
    }
    await adoptGuestContinuation(latest, result, credential());
  }

  async function adoptGuestContinuation(pending: GuestPendingAction, result: any, _memberToken: string) {
    const credential = memberAuthority(pending.authenticatedAccountId);
    const dispatched = markGuestActionDispatched(pending, result, new Date());
    if (typeof result.runId !== "string" || typeof result.memberConversationId !== "string") throw new Error("The continued research identity was not confirmed.");
    guestRunEpoch.current++;
    // Read the latest still-owned reader only after the durable journal write:
    // text typed during persistence survives in both the stored snapshot and
    // the rendered state. The dispatched message clears; anything typed
    // meanwhile (or an unrelated draft beside a clarification answer) survives.
    // A principal change that landed meanwhile fail-closes via credential().
    api.selectRun(result.runId);
    await saveGuestPending(dispatched);
    const previous = latestUi.current;
    const sentText = pending.payload.kind === "clarification" ? null : pending.payload.text;
    const next: UiState = { ...previous, signedIn: true, conversationId: result.memberConversationId,
      draft: sentText !== null && previous.draft.trim() === sentText.trim() ? "" : previous.draft, source: null, readingAnchor: null, report: null,
      previousReport: previous.report ? { reportId: previous.report.reportId, blocks: previous.report.blocks } : previous.previousReport,
      events: [], status: "progress", error: null,
      run: { runId: result.runId, lifecycle: "queued", phase: "queued", outcome: null, reportId: null, labeledDemo: false } };
    await sessionStorage.persistRequired(credential(), next);
    // Whole-update boundary, same as the guest reader: compare against the
    // pre-write draft, not the accepted frame. An unchanged reader publishes
    // the accepted frame (only an unchanged send clears the draft); an edit
    // that landed during the final member write merges into it. Consent
    // follows the version boundary: the higher confirmed revision wins, so a
    // render echo of a pre-decision frame can never resurrect stale consent.
    const latest = latestUi.current;
    const merged = { ...next, draft: latest.draft !== previous.draft ? latest.draft : next.draft, ...mergeConsent(next, latest) };
    latestUi.current = merged; setStateRaw(merged);
    setGuestSheetVisible(false);
    startPolling(credential(), result.runId); void refreshRun(credential(), result.runId, next);
    await guestDevice.clear(); guestContextRef.current = null; guestProof.current = null; guestPendingRef.current = null;
    api.clearGuest();
    setGuestContext(null); setGuestPending(null);
  }

  function replacedClarification(action: GuestPendingAction): GuestPendingAction {
    const old = abandonedGuestActions.current.at(-1);
    if (!old || old.phase !== "cancelled" || old.payload.kind !== "clarification" || action.payload.kind !== "clarification" ||
      old.claim?.requestId !== action.claim?.requestId || old.authenticatedAccountId !== action.authenticatedAccountId ||
      old.payload.pendingInputId !== action.payload.pendingInputId || old.payload.briefRevision !== action.payload.briefRevision || old.payload.field !== action.payload.field)
      throw new Error("The abandoned clarification identity is unavailable. The edited answer remains held.");
    return old;
  }

  async function confirmSavedMemberClarification(action: GuestPendingAction, tokenForRequest: string): Promise<GuestPendingAction> {
    const old = replacedClarification(action);
    const receipt = await api.registerMemberGuestAction(memberAuthority(action.authenticatedAccountId)(), action, old.submissionId);
    const latest = guestPendingRef.current;
    if (!latest || latest.submissionId !== action.submissionId || latest.phase !== "member_register_pending" || latest.claim?.requestId !== action.claim?.requestId)
      throw new Error("Edited answer changed while registration was being confirmed.");
    const confirmed = confirmMemberClarificationRegistration(latest, receipt, new Date());
    await saveGuestPending(confirmed, latest);
    return confirmed;
  }

  async function continueMemberClarification(tokenForRequest: string, account: string) {
    const credential = memberAuthority(account);
    let pending = guestPendingRef.current;
    if (!pending || pending.payload.kind !== "clarification") throw new Error("There is no saved clarification to continue.");
    const input = latestUi.current.run?.pendingInput;
    const text = clarifyAnswer.trim();
    if (!input || input.type !== "clarification" || !input.field || !text || input.id !== pending.payload.pendingInputId ||
      input.briefRevision !== pending.payload.briefRevision || input.field !== pending.payload.field) throw new Error("The requested clarification changed. Refresh before sending another answer.");
    if (text === pending.payload.text && !["cancelled", "member_register_pending", "member_claimed", "resume_pending", "resume_reconcile"].includes(pending.phase)) {
      await continueSavedSecondMessage(tokenForRequest, account);
      return;
    }
    // A local B registration may have had an unknown reply. Confirm that
    // exact B before asking the server to abandon it for a newer C answer.
    if (pending.phase === "member_register_pending" && text !== pending.payload.text)
      pending = await confirmSavedMemberClarification(pending, credential());
    if (pending.phase === "resume_pending") {
      const held = holdGuestResumeForReconciliation(pending);
      await saveGuestPending(held, pending);
      pending = held;
    }
    if (pending.phase === "cancelled" || text !== pending.payload.text) {
      if (pending.phase !== "cancelled") {
        if (!["claimed", "member_claimed"].includes(pending.phase) || !pending.claim) throw new Error("The previous answer must finish claim reconciliation before it can be replaced.");
        pending = await abandonSavedGuestAction(pending, credential());
      }
      const payload = { kind: "clarification" as const, text, pendingInputId: input.id, briefRevision: input.briefRevision, field: input.field };
      const replacement = prepareMemberClarificationReplacement(pending, payload, newId(), guestDraftRevision.current, new Date(), api.sessionEpochs());
      await guestDevice.replaceAbandonedAction(pending, replacement);
      abandonedGuestActions.current = [...abandonedGuestActions.current, pending];
      guestPendingRef.current = replacement; setGuestPending(replacement);
      pending = replacement;
    }
    if (pending.phase === "member_register_pending") {
      pending = await confirmSavedMemberClarification(pending, credential());
    }
    if (pending.phase === "member_claimed") {
      if (!pending.autoResume) { const reopened = reopenGuestPendingAction(pending, new Date()); await saveGuestPending(reopened, pending); pending = reopened; }
      const claim = pending.claim;
      if (!claim) throw new Error("The edited clarification lost its accepted claim identity.");
      const currentToken = credential();
      const receipt = await api.resolveGuestAction(currentToken, pending);
      if (receipt?.type !== "member_action_registered" || receipt.submissionId !== pending.submissionId || receipt.claimRequestId !== claim.requestId ||
        receipt.payloadDigest !== pending.payloadDigest || receipt.controlVersion !== claim.controlVersion) throw new Error("The edited answer registration readback did not match.");
      if (receipt.authorityAllowed !== true || receipt.budgetAllowed !== true) {
        await saveGuestPending(dismissGuestPendingAction(pending, new Date()), pending);
        throw new Error(receipt.budgetAllowed === false ? "Your account needs a research allowance. The edited answer remains saved." : "Member consent or authority is required. The edited answer remains saved.");
      }
      // Member consent missing or outdated retains the exact member_claimed
      // receipt instead of blanket-clearing it; one continuation runs after
      // the explicit grant. Clarification field, ID, and revision are
      // untouched, so the held answer keeps its exact identity.
      if (receipt.consentPolicyVersion !== pending.consentPolicyVersion || !latestUi.current.consentGranted) {
        setStateRaw(s => ({ ...s, tab: "settings", error: "Grant AI processing consent in Settings to continue the saved answer. It remains saved and will continue once." }));
        throw new Error("Member consent is required before this saved answer can run. The exact saved claim is retained.");
      }
      const epochs = api.sessionEpochs();
      const context = guestContextRef.current;
      if (!context) throw new Error("The guest conversation binding is unavailable.");
      const resumeContext = { now: new Date(), accountId: account, sessionActive: true,
        guestContextId: context.guestContextId, conversationId: context.conversationId, conversationVersion: context.conversationVersion,
        controlVersion: claim.controlVersion, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch,
        credentialGeneration: epochs.credentialGeneration, draftRevision: guestDraftRevision.current, draftDigest: sha256Hex(text),
        consentPolicyVersion: context.consentPolicyVersion, authorityAllowed: true, budgetAllowed: true };
      const verdict = validateGuestActionResume(pending, resumeContext);
      if (!verdict.ok) throw new Error(`Edited answer is held because its ${verdict.code} changed.`);
      const resuming = beginGuestActionResume(pending, resumeContext);
      await saveGuestPending(resuming, pending); pending = resuming;
      let result;
      try { result = await api.resumeGuestAction(credential(), pending); }
      catch (error) {
        const latest = guestPendingRef.current;
        if (latest?.submissionId === pending.submissionId && latest.phase === "resume_pending") {
          if (error instanceof ApiError && error.status === 402) {
            await saveGuestPending(dismissGuestPendingAction(latest, new Date()), latest);
          } else if (error instanceof ApiError && error.status === 403 && error.code === "consent_required") {
            await saveGuestPending(holdGuestResumeForConsent(latest), latest);
            setStateRaw(s => ({ ...s, tab: "settings", error: "Grant AI processing consent in Settings to continue the saved answer. It remains saved and will continue once." }));
          } else {
            await saveGuestPending(holdGuestResumeForReconciliation(latest), latest);
          }
        }
        if (error instanceof ApiError && error.status === 403 && error.code === "consent_required")
          throw new Error("Member consent is required before this saved answer can run. The exact saved claim is retained.");
        throw new Error(error instanceof ApiError && error.status === 402 ? "Your account needs a research allowance. The edited answer remains saved." : "Edited answer outcome is unknown. Resolve its original ID; it was not resent.");
      }
      const latest = guestPendingRef.current;
      if (!latest || latest.submissionId !== pending.submissionId || latest.phase !== "resume_pending") throw new Error("Edited answer state changed during continuation.");
      if (!latest.autoResume) { await saveGuestPending(holdGuestResumeForReconciliation(latest), latest); throw new Error("Edited answer was dismissed. Resolve its exact result."); }
      await adoptGuestContinuation(latest, result, credential());
      return;
    }
    if (pending.phase === "resume_reconcile") {
      const result = await api.resolveGuestAction(credential(), pending);
      if (result?.type !== "continuation_dispatched") throw new Error("Edited answer is still unconfirmed. It was not resent.");
      await adoptGuestContinuation(pending, result, credential());
      return;
    }
    throw new Error("The edited clarification is held until its exact server state is resolved.");
  }

  function savedSecondMessageBlocksWork(): boolean {
    const pending = guestPendingRef.current;
    return !!pending && (pending.phase === "cancelled" ? !!token && !!guestContextRef.current : !["dispatched", "rejected", "expired"].includes(pending.phase));
  }

  async function continueSavedSecondMessage(memberToken: string, memberAccountId: string) {
    const credential = memberAuthority(memberAccountId);
    let pending = guestPendingRef.current;
    if (!pending || !savedSecondMessageBlocksWork()) return;
    if (pending.payload.kind === "clarification" && (pending.phase === "member_register_pending" || pending.phase === "member_claimed")) {
      await continueMemberClarification(credential(), memberAccountId);
      return;
    }
    if (pending.phase === "resume_reconcile") {
      const resolved = await api.resolveGuestAction(credential(), pending);
      if (resolved?.type !== "continuation_dispatched") throw new Error("The saved continuation is still unconfirmed. No new message was sent.");
      await adoptGuestContinuation(pending, resolved, credential());
      return;
    }
    if (pending.phase === "claim_reconcile") {
      const resolved = await api.resolveGuestClaim(credential(), pending.claim!.requestId, pending.submissionId);
      const epochs = api.sessionEpochs();
      pending = completeGuestClaim(pending, { ...resolved, principalEpoch: epochs.principalEpoch, viewEpoch: epochs.viewEpoch }, new Date());
      await saveGuestPending(pending);
    }
    if (["authenticated", "claim_pending", "claimed", "resume_pending"].includes(pending.phase)) {
      if (!pending.autoResume) { pending = reopenGuestPendingAction(pending, new Date()); await saveGuestPending(pending); }
      await claimAndResumeGuest(pending, credential(), memberAccountId);
      return;
    }
    throw new Error("The saved second message must finish sign-in or be reconciled before starting other research.");
  }

  const legalReady = (url: string | null) => {
    if (!url) return false;
    try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash; }
    catch { return false; }
  };
  const legalDocumentsReady = legalReady(guestCapabilities.termsUrl) && legalReady(guestCapabilities.privacyUrl);
  const guestProviders: Record<"apple" | "google" | "email", GuestProviderAvailability> = {
    apple: { available: !!auth?.loaded && legalDocumentsReady && guestCapabilities.apple, unavailableReason: "Apple sign-in is not configured for this build." },
    google: { available: !!auth?.loaded && legalDocumentsReady && guestCapabilities.google, unavailableReason: "Google sign-in is not configured for this build." },
    email: { available: !!auth?.loaded && legalDocumentsReady && guestCapabilities.emailCode, unavailableReason: "Email sign-in is not configured for this build." },
  };

  /** End is a durable server fence. Unknown replies retain the same local ID and forbid a new attempt. */
  async function endGuestAuthAttempt(attemptId: string, reason: "cancelled" | "dismissed") {
    let pending = guestPendingRef.current;
    if (!pending || pending.phase !== "authenticating" || pending.authAttempt?.id !== attemptId) return;
    if (pending.autoResume) {
      pending = holdGuestAuthAttempt(pending, attemptId, new Date());
      await saveGuestPending(pending);
    }
    const proof = guestProof.current;
    if (!proof) throw new Error("Guest proof is unavailable. The sign-in attempt remains held.");
    let ended;
    try { ended = await api.guest.endAuthAttempt(proof, pending.submissionId, attemptId, reason); }
    catch (error) {
      if (isOfflineError(error)) throw new Error("Sign-in cancellation is unconfirmed. The saved attempt is held; reconnect before trying again.");
      const resolved = await api.guest.resolveAuthAttempt(proof, pending.submissionId, attemptId);
      if (resolved.state !== "dismissed" && resolved.state !== "cancelled") throw new Error("Sign-in cancellation is unconfirmed. The saved attempt is held.");
      ended = resolved;
    }
    if (ended.submissionId !== pending.submissionId || ended.authAttemptId !== attemptId || !Number.isSafeInteger(ended.attemptRevision) || ended.attemptRevision < 1 || !["dismissed", "cancelled"].includes(ended.state)) throw new Error("The sign-in cancellation receipt did not match the saved attempt.");
    const current = guestPendingRef.current;
    if (!current || current.phase !== "authenticating" || current.authAttempt?.id !== attemptId || current.autoResume) throw new Error("Sign-in state changed while cancellation was being confirmed.");
    await saveGuestPending(reason === "cancelled" ? cancelGuestAuthAttempt(current, attemptId, new Date()) : dismissGuestPendingAction(current, new Date()));
  }

  async function closeClerkSessionTask() {
    taskViewClosing.current = true;
    taskContinuationAttempt.current = null;
    setTaskContinuationId(null);
    const pending = guestPendingRef.current;
    try {
      if (pending?.phase === "authenticating" && pending.authAttempt) await endGuestAuthAttempt(pending.authAttempt.id, "dismissed");
      authRef.current?.confirmSessionTaskDismissed();
      setGuestSheetVisible(false);
    } catch (error) {
      setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling",
        error: "Sign-in cancellation is unconfirmed. The saved message is held; reconnect and retry closing." });
      throw error;
    } finally { taskViewClosing.current = false; }
  }

  useEffect(() => {
    const pending = guestPendingRef.current;
    const attemptId = taskContinuationAttempt.current;
    if (!hydrated || !auth?.loaded || !auth.signedIn || auth.sessionTaskPending || taskViewClosing.current ||
      !pending || pending.phase !== "authenticating" || !pending.autoResume || pending.authAttempt?.id !== attemptId) return;
    taskContinuationAttempt.current = null;
    setTaskContinuationId(null);
    void finishGuestAuthentication(attemptId).catch(error => {
      const latest = guestPendingRef.current;
      if (latest && !["dispatched", "cancelled", "rejected", "expired"].includes(latest.phase))
        setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling",
          error: "Sign-in succeeded, but the saved request needs confirmation. Check it without sending a new message." });
    });
  }, [hydrated, auth?.loaded, auth?.signedIn, auth?.sessionTaskPending, guestPending?.phase, taskContinuationId]);

  const guestSheetTransport: GuestSignInTransport = {
    prepareAttempt: async request => {
      const pending = guestPendingRef.current;
      if (!pending || !guestProviders[request.provider].available) throw new Error("This sign-in method is unavailable. Your message remains saved.");
      if (pending.phase === "authenticating" && pending.autoResume && request.provider === "email" && pending.authAttempt?.provider === "email" && ["resend_email_code", "verify_email_code"].includes(request.operation)) {
        return { id: pending.authAttempt.id, operation: request.operation, provider: "email", email: request.email };
      }
      if (pending.phase !== "pending_auth") throw new Error("An earlier sign-in attempt must be resolved before another can start.");
      const attempt = { id: newId(), operation: request.operation, provider: request.provider, email: request.email };
      await saveGuestPending(beginGuestAuth(pending, { id: attempt.id, provider: request.provider }, new Date()));
      const receipt = await api.guest.beginAuthAttempt(currentGuest().proof, pending.submissionId, attempt.id, request.provider);
      if (receipt.submissionId !== pending.submissionId || receipt.authAttemptId !== attempt.id || receipt.state !== "authenticating" || !Number.isSafeInteger(receipt.attemptRevision) || receipt.attemptRevision < 1) throw new Error("The sign-in attempt was not confirmed by the research service.");
      const current = guestPendingRef.current;
      if (!current || current.phase !== "authenticating" || !current.autoResume || current.authAttempt?.id !== attempt.id) throw new Error("The saved sign-in attempt changed before opening the provider.");
      return attempt;
    },
    startProvider: async attempt => {
      if (!authRef.current || attempt.provider === "email") throw new Error("This sign-in method is unavailable.");
      try {
        const result = await authRef.current.startProvider(attempt.provider);
        if (result === "pending_task") {
          taskContinuationAttempt.current = attempt.id; setTaskContinuationId(attempt.id);
          setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
          return;
        }
        await finishGuestAuthentication(attempt.id);
      } catch (error) {
        if (error instanceof Error && error.message === "Sign-in was cancelled.") {
          await endGuestAuthAttempt(attempt.id, "cancelled");
          setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "provider_cancelled" }, guestProviders));
          return;
        }
        throw error;
      }
    },
    requestEmailCode: async attempt => {
      if (!authRef.current || !attempt.email) throw new Error("Email sign-in is unavailable.");
      try { await authRef.current.sendEmailCode(attempt.email, attempt.operation === "resend_email_code"); }
      catch (error) {
        if (error && typeof error === "object" && "guestAuthFailure" in error && error.guestAuthFailure === "rate_limited") {
          if (attempt.operation === "email_code") {
            await endGuestAuthAttempt(attempt.id, "cancelled");
            setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "recoverable_error", message: "Too many attempts. Wait before requesting another code." }, guestProviders));
          } else setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "resend_rate_limited", retryAt: null, message: "Too many attempts. Wait before requesting another code." }, guestProviders));
          return;
        }
        throw error;
      }
      const pending = guestPendingRef.current;
      if (!pending || pending.authAttempt?.id !== attempt.id) throw new Error("The email attempt changed. Your message was not sent.");
      setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "email_code_sent", email: attempt.email!, resendRetryAt: new Date(Date.now() + 30_000).toISOString() }, guestProviders));
    },
    verifyEmailCode: async (attempt, code) => {
      if (!authRef.current) throw new Error("Email sign-in is unavailable.");
      let result: "active" | "pending_task";
      try { result = await authRef.current.verifyEmailCode(code); }
      catch (error) {
        if (error && typeof error === "object" && "guestAuthFailure" in error && error.guestAuthFailure === "code_expired") {
          await endGuestAuthAttempt(attempt.id, "cancelled");
          setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "code_expired", message: "That code expired. Request a new one." }, guestProviders));
          return;
        }
        throw error;
      }
      if (result === "pending_task") {
        taskContinuationAttempt.current = attempt.id; setTaskContinuationId(attempt.id);
        setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
        return;
      }
      await finishGuestAuthentication(attempt.id);
    },
    retryAuthenticatedAttempt: async () => {
      if (!authRef.current?.signedIn || authRef.current.sessionTaskPending) throw new Error("Complete account security before checking the saved request.");
      const pending = guestPendingRef.current;
      if (!pending) throw new Error("The saved request is no longer available.");
      if (pending.phase === "authenticating" && pending.authAttempt) {
        if (!pending.autoResume) throw new Error("Sign-in cancellation is unconfirmed. The saved attempt cannot continue.");
        await finishGuestAuthentication(pending.authAttempt.id);
        return;
      }
      const account = pending.authenticatedAccountId;
      if (!account) throw new Error("The saved request is still waiting for verified account identity.");
      await continueSavedSecondMessage(memberAuthority(account)(), account);
    },
    cancelProvider: async attempt => { await endGuestAuthAttempt(attempt.id, "cancelled"); },
    cancelEmailAttempt: async () => {
      const pending = guestPendingRef.current;
      if (pending?.phase === "authenticating" && pending.authAttempt?.provider === "email") await endGuestAuthAttempt(pending.authAttempt.id, "cancelled");
    },
    dismiss: async () => {
      const pending = guestPendingRef.current;
      if (pending?.phase === "authenticating" && pending.authAttempt) await endGuestAuthAttempt(pending.authAttempt.id, "dismissed");
      else if (pending) await saveGuestPending(dismissGuestPendingAction(pending, new Date()));
    },
  };

  async function onGuestSheetEvent(event: GuestSignInSheetEvent) {
    setGuestSheetState(s => reduceGuestSignInSheet(s, event, guestProviders));
  }

  async function openGuestLegal(document: "terms" | "privacy") {
    const url = document === "terms" ? guestCapabilities.termsUrl : guestCapabilities.privacyUrl;
    if (!legalReady(url)) throw new Error("This legal document is not configured. Sign-in remains unavailable.");
    await Linking.openURL(url!);
  }

  async function deleteGuestConversation() {
    const { proof } = currentGuest();
    const runId = latestUi.current.run?.runId;
    const hidden = runId ? redactInvalidatedContent(latestUi.current, runId) : { ...emptyState(), draft: "" };
    await saveGuestReader(hidden);
    stopPolling();
    try {
      await api.guest.delete(proof);
      await guestDevice.clear();
      api.clearGuest();
      guestProof.current = null; guestContextRef.current = null; guestFirstRequest.current = null; guestPendingRef.current = null;
      setGuestContext(null); setGuestPending(null); setGuestSheetVisible(false);
      setStateRaw(emptyState());
    } catch {
      setStateRaw(s => ({ ...s, error: "Guest research is hidden. Server deletion is unconfirmed; reconnect and retry deletion." }));
    }
  }

  async function ensureSession() {
    if (signingIn.current) return signingIn.current;
    const pending = startSession(); signingIn.current = pending;
    try { return await pending; }
    finally { if (signingIn.current === pending) signingIn.current = null; }
  }

  /** Close the direct-login chooser after a verified member session is live. */
  function closeDirectLogin() {
    directLoginRef.current = false; setDirectLogin(false);
    setGuestSheetVisible(false);
  }

  /**
   * Direct member login transport for the shared provider chooser. Attempts
   * are ephemeral (no guest journal exists here); a real configured provider
   * session is verified and restored exactly like the settings entry, then
   * the member reader (including the server-backed Library) is live.
   */
  const directLoginTransport: GuestSignInTransport = {
    prepareAttempt: async request => {
      if (!directLoginRef.current || guestPendingRef.current) throw new Error("Direct sign-in is not open.");
      if (!guestProviders[request.provider].available) throw new Error("This sign-in method is unavailable.");
      return { id: newId(), operation: request.operation, provider: request.provider, email: request.email };
    },
    startProvider: async attempt => {
      if (!directLoginRef.current || !authRef.current || attempt.provider === "email") throw new Error("This sign-in method is unavailable.");
      try {
        const result = await authRef.current.startProvider(attempt.provider);
        if (result === "pending_task") {
          setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
          return;
        }
        if (!authRef.current.signedIn) {
          // The native provider finished before Clerk reports the session.
          // Wait for the verified session instead of failing the chooser; the
          // login completes exactly once the session is live. Nothing is sent.
          setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
          return;
        }
        await ensureSession();
        closeDirectLogin();
      } catch (error) {
        if (error instanceof Error && error.message === "Sign-in was cancelled.") {
          setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "provider_cancelled" }, guestProviders));
          return;
        }
        throw error;
      }
    },
    requestEmailCode: async attempt => {
      if (!directLoginRef.current || !authRef.current || !attempt.email) throw new Error("Email sign-in is unavailable.");
      try { await authRef.current.sendEmailCode(attempt.email, attempt.operation === "resend_email_code"); }
      catch (error) {
        if (error && typeof error === "object" && "guestAuthFailure" in error && error.guestAuthFailure === "rate_limited") {
          if (attempt.operation === "email_code") {
            setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "recoverable_error", message: "Too many attempts. Wait before requesting another code." }, guestProviders));
          } else setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "resend_rate_limited", retryAt: null, message: "Too many attempts. Wait before requesting another code." }, guestProviders));
          return;
        }
        throw error;
      }
      setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "email_code_sent", email: attempt.email!, resendRetryAt: new Date(Date.now() + 30_000).toISOString() }, guestProviders));
    },
    verifyEmailCode: async (attempt, code) => {
      if (!directLoginRef.current || !authRef.current) throw new Error("Email sign-in is unavailable.");
      let result: "active" | "pending_task";
      try { result = await authRef.current.verifyEmailCode(code); }
      catch (error) {
        if (error && typeof error === "object" && "guestAuthFailure" in error && error.guestAuthFailure === "code_expired") {
          setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "code_expired", message: "That code expired. Request a new one." }, guestProviders));
          return;
        }
        throw error;
      }
      if (result === "pending_task") {
        setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
        return;
      }
      if (!authRef.current.signedIn) {
        // The email session completed before Clerk reports it. Wait for the
        // verified session; the login completes exactly once it is live.
        setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
        return;
      }
      await ensureSession();
      closeDirectLogin();
    },
    retryAuthenticatedAttempt: async () => {
      if (!directLoginRef.current) throw new Error("Direct sign-in is not open.");
      if (!authRef.current?.signedIn || authRef.current.sessionTaskPending) throw new Error("Complete account security before signing in.");
      await ensureSession();
      closeDirectLogin();
    },
    // Ephemeral attempts journal nothing, so cancellation only returns the
    // chooser to its initial state; the draft is untouched.
    cancelProvider: async () => {},
    cancelEmailAttempt: async () => {},
    dismiss: async () => { directLoginRef.current = false; setDirectLogin(false); },
  };

  // A provider or email completion that flips Clerk state outside the
  // transport (including a pending native task) finishes the direct login
  // exactly once the verified session is live.
  useEffect(() => {
    if (!directLogin || !hydrated || !auth?.loaded || !auth.signedIn || auth.sessionTaskPending) return;
    void ensureSession().then(() => { if (directLoginRef.current) closeDirectLogin(); })
      .catch(error => {
        if (isSupersededRequest(error)) return;
        setGuestSheetState(s => reduceGuestSignInSheet(s, { type: "recoverable_error", message: error instanceof Error ? error.message : "Sign-in could not be completed." }, guestProviders));
      });
  }, [directLogin, hydrated, auth?.loaded, auth?.signedIn, auth?.sessionTaskPending]);

  async function startSession() {
    if (token) return token;
    let guard: ReturnType<typeof api.capture> | undefined;
    try {
      if (!hydrated) throw new Error("Restoring this device’s session. Try again shortly.");
      if (!storageReady) throw new Error("Device recovery failed. Use Log out and clear saved drafts and reports before signing in again.");
      if (!authRef.current?.loaded || !authRef.current.signedIn) throw new Error("Sign in with a configured provider before using member research.");
      const memberToken = await verifiedClerkToken();
      const identity = await api.verifyMemberSession(memberToken);
      const s = { token: memberToken, accountId: identity.accountId };
      redactingContent.current = false; api.activateSession(s.token, s.accountId);
      guard = api.capture();
      await activateLocalSession(sessionStorage, s);
      if (!guard.current()) { guard.release(); throw new SupersededRequest(); }
      const accepted = guard;
      memberTokenRef.current = s.token; memberAccountRef.current = s.accountId;
      activeClerkSubjectRef.current = authRef.current?.subject ?? null;
      setToken((previous) => accepted.current() ? s.token : previous);
      if (accepted.current()) setAccountId(s.accountId);
      setState((prev) => {
        if (!accepted.current()) return prev;
        const next = { ...emptyState(), draft: prev.signedIn ? "" : prev.draft, signedIn: true, error: null, routeMode: prev.routeMode, reducedMotion: prev.reducedMotion,
          // Unsent local documents were never transmitted; keep them so the
          // post-login member admission can carry them under a member bearer.
          attachments: prev.attachments };

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
      if (!token) {
        const { context, proof } = await ensureGuestContext();
        const result = await api.guest.consent(proof, true);
        if (result.granted !== true || result.policyVersion !== context.consentPolicyVersion) throw new Error("Current guest consent could not be confirmed.");
        const updated = readGuestContext({ ...context, consentGranted: true });
        await guestDevice.updateContext(updated); guestContextRef.current = updated; setGuestContext(updated);
        const next = { ...withConsent(latestUi.current, true), tab: "research" as const, error: null, routeMode: "controlled-research" as const };
        // Mirror the confirmed grant (higher revision) into the latest reader
        // before the durable write, exactly like the member branch: a render
        // echo of the stale pre-grant frame carries the same lower revision
        // and can never regress it. A later revocation advances the revision
        // again and still wins via the version boundary.
        latestUi.current = next;
        await saveGuestReader(next);
        return;
      }
      const t = memberTokenRef.current ?? token ?? (await ensureSession());
      // Stricter member-consent route: member bearer only, guest proof never
      // attached. Fail closed when the server does not confirm the grant.
      const consentResult = await api.consent(t, true);
      if (consentResult?.granted !== true) throw new Error("Current member consent could not be confirmed.");
      // The server confirmed the grant. Advance the monotonic consent revision
      // and mirror it into both the latest reader and the queued render, so a
      // render echo of the stale pre-grant frame (same lower revision) cannot
      // regress it and a continuation adopted in this same call stack cannot
      // publish a stale pre-grant flag. A revocation that lands later advances
      // the revision again and still wins at the version boundary.
      const granted = withConsent(latestUi.current, true);
      latestUi.current = granted;
      setState((s) => ({ ...s, consentGranted: true, error: null, consentRevision: Math.max(s.consentRevision, granted.consentRevision) }));
      // Funded continuation of an exact retained claim after explicit member
      // consent. The bounded new-member grant is keyed by the claim identity,
      // so a retry replays the same grantRequestId (server answers reused)
      // instead of funding twice; only then does the single resume run. A
      // denied or unknown grant withholds the continuation: 403
      // consent_required on resume still holds with explicit UX, 402 still
      // lands in the funding state, and neither is ever auto-resent.
      // Clarification field, ID, and revision are untouched, so the held
      // answer keeps its exact identity. Reconcile-only journals never
      // auto-resume here.
      const held = guestPendingRef.current;
      const owner = memberAccountRef.current;
      if (held && owner && held.autoResume && held.authenticatedAccountId === owner &&
        (held.phase === "claimed" || held.phase === "member_claimed")) {
        try {
          if (!held.claim) throw new Error("The saved claim lost its identity. It was not continued.");
          await api.newMemberGrant(t, held.claim.requestId, DEFAULT_RUN_BUDGET_MICRO);
          await continueSavedSecondMessage(t, owner);
        }
        catch (e) {
          if (isSupersededRequest(e)) return;
          setState((s) => ({ ...s, error: (e as Error).message }));
        }
      }
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
    memberTokenRef.current = null; memberAccountRef.current = null;
    activeClerkSubjectRef.current = null;
    setToken(null); setAccountId(null); setState((s) => expireLocalSession(s));
    try {
      await clearAccountLocal(sessionStorage);
      if (cleanup.current()) setStorageReady(true);
    } catch {
      if (cleanup.current()) setState((s) => ({ ...s, error: "Session expired. Device cleanup failed; retry signing out." }));
    } finally { cleanup.release(); }
  }

  async function refreshRun(t: string, runId: string, openingState?: UiState, requireOwnedSnapshot = false) {
    let credential: () => string;
    try { credential = memberAuthority(); }
    catch (error) { if (requireOwnedSnapshot) throw error; return; }
    const currentBearer = credential();
    if (!api.currentRun(currentBearer, runId)) {
      if (requireOwnedSnapshot) throw new SupersededRequest();
      return;
    }
    const key = `${currentBearer}:${runId}`;
    if (refreshing.current.has(key) && !requireOwnedSnapshot) return;
    const attempt = Symbol(); refreshing.current.set(key, attempt);
    let guard = api.captureView();
    const currentReader = () => {
      try { return guard.current() && api.currentRun(credential(), runId); }
      catch { return false; }
    };
    try {
      const readCredential = credential();
      const snap = await api.getRun(readCredential, runId);
      // A same-member renewal keeps the reader, but an older response must
      // not paint over a newer poll that used the replacement bearer.
      if (!currentReader() || api.currentCredential() !== readCredential) throw new SupersededRequest();
      if (snap?.runId !== runId) throw new Error("The accepted run identity did not match. Retry the saved request.");
      if (snap.contentInvalidated === true) {
        // Cancel older source/correction callbacks without changing the selected run.
        api.invalidateView(credential()); guard.release(); guard = api.captureView();
      }
      const invalidated = await applyRemoteInvalidation(latestUi.current.run?.runId === runId ? latestUi.current : openingState ?? latestUi.current, snap, {
        current: currentReader,
        hide: () => {
          redactingContent.current = true; setStorageReady(false);
          setViewState(s => guard.current() && s.run?.runId === runId ? redactInvalidatedContent({ ...s, run: snap }, runId) : s);
          setCorrectionSelection(previous => currentReader() ? { owner: memberAccountRef.current, parent: runId, files: [] } : previous);
        },
        save: (redacted, id) => sessionStorage.redactRunContent(credential(), id, redacted),
      });
      if (!currentReader()) throw new SupersededRequest();
      if (invalidated) {
        setViewState(s => guard.current() && s.run?.runId === runId ? { ...redactInvalidatedContent(s, runId), pendingContentInvalidation: null, offline: false } : s);
        redactingContent.current = false; setStorageReady(true); stopPolling();
        if (requireOwnedSnapshot) throw new Error("The accepted run is unavailable because its content was deleted.");
        return;
      }
      const ev = await api.events(credential(), runId, 0);
      if (!currentReader()) throw new SupersededRequest();
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
      if (sameSnapshot && !currentUi.offline && !requireOwnedSnapshot) return;
      const report = snap.reportId && currentUi.report?.reportId !== snap.reportId
        ? await api.report(credential(), snap.reportId)
        : snap.reportId && currentUi.report?.reportId === snap.reportId
          ? null
          : null;
      const applyOwnedSnapshot = (s: UiState): UiState => {
        if (s.pendingContentInvalidation) throw new Error("Deleted content cleanup must finish before this run can be opened.");
        if (!s.signedIn || s.pendingSourceDeletion || deletingSource.current || !currentReader()) throw new SupersededRequest();
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

        return next.offline ? { ...next, offline: false, error: null } : next;
      };
      if (requireOwnedSnapshot) {
        const next = applyOwnedSnapshot(openingState ?? latestUi.current);
        await sessionStorage.persistRequired(credential(), next);
        if (!currentReader()) throw new SupersededRequest();
        latestUi.current = next;
        setViewState(next);
        return next;
      }
      setViewState((s) => {
        if (!guard.current()) return s;
        try {
          return applyOwnedSnapshot(s);
        } catch (error) {
          if (isSupersededRequest(error)) return s;
          return { ...s, error: error instanceof Error ? error.message : "Pending search approval is invalid. Public search will not continue." };
        }
      });
    } catch (e) {
      if (isSupersededRequest(e) || !guard.current()) {
        if (requireOwnedSnapshot) throw new SupersededRequest();
        return;
      }
      if (redactingContent.current) {
        setViewState(s => guard.current() ? { ...s, error: "Deleted source content is hidden. Disk cleanup is unconfirmed; reconnect or reopen to retry before starting research." } : s);
        if (requireOwnedSnapshot) throw e;
        return;
      }
      if (isExpiredSession(e)) {
        await onAuthFailure();
        if (requireOwnedSnapshot) throw e;
      }
      else if (isOfflineError(e)) {
        setViewState((s) => {
          const next = { ...s, offline: true, error: (e as Error).message };

          return next;
        });
        if (requireOwnedSnapshot) throw e;
      } else {
        setViewState((s) => ({ ...s, error: (e as Error).message }));
        if (requireOwnedSnapshot) throw e;
      }
    } finally { guard.release(); if (refreshing.current.get(key) === attempt) refreshing.current.delete(key); }
  }

  function stopPolling() {
    if (poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  }

  function startPolling(t: string, runId: string) {
    const owner = memberAccountRef.current;
    if (!owner || !api.currentRun(memberTokenRef.current ?? t, runId)) return;
    stopPolling();
    poll.current = setInterval(() => {
      if (memberAccountRef.current !== owner) { stopPolling(); return; }
      void refreshRun(memberTokenRef.current ?? t, runId);
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
    let hydration = api.capture();
    void Promise.resolve().then(clearDocumentPickerCache).then(async () => {
      let guest = await guestDevice.load();
      const member = await hydrateOnLaunch(sessionStorage);
      if (!hydration.current()) return;
      for (let i = 0; authRef.current && !authRef.current.loaded && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 100));
      let memberToken: string | null = null, memberAccountId: string | null = null;
      if (authRef.current?.loaded && authRef.current.signedIn) {
        try {
          const fresh = await authRef.current.getToken();
          if (fresh) {
            const identity = await api.verifyMemberSession(fresh);
            if (!hydration.current()) return;
            api.activateSession(fresh, identity.accountId);
            hydration.release(); hydration = api.capture();
            await activateLocalSession(sessionStorage, { token: fresh, accountId: identity.accountId });
            if (!hydration.current()) return;
            memberToken = fresh; memberAccountId = identity.accountId;
          }
        } catch { /* Existing private snapshots remain held until a verified session returns. */ }
      }
      if (!hydration.current()) return;
      if (!memberToken) {
        api.activateSession(null);
        hydration.release(); hydration = api.capture();
      }
      // The child snapshot is committed before the terminal journal. If a
      // process dies before guest cleanup, a verified matching member may
      // finish that cleanup without resurrecting the preclaim guest reader.
      if (guest?.pendingAction?.phase === "dispatched" && memberToken && member.accountId === memberAccountId &&
          guest.pendingAction.authenticatedAccountId === memberAccountId && member.state.run?.runId && member.state.conversationId) {
        await guestDevice.clear(); api.clearGuest(); guest = null;
      }
      // A protected guest reader can be bound to member A before the last
      // cleanup write. Retain that journal on disk, but never render or use it
      // under a verified member B. A later rightful sign-in can still recover.
      const heldForOtherMember = !!(guest?.pendingAction?.authenticatedAccountId && memberToken &&
        guest.pendingAction.authenticatedAccountId !== memberAccountId);
      if (heldForOtherMember) { api.clearGuest(); guest = null; }
      let saved = guest ? guest.state : memberToken && member.accountId === memberAccountId ? { ...member.state, signedIn: true }
        : { ...emptyState(), draft: heldForOtherMember ? "" : member.state.draft, signedIn: !!memberToken };
      if (heldForOtherMember) saved = { ...saved, error: "Saved research for another account is held on this device. Switch back to that account to continue it." };
      if (guest) {
        api.activateGuest(guest.proof, guest.context.guestContextId);
        guestContextRef.current = guest.context; guestProof.current = guest.proof;
        guestPendingRef.current = guest.pendingAction; guestFirstRequest.current = guest.firstRequest;
        abandonedGuestActions.current = guest.abandonedActions;
        if (guest.pendingAction?.payload.kind === "clarification") setClarifyAnswer(guest.pendingAction.payload.text);
        guestDraftRevision.current = guest.draftRevision;
        setGuestContext(guest.context); setGuestPending(guest.pendingAction);
        saved = { ...saved, signedIn: !!memberToken, consentGranted: memberToken ? false : guest.state.consentGranted };
      }
      const restored = api.capture();
      setStorageReady(!saved.pendingContentInvalidation);
      redactingContent.current = !!saved.pendingContentInvalidation;
      memberTokenRef.current = memberToken; memberAccountRef.current = memberAccountId;
      activeClerkSubjectRef.current = memberToken ? authRef.current?.subject ?? null : null;
      setToken(memberToken); setAccountId(memberAccountId);
      latestUi.current = saved; setStateRaw(saved);
      if (guest?.pendingAction && !["dispatched", "cancelled", "rejected", "expired"].includes(guest.pendingAction.phase)) {
        setGuestSheetState(initialGuestSignInSheetState());
        setGuestSheetVisible(guest.pendingAction.phase !== "authenticating");
      }
      // The process may have died after Clerk succeeded but before the local
      // journal moved out of authenticating. Resolve the exact durable attempt
      // before any claim, resend, or new provider work. If Clerk did not
      // succeed, terminalize that attempt on the server before reopening the
      // same submission. An unknown response keeps it held and dismissible.
      if (guest?.pendingAction?.phase === "authenticating" && guest.pendingAction.authAttempt) {
        const original = guest.pendingAction;
        const attemptId = guest.pendingAction.authAttempt.id;
        try {
          const resolved = await api.guest.resolveAuthAttempt(guest.proof, original.submissionId, attemptId);
          if (!mounted || !hydration.current()) return;
          if (resolved.submissionId !== original.submissionId || resolved.authAttemptId !== attemptId ||
            !Number.isSafeInteger(resolved.attemptRevision) || resolved.attemptRevision < 1 ||
            !["authenticating", "cancelled", "dismissed"].includes(resolved.state)) throw new Error("The saved sign-in attempt readback did not match its journal.");
          const current = guestPendingRef.current;
          if (!current || current.phase !== "authenticating" || current.submissionId !== original.submissionId || current.authAttempt?.id !== attemptId) return;
          if (resolved.state === "cancelled" || resolved.state === "dismissed") {
            await saveGuestPending(resolved.state === "cancelled" ? cancelGuestAuthAttempt(current, attemptId, new Date()) : dismissGuestPendingAction(current, new Date()), current);
            setGuestSheetVisible(resolved.state === "cancelled");
          } else if (memberToken && original.autoResume) {
            await finishGuestAuthentication(attemptId);
          } else if (authRef.current?.sessionTaskPending && original.autoResume) {
            taskContinuationAttempt.current = attemptId;
            setTaskContinuationId(attemptId);
            setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling" });
            setGuestSheetVisible(true);
          } else {
            await endGuestAuthAttempt(attemptId, original.autoResume ? "cancelled" : "dismissed");
            setGuestSheetVisible(original.autoResume);
          }
        } catch (error) {
          // The claim flow re-activates the member session, which retires the
          // hydration lease; the durable journal IDs below (not the lease) are
          // the fence against stale handling, so post-claim failures still
          // surface while the component is mounted.
          if (!mounted) return;
          const current = guestPendingRef.current;
          const message = error instanceof Error ? error.message : "The saved sign-in attempt is held until it can be checked.";
          if (current?.phase === "authenticating" && current.submissionId === original.submissionId && current.authAttempt?.id === attemptId) {
            setGuestSheetState({ ...initialGuestSignInSheetState(), step: "reconciling",
              error: "The saved sign-in attempt is held. Close this sheet to confirm cancellation before trying again." });
            setGuestSheetVisible(true);
            setStateRaw(s => ({ ...s, error: message }));
          } else {
            // A post-claim failure (funding denial, unknown continuation, or
            // any other held outcome) must still surface its exact message;
            // the journal keeps the exact IDs for reconciliation.
            setStateRaw(s => ({ ...s, error: message }));
          }
          setStateRaw(s => ({ ...s, error: error instanceof Error ? error.message : "The saved sign-in attempt is held until it can be checked." }));
        }
      }
      if (saved.run?.runId && !saved.pendingSourceDeletion) {
        if (guest && !memberToken) { guestRunEpoch.current++; startGuestPolling(saved.run.runId); void refreshGuestRun(saved.run.runId); }
        else if (memberToken && !guest?.pendingAction) { api.selectRun(saved.run.runId); void refreshRun(memberToken, saved.run.runId, saved); startPolling(memberToken, saved.run.runId); }
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

  useEffect(() => {
    let current = true;
    void api.authCapabilities().then(value => {
      if (!current) return;
      setGuestCapabilities({
        apple: value.apple === true, google: value.google === true, emailCode: value.emailCode === true,
        termsUrl: typeof value.termsUrl === "string" ? value.termsUrl : null,
        privacyUrl: typeof value.privacyUrl === "string" ? value.privacyUrl : null,
      });
    }).catch(() => { /* All providers remain unavailable until capability readback. */ });
    return () => { current = false; };
  }, []);

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
    if (token && savedSecondMessageBlocksWork()) {
      submitting.current = true;
      let replaced = false;
      try {
        if (!accountId) throw new Error("Account identity is unavailable.");
        const credential = memberAuthority(accountId);
        const saved = guestPendingRef.current;
        if (saved?.payload.kind === "clarification") {
          await continueMemberClarification(credential(), accountId);
        } else if (saved && (saved.phase === "cancelled" || (current.draft.trim() !== saved.payload.text ||
          saved.payload.kind === "follow_up" && current.run?.runId !== saved.payload.parentRunId))) {
          if (saved.phase !== "cancelled") await abandonSavedGuestAction(saved, credential());
          const adopted = { ...current, signedIn: true };
          await sessionStorage.persistRequired(credential(), adopted);
          await guestDevice.clear(); api.clearGuest();
          guestContextRef.current = null; guestProof.current = null; guestPendingRef.current = null;
          setGuestContext(null); setGuestPending(null);
          latestUi.current = adopted; setStateRaw(adopted);
          replaced = true;
        } else await continueSavedSecondMessage(credential(), accountId);
      }
      catch (error) { setViewState(s => ({ ...s, error: error instanceof Error ? error.message : "The saved second message remains held." })); }
      finally { submitting.current = false; }
      if (replaced) await onSend();
      return;
    }
    if (!token) {
      if (guestContextRef.current?.acceptedTurnCount === 1) {
        await captureGuestSecondAction({ kind: "new_research", text: current.draft.trim() });
      } else await onGuestFirstSend();
      return;
    }
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
      const credential = memberAuthority(accountId);
      const guard = api.captureView();
      let created;
      let sentText = (current.pendingAdmission?.question ?? current.draft).trim();
      try {
        const pending = current.pendingAdmission ?? await prepareAdmission(current.draft, current.routeMode, current.attachments, newId, nativeDocumentDigest, guard.current);
        sentText = pending.question.trim();
        created = await submitAdmission(pending, current.attachments, {
          digest: nativeDocumentDigest,
          preflight: async () => {
            const settings = await api.settings(credential());
            if (!guard.current()) throw new SupersededRequest();
            setState(s => guard.current() ? { ...s, offline: false } : s);
            return settings;
          },
          current: guard.current,
          progress: setUploadStatus,
          save: async draft => {
            await sessionStorage.saveAdmission(credential(), draft);
            if (!guard.current()) throw new SupersededRequest();
            setState(s => ({ ...s, pendingAdmission: draft, attachments: s.pendingAdmission ? s.attachments : s.attachments.map((f,i) => ({ ...f, id: draft.uploads[i]?.key })) }));
          },
          upload: (file, key) => file.bytes ? api.attachBytes(credential(), file.filename, file.mime, file.bytes, key) : api.attach(credential(), file.filename, file.mime, file.text, key),
          admit: (draft, ids) => api.createRun(credential(), draft.question, draft.routeMode, draft.key, ids, current.conversationId),
        });
        if (!guard.current()) throw new SupersededRequest();
      } finally { guard.release(); }
      await adoptAdmission(credential(), created, credential, sentText);
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

  async function adoptAdmission(t: string, created: AdmittedRun, credential = memberAuthority(), sentText?: string): Promise<void> {
      const guard = api.captureView();
      try {
      const current = latestUi.current;
      // Merge the accepted run into the latest still-owned state. Text typed
      // while the admission was in flight survives; only an unchanged send clears.
      const sent = (sentText ?? current.pendingAdmission?.question ?? current.draft).trim();
      const next: UiState = {
          ...current,
          pendingAdmission: null,
          status: "progress" as const,
          error: null,
          draft: current.draft.trim() === sent ? "" : current.draft,
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
      await sessionStorage.finishAdmission(credential(), next);
      if (!guard.current()) throw new SupersededRequest();
      api.selectRun(created.runId);
      setSentQuestion(sent);
      setViewState(next);
      setShowAttach(false);
      AccessibilityInfo.announceForAccessibility(
        "Research in progress. Cancel is available. Closing the app will not stop the job.",
      );
      await refreshRun(credential(), created.runId, next);
      startPolling(credential(), created.runId);
      } finally { guard.release(); }
  }

  async function resolvePendingAdmission() {
    if (!token || !state.pendingAdmission || submitting.current || !storageReady) return;
    const guard = api.captureView(); submitting.current = true; setUploadStatus("Checking saved request…");
    try {
      const credential = memberAuthority(accountId);
      const result = await api.resolveRunRequest(credential(), state.pendingAdmission.key);
      if (!guard.current()) throw new SupersededRequest();
      if (result.status === "accepted") await adoptAdmission(credential(), readAdmittedRun(result.run), credential, state.pendingAdmission.question);
      else if (result.status === "withdrawn") {
        await sessionStorage.saveAdmission(credential(), null);
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
    if (!token && guestContextRef.current && state.run) {
      try { const { proof } = currentGuest(); await api.guest.cancel(proof, state.run.runId); await refreshGuestRun(state.run.runId); }
      catch { setStateRaw(s => ({ ...s, error: "Could not confirm cancellation. Reopen this guest research to check it." })); }
      return;
    }
    if (!token || !state.run) return;
    // Cancellation is a new view authority boundary even though the same run stays selected.
    // This fences an accepted mutation that has not yet completed its child handoff.
    try {
      const credential = memberAuthority();
      api.invalidateView(credential());
      await api.cancel(credential(), state.run.runId);
      await refreshRun(credential(), state.run.runId);
    }
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
        else if (guestContextRef.current && runId) void refreshGuestRun(runId);
      } catch (error) {
        if (isOfflineError(error)) setState((s) => ({ ...s, offline: true, error: null }));
        else if (!isSupersededRequest(error)) setState((s) => ({ ...s, error: (error as Error).message }));
      }
      return;
    }
    const runId = latestUi.current.run?.runId;
    if (!token && guestContextRef.current && runId && (kind === "waiting" || kind === "failed")) { void refreshGuestRun(runId); return; }
    if (token && runId && (kind === "waiting" || kind === "failed")) {
      void refreshRun(token, runId);
      return;
    }
    if (kind === "failed" && latestUi.current.draft.trim()) void onSend();
  }

  async function onDeleteSource(target?: SourceDeletionTarget) {
    if (!token && guestContextRef.current && state.run && target) {
      try {
        const { proof } = currentGuest();
        if (!sameSourceDeletionTarget(target, sourceDeletionTarget(state.source))) throw new Error("The source changed. Review deletion again.");
        const redacted = redactInvalidatedContent(latestUi.current, state.run.runId);
        await saveGuestReader(redacted);
        stopPolling();
        await api.guest.deleteSource(proof, target.sourceId);
        setStateRaw(s => ({ ...s, error: "Source deleted. Reopen research after cleanup completes." }));
      } catch { setStateRaw(s => ({ ...s, error: "Source content remains hidden. Deletion outcome is unconfirmed; check it again." })); }
      return;
    }
    if (!token || !storageReady || deletingSource.current || submitting.current || pickingDocument.current || verifying.current || state.pendingVerification || state.pendingCorrectionDocuments || correctionAttempt.current) return;
    const guard = api.capture();
    try {
      const credential = memberAuthority();
      if (target && !sameSourceDeletionTarget(target, sourceDeletionTarget(state.source))) throw new Error("The source changed. Review deletion again.");
      const pending = state.pendingSourceDeletion ? state : prepareSourceDeletion(state, target?.sourceId ?? "");
      deletingSource.current = true; setSourceDeleteBusy(true);
      stopPolling(); api.closeSource(); api.selectRun(null);
      const confirmed = await submitSourceDeletion(pending, {
        current: guard.current,
        save: next => sessionStorage.persistRequired(credential(), next),
        hide: next => { setAttachText(""); setAttachName("note.txt"); setShowAttach(false); setState(s => guard.current() ? next : s); },
        remove: id => api.deleteSource(credential(), id),
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
        if (!guestContextRef.current) { setViewState((s) => ({ ...s, error: "Open a current research run to inspect sources." })); return; }
        const { proof } = currentGuest();
        if (state.report) persistAnchor(state.report.reportId, blockId);
        sourceFocus.current.open(JSON.stringify([blockId, id]));
        const src = readSourceDetail(await api.guest.source(proof, id));
        setViewState(s => ({ ...s, source: src, tab: "research" }));
        AccessibilityInfo.announceForAccessibility(`Source sheet. ${src.title}. ${src.accessLevel}.`);
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
    if (!token || !accountId || !storageReady || pickingDocument.current || correctionAttempt.current || submitting.current || verifying.current || deletingSource.current || state.pendingContentInvalidation || state.pendingSourceDeletion || state.pendingVerification || state.pendingAdmission) return;
    if (correctionFiles.length >= 3) return;
    const guard = api.captureView(); pickingDocument.current = true; setDocumentPending(true);
    try {
      const file = await pickDocument(guard.current);
      if (file && guard.current()) setCorrectionSelection(previous => adoptCorrectionFile(previous, accountId, correctionParent, file, guard.current));
    } catch (e) {
      if (guard.current() && !isSupersededRequest(e)) setViewState(s => ({ ...s, error: (e as Error).message }));
    } finally { guard.release(); pickingDocument.current = false; setDocumentPending(false); }
  }

  async function adoptDocumentCorrection(runId: string) {
    if (!token) return;
    const credential = memberAuthority();
    api.selectRun(runId);
    const guard = api.captureView();
    try {
      const next = await adoptCorrectionSnapshot(runId, state, {
        current: guard.current, get: () => api.getRun(credential(), runId), finish: next => sessionStorage.finishCorrectionDocuments(credential(), next),
      });
      setState(next); setCorrectionFiles([]);
      await refreshRun(credential(), runId, next); startPolling(credential(), runId);
    } finally { guard.release(); }
  }

  async function resolveDocumentCorrection() {
    const pending = state.pendingCorrectionDocuments;
    if (!token || !pending || correctionAttempt.current || pickingDocument.current) return;
    api.selectRun(pending.parentRunId);
    const guard = api.captureView(), attempt = Symbol("resolve document correction");
    correctionAttempt.current = attempt; setCorrectionPending(true);
    try {
      const credential = memberAuthority();
      const result = await resolveCorrectionDocuments(pending, state, {
        current: guard.current, read: () => sessionStorage.readCorrectionDocuments(credential()),
        resolve: (durable, attachmentIds) => api.resolveCorrection(credential(), durable.parentRunId, durable.baseRevision, durable.upload.question,
          { kind: "append_attachments", attachmentIds, evidencePolicy: "reuse_snapshot" }),
        finish: next => sessionStorage.finishCorrectionDocuments(credential(), next),
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
      const credential = memberAuthority();
      const durable = await authoritativeCorrection(state.pendingCorrectionDocuments, pendingParent, {
        current: guard.current, read: () => sessionStorage.readCorrectionDocuments(credential()),
      });
      const pending = durable ?? await prepareCorrectionDocuments(pendingParent, state.run.brief!.revision, files, newId, nativeDocumentDigest, guard.current);
      const runId = await submitCorrectionDocuments(pending, files, {
        current: guard.current, digest: nativeDocumentDigest, progress: setUploadStatus,
        preflight: () => api.settings(credential()),
        save: async saved => {
          await sessionStorage.saveCorrectionDocuments(credential(), saved);
          if (!guard.current()) throw new SupersededRequest();
          setState(s => ({ ...s, pendingCorrectionDocuments: saved }));
        },
        upload: (file, key) => file.bytes ? api.attachBytes(credential(), file.filename, file.mime, file.bytes, key) : api.attach(credential(), file.filename, file.mime, file.text, key),
        correct: (parent, revision, text, attachmentIds) => api.correct(credential(), parent, revision, text, { kind: "append_attachments", attachmentIds, evidencePolicy: "reuse_snapshot" }),
      });
      if (!guard.current()) throw new SupersededRequest();
      await adoptDocumentCorrection(runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setState(s => ({ ...s, error: (e as Error).message }));
    } finally { guard.release(); setUploadStatus(null); if (correctionAttempt.current === attempt) { correctionAttempt.current = null; setCorrectionPending(false); } }
  }

  async function onCorrect(submitted?: string, retrySaved = false) {
    if (savedSecondMessageBlocksWork()) { setViewState(s => ({ ...s, error: "The saved second message must be resolved before another correction." })); return; }
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
    const pending = unresolvedCorrection(current.pendingCorrection) ? current.pendingCorrection! : null;
    const text = (retrySaved && pending ? pending.question : submitted ?? correction).trim();
    if (!text) {
      setViewState((s) => ({ ...s, error: "Write a correction first. The draft and last report stay on this device." }));
      return;
    }
    if (pending && !retrySaved && (pending.question !== text || pending.parentRunId !== current.run.runId)) {
      setViewState((s) => ({ ...s, error: "Retry the saved correction before sending a different request." }));
      return;
    }
    if(!pending&&(!correctionReady||!current.run.brief?.revision)) {
      setViewState((s)=>({...s,error:"Corrections are unavailable for this run. Refresh its status before trying again."}));return;
    }
    const parentRunId = pending?.parentRunId ?? current.run.runId;
    const expectedBriefRevision = pending?.expectedBriefRevision ?? current.run.brief!.revision;
    const selectedEvidencePolicy = pending?.evidencePolicy ?? evidencePolicy;
    const credential = memberAuthority();
    if (retrySaved && !api.currentRun(credential(), parentRunId)) api.selectRun(parentRunId);
    const attempt=Symbol("correction");
    let guard: ViewHandle = api.captureView(credential(), parentRunId);
    correctionAttempt.current=attempt;setCorrectionPending(true);
    try {
      const adopted = await runPendingCorrection({
        pending,
        parentRunId,
        question: text,
        expectedBriefRevision,
        evidencePolicy: selectedEvidencePolicy,
        current: () => guard.current(),
        save: async (saved) => {
          await persistMutationJournal(token, guard, "pendingCorrection", saved, parentRunId);
        },
        post: (parentRunId, question, expectedBriefRevision, policy, idempotencyKey) =>
          api.correct(credential(), parentRunId, expectedBriefRevision, question,
            correctionMode==="replace_question"?{kind:"replace_question",question,evidencePolicy:policy}:undefined,
            idempotencyKey),
        adopt: async (body) => {
          await adoptReturnedChild({
            parentRunId,
            body,
            requireRunId: true,
            selectRun: api.selectRun,
            captureView: (runId) => api.captureView(credential(), runId),
            onView: (next) => { guard.release(); guard = next; },
            currentRun: (runId) => api.currentRun(credential(), runId),
            refresh: async (runId) => {
              api.closeSource();
              setShowAttach(false);
              setSentQuestion(text);
              const opening = {
                ...latestUi.current,
                status: "progress" as const,
                draft: latestUi.current.draft.trim() === text ? "" : latestUi.current.draft,
                error: null,
                events: [],
                source: null,
                readingAnchor: null,
                report: null,
                previousReport: latestUi.current.report
                  ? { reportId: latestUi.current.report.reportId, blocks: latestUi.current.report.blocks }
                  : latestUi.current.previousReport,
                run: {
                  runId,
                  lifecycle: "queued" as const,
                  phase: "preparing",
                  outcome: null,
                  reportId: null,
                  labeledDemo: latestUi.current.run?.labeledDemo === true,
                },
              };
              latestUi.current = opening;
              setViewState(opening);
              await refreshRun(credential(), runId, opening, true);
            },
            poll: (runId) => startPolling(credential(), runId),
          });
        },
      });
      if (!guard.current()) throw new SupersededRequest();
      const finished = { ...latestUi.current, pendingCorrection: adopted.phase === "adopted" ? null : adopted, correctionDraft: null };
      await sessionStorage.persistRequired(credential(), finished);
      if (!guard.current()) throw new SupersededRequest();
      latestUi.current = finished;
      setViewState(finished);
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
    if (savedSecondMessageBlocksWork()) { setViewState(s => ({ ...s, error: "Finish or reconcile the saved second message before starting new research." })); return; }
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
    if (token && savedSecondMessageBlocksWork()) { await onSend(); return; }
    if (!token && guestContextRef.current?.acceptedTurnCount === 1) {
      const pendingInput = latestUi.current.run?.pendingInput;
      const text = clarifyAnswer.trim();
      if (!pendingInput || pendingInput.type !== "clarification" || !pendingInput.field || !text) {
        setStateRaw(s => ({ ...s, error: "Answer the exact requested detail before continuing guest research." }));
        return;
      }
      await captureGuestSecondAction({ kind: "clarification", text, pendingInputId: pendingInput.id, briefRevision: pendingInput.briefRevision, field: pendingInput.field });
      return;
    }
    if (!token || !state.run || clarifying.current) return;
    if (queryAuthorizationPending(latestUi.current.run) || queryAuthorizationPending(state.run)) {
      setViewState((s) => ({ ...s, error: "Approve the exact search terms before public search can continue." }));
      return;
    }
    if (latestUi.current.offline) {
      setViewState((s) => ({ ...s, error: "You are offline. The draft and last report stay on this device." }));
      return;
    }
    if (!latestUi.current.consentGranted) {
      setViewState((s) => ({ ...s, error: "Consent to AI processing is required before continuing this research.", tab: "settings" }));
      return;
    }
    const runId = state.run.runId;
    const answer = clarifyAnswer.trim();
    const field = state.run.pendingInput?.field;
    const credential = memberAuthority();
    if (editingAssumptions) {
      const values = clarifyAnswer.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!values.length) {
        setViewState((s) => ({ ...s, error: "Enter the assumptions to keep." }));
        return;
      }
      clarifying.current = true;
      let guard: ViewHandle = api.captureView(credential(), runId);
      try {
        const revision = state.run.brief?.revision;
        if (!revision) throw new Error("Refresh this run before replacing assumptions.");
        const adopted = await runAssumptionsMutation({
          pending: latestUi.current.pendingAssumptions,
          parentRunId: runId,
          action: "replace",
          values,
          expectedBriefRevision: revision,
          current: () => guard.current(),
          save: async (saved) => {
            await persistMutationJournal(token, guard, "pendingAssumptions", saved, runId);
          },
          post: (parentRunId, body, idempotencyKey) => api.confirmAssumptions(credential(), parentRunId, body, idempotencyKey),
          adopt: async (body) => {
            await adoptReturnedChild({
              parentRunId: runId,
              body,
              requireRunId: true,
              selectRun: api.selectRun,
              captureView: (acceptedRunId) => api.captureView(credential(), acceptedRunId),
              onView: (next) => { guard.release(); guard = next; },
              currentRun: (acceptedRunId) => api.currentRun(credential(), acceptedRunId),
              refresh: async (acceptedRunId) => {
                if (acceptedRunId === runId) {
                  await refreshRun(credential(), acceptedRunId, undefined, true);
                  return;
                }
                const opening = {
                  ...latestUi.current,
                  status: "progress" as const,
                  events: [],
                  source: null,
                  readingAnchor: null,
                  report: null,
                  previousReport: latestUi.current.report
                    ? { reportId: latestUi.current.report.reportId, blocks: latestUi.current.report.blocks }
                    : latestUi.current.previousReport,
                };
                latestUi.current = opening;
                setViewState(opening);
                await refreshRun(credential(), acceptedRunId, opening, true);
              },
              poll: (runId) => startPolling(credential(), runId),
            });
          },
        });
        const finished = { ...latestUi.current, pendingAssumptions: adopted.phase === "adopted" ? null : adopted };
        await sessionStorage.persistRequired(credential(), finished);
        if (!guard.current()) throw new SupersededRequest();
        latestUi.current = finished;
        setViewState({ ...finished, pendingAssumptions: null, error: null });
        setEditingAssumptions(false);
        setClarifyAnswer("");
        AccessibilityInfo.announceForAccessibility("Assumptions updated.");
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
      const guard = api.captureView(credential(), runId);
      try {
        const revision = state.run.brief?.revision;
        if (!revision) throw new Error("Refresh this run before confirming assumptions.");
        const adopted = await runAssumptionsMutation({
          pending: latestUi.current.pendingAssumptions,
          parentRunId: runId,
          action: "confirm",
          expectedBriefRevision: revision,
          current: () => guard.current(),
          save: async (saved) => {
            await persistMutationJournal(token, guard, "pendingAssumptions", saved, runId);
          },
          post: (parentRunId, body, idempotencyKey) => api.confirmAssumptions(credential(), parentRunId, body, idempotencyKey),
          adopt: async () => {
            AccessibilityInfo.announceForAccessibility("Assumptions confirmed.");
            await refreshRun(credential(), runId, undefined, true);
          },
        });
        const finished = { ...latestUi.current, pendingAssumptions: adopted.phase === "adopted" ? null : adopted };
        await sessionStorage.persistRequired(credential(), finished);
        if (!guard.current()) throw new SupersededRequest();
        latestUi.current = finished;
        setViewState({ ...finished, pendingAssumptions: null, error: null });
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
      await api.continueRun(credential(), state.run.runId, continueRunRequest({
        pendingInput: state.run.pendingInput,
        value: answer,
      }));
      setViewState((s) => {
        const next = { ...s, status: "progress" as const, error: null };

        return next;
      });
      AccessibilityInfo.announceForAccessibility("Clarification saved. Research continues on the server.");
      await refreshRun(credential(), state.run.runId);
      startPolling(credential(), state.run.runId);
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

  async function retryPendingAssumptions() {
    const current = latestUi.current;
    const pending = unresolvedAssumptions(current.pendingAssumptions) ? current.pendingAssumptions! : null;
    if (!token || !pending || clarifying.current || current.pendingContentInvalidation || current.pendingSourceDeletion) return;
    if (current.offline) {
      setViewState((s) => ({ ...s, error: "You are offline. The saved assumption change remains on this device." }));
      return;
    }
    if (!current.consentGranted) {
      setViewState((s) => ({ ...s, error: "Consent to AI processing is required before retrying this assumption change.", tab: "settings" }));
      return;
    }
    clarifying.current = true;
    const credential = memberAuthority();
    if (!api.currentRun(credential(), pending.parentRunId)) api.selectRun(pending.parentRunId);
    let guard: ViewHandle = api.captureView(credential(), pending.parentRunId);
    try {
      const adopted = await runAssumptionsMutation({
        pending,
        parentRunId: pending.parentRunId,
        action: pending.action,
        values: pending.values,
        expectedBriefRevision: pending.expectedBriefRevision,
        current: () => guard.current(),
        save: async (saved) => {
          await persistMutationJournal(token, guard, "pendingAssumptions", saved, pending.parentRunId);
        },
        post: (parentRunId, body, idempotencyKey) => api.confirmAssumptions(credential(), parentRunId, body, idempotencyKey),
        adopt: async (body) => {
          if (pending.action === "replace") {
            await adoptReturnedChild({
              parentRunId: pending.parentRunId,
              body,
              requireRunId: true,
              selectRun: api.selectRun,
              captureView: (acceptedRunId) => api.captureView(credential(), acceptedRunId),
              onView: (next) => { guard.release(); guard = next; },
              currentRun: (acceptedRunId) => api.currentRun(credential(), acceptedRunId),
              refresh: (acceptedRunId) => refreshRun(credential(), acceptedRunId, undefined, true).then(() => undefined),
              poll: (acceptedRunId) => startPolling(credential(), acceptedRunId),
            });
          } else {
            await refreshRun(credential(), pending.parentRunId, undefined, true);
          }
        },
      });
      const finished = { ...latestUi.current, pendingAssumptions: adopted.phase === "adopted" ? null : adopted, error: null };
      await sessionStorage.persistRequired(credential(), finished);
      if (!guard.current()) throw new SupersededRequest();
      latestUi.current = finished;
      setViewState(finished);
      setEditingAssumptions(false);
      setClarifyAnswer("");
      AccessibilityInfo.announceForAccessibility("Saved assumption change restored.");
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) setViewState((s) => ({ ...s, offline: true, error: "You are offline. The saved assumption change remains on this device." }));
      else setViewState((s) => ({ ...s, error: e instanceof Error ? e.message : "Could not restore the saved assumption change." }));
    } finally {
      guard.release();
      clarifying.current = false;
    }
  }

  async function adoptVerification(pending: PendingVerificationRequest, runId: string) {
    if (!token) return;
    const credential = memberAuthority();
    if (runId === pending.parentRunId) throw new Error("Verification resolved to its parent instead of a child. Retry the saved request.");
    api.selectRun(runId);
    const guard = api.captureView();
    try {
      const snap = readVerificationRun(await api.getRun(credential(), runId), runId);
      if (!guard.current()) throw new SupersededRequest();
      let next = applySnapshot({ ...state, pendingVerification: null, previousReport: state.report ? { reportId: state.report.reportId, blocks: state.report.blocks } : state.previousReport, report: null, source: null, events: [], readingAnchor: null, correctionDraft: null }, snap);
      next = { ...next, error: null, offline: false, tab: "research" };
      await sessionStorage.persistRequired(credential(), next);
      if (!guard.current()) throw new SupersededRequest();
      setState(next);
      await refreshRun(credential(), runId, next); startPolling(credential(), runId);
    } finally { guard.release(); }
  }

  async function onExplainFollowUp(message: string, retrySaved = false) {
    const current = latestUi.current;
    if (!token || !current.run || followUpBusy.current) return;
    if (!current.consentGranted) {
      setViewState((s) => ({ ...s, error: "Consent to AI processing is required before sending or retrying a follow-up.", tab: "settings" }));
      return;
    }
    const pending = unresolvedFollowUp(current.pendingFollowUp) ? current.pendingFollowUp! : null;
    const text = (retrySaved && pending ? pending.message : message).trim();
    if (!text) return;
    followUpBusy.current = true;
    const parentRunId = retrySaved && pending ? pending.parentRunId : current.run.runId;
    const runActive = current.run.lifecycle === "queued" || current.run.lifecycle === "running";
    const reportReady = composerFollowsReport(current);
    const routed = routeFollowUp(text, { reportReady, runActive });
    const mutationKind = retrySaved && pending?.kind ? pending.kind : routed.kind;
    const mutates = mutationKind === "deepen" || mutationKind === "steer" || mutationKind === "add_source" || mutationKind === "change_constraint";
    const credential = memberAuthority();
    if (retrySaved && pending && !api.currentRun(credential(), parentRunId)) api.selectRun(parentRunId);
    let guard: ViewHandle = api.captureView(credential(), parentRunId);
    try {
      const revision = retrySaved && pending ? pending.expectedBriefRevision : current.run.brief?.revision;
      if (mutates) {
        if (typeof revision !== "number") throw new Error("Refresh this run before sending additional research.");
        if (pending && !retrySaved
          && (pending.parentRunId !== parentRunId || pending.message !== text)) {
          throw new Error("Retry the saved follow-up before sending a different request.");
        }
        const adopted = await runMutatingFollowUp({
          pending,
          parentRunId,
          message: text,
          expectedBriefRevision: revision,
          kind: mutationKind as MutatingFollowUpKind,
          current: () => guard.current(),
          save: async (saved) => {
            await persistMutationJournal(token, guard, "pendingFollowUp", saved, parentRunId);
          },
          post: (runId, message, expectedBriefRevision, idempotencyKey) =>
            api.explainFollowUp(credential(), runId, { message, expectedBriefRevision }, idempotencyKey),
          adopt: async (body) => {
            await adoptReturnedChild({
              parentRunId,
              body,
              requireRunId: true,
              selectRun: api.selectRun,
              captureView: (acceptedRunId) => api.captureView(credential(), acceptedRunId),
              onView: (next) => { guard.release(); guard = next; },
              currentRun: (acceptedRunId) => api.currentRun(credential(), acceptedRunId),
              refresh: async (acceptedRunId) => {
                if (acceptedRunId === parentRunId) {
                  await refreshRun(credential(), acceptedRunId, undefined, true);
                  return;
                }
                const opening = {
                  ...latestUi.current,
                  status: "progress" as const,
                  events: [],
                  source: null,
                  readingAnchor: null,
                  report: null,
                  previousReport: latestUi.current.report
                    ? { reportId: latestUi.current.report.reportId, blocks: latestUi.current.report.blocks }
                    : latestUi.current.previousReport,
                };
                latestUi.current = opening;
                setViewState(opening);
                await refreshRun(credential(), acceptedRunId, opening, true);
              },
              poll: (runId) => startPolling(credential(), runId),
            });
          },
        });
        const finished = {
          ...latestUi.current,
          pendingFollowUp: adopted.phase === "adopted" ? null : adopted,
          draft: latestUi.current.draft.trim() === text ? "" : latestUi.current.draft,
          error: null,
        };
        await sessionStorage.persistRequired(credential(), finished);
        if (!guard.current()) throw new SupersededRequest();
        latestUi.current = finished;
        setViewState(finished);
        return;
      }
      const body = await api.explainFollowUp(credential(), parentRunId, {
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
    if (token && savedSecondMessageBlocksWork()) { await onSend(); return; }
    const current = latestUi.current;
    const text = (submitted ?? current.draft).trim();
    if (!text) return;
    if (!token && guestContextRef.current?.acceptedTurnCount === 1) {
      if (queryAuthorizationPending(current.run)) {
        setViewState(s => ({ ...s, error: "This research needs an exact search decision before continuing." }));
        return;
      }
      const routedGuest = routeFollowUp(text, { reportReady: composerFollowsReport(current), runActive: current.run?.lifecycle === "queued" || current.run?.lifecycle === "running" });
      if (routedGuest.kind === "new_research") await captureGuestSecondAction({ kind: "new_research", text });
      else if (current.run?.runId) await captureGuestSecondAction({ kind: "follow_up", text, parentRunId: current.run.runId });
      return;
    }
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
    if (savedSecondMessageBlocksWork()) { setViewState(s => ({ ...s, error: "The saved second message must be resolved before another verification." })); return; }
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
      const credential = memberAuthority();
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
          await sessionStorage.persistRequired(credential(), { ...state, pendingVerification: saved });
          if (!guard.current()) throw new SupersededRequest();
          setState(s => ({ ...s, pendingVerification: saved }));
        },
        post: (id, request) => api.followUp(credential(), id, request),
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
      const credential = memberAuthority();
      verifying.current = true; setVerificationBusy(true);
      const result = await api.resolveRunRequest(credential(), pending.request.idempotencyKey, pending);
      if (!guard.current()) throw new SupersededRequest();
      if (result.status === "accepted") await adoptVerification(pending, readAdmittedRun(result.run).runId);
      else if (result.status === "withdrawn") {
        const next = { ...state, pendingVerification: null, error: "The saved verification request is withdrawn. No new verification will start under this key." };
        await sessionStorage.persistRequired(credential(), next);
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
          pendingFollowUp={unresolvedFollowUp(state.pendingFollowUp)}
          pendingAssumptions={unresolvedAssumptions(state.pendingAssumptions)}
          pendingCorrection={unresolvedCorrection(state.pendingCorrection)}
          pendingSourceDeletion={!!state.pendingSourceDeletion}
          sourceDeleteBusy={sourceDeleteBusy}
          onRetryCleanup={() => { if (token && state.run?.runId) void refreshRun(token, state.run.runId); }}
          onRemoveCorrectionFile={(index) => setCorrectionFiles((files) => files.filter((_, i) => i !== index))}
          onPickCorrectionDocument={() => void pickCorrectionDocument()}
          onRetryDocumentCorrection={() => void addCorrectionDocuments()}
          onResolveDocumentCorrection={() => void resolveDocumentCorrection()}
          onRetryVerification={() => void onFollowUp()}
          onResolveVerification={() => void resolvePendingVerification()}
          onRetryFollowUp={() => { if (state.pendingFollowUp) void onExplainFollowUp(state.pendingFollowUp.message, true); }}
          onRetryAssumptions={() => void retryPendingAssumptions()}
          onRetryCorrection={() => { if (state.pendingCorrection) void onCorrect(state.pendingCorrection.question, true); }}
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
                        const credential = memberAuthority();
                        void api.approveQuery(credential(), state.run.runId, body).then(() => refreshRun(credential(), state.run!.runId)).then(() => {
                          if (token && latestUi.current.run && !queryAuthorizationPending(latestUi.current.run)) {
                            startPolling(credential(), latestUi.current.run.runId);
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
              onClarify={(value) => { if (guestContextRef.current && value !== clarifyAnswer) guestDraftRevision.current++; setClarifyAnswer(value); }}
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
          <SourceSheet key={JSON.stringify([readerOwner, state.report?.reportId, state.source.passageId])} source={state.source} styles={styles}
            reducedMotion={state.reducedMotion} ink={theme.ink}
            canFocus={() => Boolean(state.run && (token ? api.currentRun(token, state.run.runId) : guestContextRef.current && guestProof.current) && latestUi.current.run?.runId === state.run.runId && latestUi.current.tab === "research" && latestUi.current.source?.passageId === state.source?.passageId && latestUi.current.report?.reportId === state.report?.reportId)}
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
            accountLabel={accountId ? `Account ${accountId.slice(0, 8)}` : guestContext ? "Guest research" : "Not signed in"}
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
            onSignIn={() => {
              if (guestPendingRef.current) { setGuestSheetVisible(true); setState(s => ({ ...s, tab: "research" })); return; }
              // A returning member with a verified Clerk session signs in
              // directly: no guest bootstrap, no pending action, no sheet.
              if (auth?.signedIn) { void ensureSession(); return; }
              // Signed out with no guest pending action: open the provider
              // chooser (Apple/Google/email), never an error. Sponsor-disabled
              // builds still open it; each provider reports its exact
              // unavailable reason and nothing is sent until one succeeds.
              directLoginRef.current = true; setDirectLogin(true);
              setGuestSheetState(initialGuestSignInSheetState());
              setGuestSheetVisible(true);
            }}
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
            onMode={(routeMode) => setState((s) => !token ? { ...s, routeMode: "controlled-research", error: "Guest research uses the real research route only." } : s.pendingAdmission ? { ...s, error: "Check or withdraw the saved request before changing research mode." } : { ...s, routeMode })}
            onDelete={async () => {
              if (!token && guestContextRef.current) { await deleteGuestConversation(); return; }
              if (!token) return;
              try {
                stopPolling();
                const result = await api.deleteAccount(token);
                api.activateSession(null); clearPanels();
                memberTokenRef.current = null; memberAccountRef.current = null;
                activeClerkSubjectRef.current = null;
                setToken(null); setAccountId(null); setState({ ...emptyState(), error: result.fileCleanupPending ? "Account access removed. Stored file deletion is queued for retry." : null });
                await clearAccountLocal(sessionStorage);
              } catch (error) {
                if (isSupersededRequest(error)) return;
                setState((s) => ({ ...s, error: "Could not confirm complete deletion. Retry deletion or device cleanup." }));
              }
            }}
            onLogout={() => {
              if (!token && guestContextRef.current) { void deleteGuestConversation(); return; }
              void (async () => {
                try {
                  if (!authRef.current) throw new Error("Clerk session is unavailable.");
                  await authRef.current.signOut();
                  stopPolling(); api.activateSession(null); api.clearGuest(); clearPanels();
                  memberTokenRef.current = null; memberAccountRef.current = null;
                  activeClerkSubjectRef.current = null;
                  setToken(null); setAccountId(null); setState((s) => logoutState(s));
                  await logoutLocal(sessionStorage); setStorageReady(true);
                } catch { setState((s) => ({ ...s, error: "Sign-out or device cleanup could not be confirmed. Please retry." })); }
              })();
            }}
            onRevoke={async () => {
              if (!token) {
                // R01: guest revocation must reach the guest authority too.
                // The displayed guest switch previously did nothing without a
                // member token. Confirm the server revocation, adopt its
                // advanced control version (fencing stale work), mirror the
                // higher consent revision into the latest reader, and persist
                // through the same owned boundary as a grant.
                const context = guestContextRef.current;
                const proof = guestProof.current;
                if (!context || !proof) return;
                try {
                  setCorrectionFiles([]);
                  const result = await api.guest.consent(proof, false);
                  if (result?.granted !== false) throw new Error("Current guest consent revocation could not be confirmed.");
                  if (guestContextRef.current?.guestContextId !== context.guestContextId) return;
                  const updated = readGuestContext({
                    ...guestContextRef.current,
                    consentGranted: false,
                    controlVersion: typeof result.controlVersion === "number" ? result.controlVersion : guestContextRef.current.controlVersion,
                  });
                  await guestDevice.updateContext(updated);
                  guestContextRef.current = updated; setGuestContext(updated);
                  guestRunEpoch.current++;
                  const revoked = { ...withConsent(latestUi.current, false), error: "AI processing consent was revoked. Your draft and report remain saved." };
                  latestUi.current = revoked;
                  await saveGuestReader(revoked);
                } catch (error) {
                  if (isSupersededRequest(error)) return;
                  setStateRaw((s) => ({ ...s, error: error instanceof Error ? error.message : "Could not confirm consent revocation. Retry." }));
                }
                return;
              }
              let accountGuard: ReturnType<typeof api.capture>;
              let credential: () => string;
              try {
                credential = memberAuthority();
                accountGuard = api.capture(credential());
              } catch (error) {
                if (isSupersededRequest(error)) return;
                return;
              }
              try {
                setCorrectionFiles([]);
                await revokeConsentWithinAccount({
                  account: accountGuard,
                  currentState: () => latestUi.current,
                  invalidateView: () => api.invalidateView(credential()),
                  // An accepted mutation may be completing its required write
                  // as revocation fences the view. Retain its durable identity.
                  waitForJournal: () => mutationJournalWrite.current,
                  persist: (revoked) => sessionStorage.persistRequired(credential(), revoked),
                  revokeRemote: () => api.consent(credential(), false),
                  synchronize: (next) => { latestUi.current = next; },
                  render: (next) => setStateRaw((previous) => accountGuard.current() ? next : previous),
                  failureMessage: "Could not confirm consent revocation. Retry.",
                });
              } catch (error) {
                if (isSupersededRequest(error)) return;
              } finally {
                accountGuard.release();
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
          inputRef={composerInput}
          onChange={(draft) => { if (!token && guestContextRef.current && draft !== latestUi.current.draft) guestDraftRevision.current++; setState((s) => ({ ...s, draft })); }}
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
          onAttach={() => !token ? setState(s => ({ ...s, error: "Paste a public URL in the question. Sign in before adding private sources." })) : setShowAttach((open) => !open)}
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
      <GuestSignInSheet
        visible={guestSheetVisible && !(guestPending?.phase === "authenticating" && !!auth?.sessionTaskPending)}
        state={guestSheetState}
        providers={guestProviders}
        heading={directLogin && !guestPending ? "Sign in to restore research" : undefined}
        subheading={directLogin && !guestPending ? "Choose a provider to restore your member library." : undefined}
        reducedMotion={state.reducedMotion}
        colorScheme={resolveAppearance(appearance, system) === "dark" ? "dark" : "light"}
        onEvent={onGuestSheetEvent}
        onDismiss={() => { if (directLoginRef.current) { directLoginRef.current = false; setDirectLogin(false); } setGuestSheetVisible(false); requestAnimationFrame(() => composerInput.current?.focus()); }}
        onOpenLegalDocument={openGuestLegal}
        transport={directLogin && !guestPending ? directLoginTransport : guestSheetTransport}
      />
      <ClerkSessionTaskView
        visible={guestSheetVisible && guestPending?.phase === "authenticating" && !!auth?.sessionTaskPending}
        colorScheme={resolveAppearance(appearance, system) === "dark" ? "dark" : "light"}
        onClose={closeClerkSessionTask}
      />
    </SafeAreaView>
  );
}

function ClerkConnectedApp() {
  return <AppInner auth={useClerkGuestAuth()} />;
}

export function App() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return (
    <SafeAreaProvider>
      {publishableKey ? <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}><ClerkConnectedApp /></ClerkProvider> : <AppInner auth={null} />}
    </SafeAreaProvider>
  );
}
