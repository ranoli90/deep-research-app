import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Alert,
  ActivityIndicator,
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
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { color, space, type as typeTokens } from "@deep/design";
import { sessionStorage } from "./src/native-session";
import { SupersededRequest } from "./src/request-scope";
import { OUTPUT_REPORT_CATEGORIES } from "@deep/contracts";
import { api, deletionPageUrl, isExpiredSession, isOfflineError, isSupersededRequest } from "./src/api";
import { activateLocalSession, clearAccountLocal, hydrateOnLaunch, logoutLocal, persistSession } from "./src/persist";
import { breakLongTokens, formatChangeSummary, parseTable } from "./src/report-layout";
import {
  androidBack,
  applySnapshot,
  attachFile,
  canSubmit,
  conciseBlocks,
  emptyState,
  expireLocalSession,
  logout as logoutState,
  mergeEvents,
  openLibraryItem,
  restoreAnchor,
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

function useTheme() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return color[scheme];
}

function AppInner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setStateRaw] = useState<UiState>(emptyState());
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
  const submitting = useRef(false);
  const signingIn = useRef<Promise<string> | null>(null);
  const refreshing = useRef(new Map<string, symbol>());
  const [detailed, setDetailed] = useState(true);
  const [correction, setCorrection] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [attachName, setAttachName] = useState("note.txt");
  const [attachText, setAttachText] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [processors, setProcessors] = useState<string[]>([]);
  const [privacyFlows, setPrivacyFlows] = useState("");
  const [deletionVsSub, setDeletionVsSub] = useState("");
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagCategory, setFlagCategory] = useState<(typeof OUTPUT_REPORT_CATEGORIES)[number]>("inaccurate");
  const [flagNote, setFlagNote] = useState("");
  const [flagInclude, setFlagInclude] = useState(false);
  const [flagStatus, setFlagStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const conversationScroll = useRef<ScrollView>(null);
  const blockY = useRef<Record<string, number>>({});

  function restoreReadingPosition(blocks: ReportBlock[] | undefined, saved: UiState["readingAnchor"]) {
    if (!blocks?.length || !saved) return;
    const { anchor, note } = restoreAnchor(saved, blocks);
    if (note) {
      setState((s) => ({ ...s, error: note }));
    }
    const y = anchor?.blockId != null ? blockY.current[anchor.blockId] : undefined;
    if (y != null) {
      conversationScroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
    }
  }

  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    if (!hydrated) return;
    const guard = api.capture();
    void persistSession(sessionStorage, { token, state }).catch(() => {
      if (guard.current()) setState((s) => s.error === "Could not save this device’s session." ? s : { ...s, error: "Could not save this device’s session." });
    }).finally(() => guard.release());
  }, [state, token, hydrated, setState]);

  const persistAnchor = useCallback((reportId: string, blockId: string) => {
    setState((s) => {
      const next = { ...s, readingAnchor: { reportId, blockId, offset: 0 } };

      return next;
    });
  }, [setState]);

  async function ensureSession() {
    if (signingIn.current) return signingIn.current;
    const pending = startSession(); signingIn.current = pending;
    try { return await pending; }
    finally { if (signingIn.current === pending) signingIn.current = null; }
  }

  async function startSession() {
    if (token) return token;
    if (!hydrated) throw new Error("Restoring this device’s session. Try again shortly.");
    let guard: ReturnType<typeof api.capture> | undefined;
    try {
      const s = await api.session();
      api.activateSession(s.token);
      guard = api.capture();
      await activateLocalSession(sessionStorage, s);
      if (!guard.current()) { guard.release(); throw new SupersededRequest(); }
      const accepted = guard;
      setToken((previous) => accepted.current() ? s.token : previous);
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
    refreshing.current.clear();
    setCorrection(""); setClarifyAnswer(""); setAttachText(""); setAttachName("note.txt");
    setFlagNote(""); setFlagOpen(false); setFlagStatus("idle"); setFlagInclude(false);
    setRestoreMessage(null); setProcessors([]); setPrivacyFlows(""); setDeletionVsSub("");
  }

  async function onAuthFailure() {
    stopPolling(); api.activateSession(null); clearPanels();
    setToken(null); setState((s) => expireLocalSession(s));
    try { await clearAccountLocal(sessionStorage); }
    catch { setState((s) => ({ ...s, error: "Session expired. Device cleanup failed; retry signing out." })); }
  }

  async function refreshRun(t: string, runId: string) {
    if (!api.currentRun(t, runId)) return;
    const key = `${t}:${runId}`;
    if (refreshing.current.has(key)) return;
    const attempt = Symbol(); refreshing.current.set(key, attempt);
    try {
      const snap = await api.getRun(t, runId);
      const ev = await api.events(t, runId, 0);
      const report = snap.reportId ? await api.report(t, snap.reportId) : null;
      setViewState((s) => {
        if (!s.signedIn || !api.currentRun(t, runId)) return s;
        let next = applySnapshot(s, snap);
        next = { ...next, events: mergeEvents(next.events, ev.events ?? []) };
        if (report) {
          next = {
            ...next,
            report: {
              reportId: report.reportId,
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
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) {
        setViewState((s) => {
          const next = { ...s, offline: true, error: (e as Error).message };

          return next;
        });
      } else setViewState((s) => ({ ...s, error: (e as Error).message }));
    } finally { if (refreshing.current.get(key) === attempt) refreshing.current.delete(key); }
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
      api.closeSource();
      let consumed = false;
      setState((s) => {
        const r = androidBack(s);
        consumed = r.consumed;
        return r.next;
      });
      return consumed;
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (v) setState((s) => ({ ...s, reducedMotion: true }));
    });
    let mounted = true;
    const hydration = api.capture();
    void hydrateOnLaunch(sessionStorage).then(async ({ token: t, accountId, state: saved }) => {
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
      setToken((previous) => restored.current() ? t : previous);
      setState((previous) => restored.current() ? s : previous);
      if (t && s.run?.runId) {
        api.selectRun(s.run.runId);
        void refreshRun(t, s.run.runId);
        startPolling(t, s.run.runId);
      }
      requestAnimationFrame(() => { if (restored.current()) restoreReadingPosition(s.report?.blocks, s.readingAnchor); });
      restored.release();
    }).catch(() => setState((s) => ({ ...s, error: "Secure session storage is unavailable. Sign in again when device storage is available." })))
      .finally(() => { hydration.release(); if (mounted) setHydrated(true); });
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    const appSub = AppState.addEventListener("change", (st) => {
      if (st !== "active") return;
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

  async function onSend() {
    if (!hydrated || submitting.current) return;
    const gate = canSubmit(state);
    if (!gate.ok) {
      const tab = submitPrerequisite(state);
      setViewState((s) => ({ ...s, error: gate.reason ?? "Cannot send", tab }));
      return;
    }
    try {
      submitting.current = true;
      api.selectRun(null);
      stopPolling();
      const t = token ?? (await ensureSession());
      const ids: string[] = [];
      for (const file of state.attachments) {
        const up = await api.attach(t, file.filename, file.mime, file.text);
        ids.push(up.attachmentId);
      }
      const created = await api.createRun(t, state.draft.trim(), state.routeMode, newId(), ids);
      api.selectRun(created.runId);
      setViewState((s) => {
        const next = {
          ...s,
          status: "progress" as const,
          error: null,
          attachments: [],
          report: null,
          previousReport: s.report
            ? { reportId: s.report.reportId, blocks: s.report.blocks }
            : s.previousReport,
          run: {
            runId: created.runId,
            lifecycle: created.lifecycle,
            phase: created.phase,
            outcome: null,
            reportId: null,
            labeledDemo: created.labeledDemo,
          },
        };

        return next;
      });
      setShowAttach(false);
      AccessibilityInfo.announceForAccessibility(
        "Research in progress. Cancel is available. Closing the app will not stop the job.",
      );
      await refreshRun(t, created.runId);
      startPolling(t, created.runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
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
      } else setViewState((s) => ({ ...s, error: (e as Error).message, status: "failed" }));
    } finally { submitting.current = false; }
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

  async function onOpenSource(id: string) {
    try {
      const t = token;
      if (!t) {
        setViewState((s) => ({ ...s, error: "Sign in to inspect sources.", tab: "settings" }));
        return;
      }
      if (state.report) persistAnchor(state.report.reportId, "answer");
      const src = await api.source(t, id);
      setViewState((s) => ({ ...s, source: src, tab: "research" }));
      AccessibilityInfo.announceForAccessibility(`Source sheet. ${src.title}. ${src.accessLevel}.`);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setViewState((s) => ({ ...s, error: (e as Error).message }));
    }
  }

  async function onCorrect() {
    if (!token || !state.run) return;
    const text = correction.trim();
    if (!text) {
      setViewState((s) => ({ ...s, error: "Write a correction first. The draft and last report stay on this device." }));
      return;
    }
    try {
      const snap = await api.getRun(token, state.run.runId);
      const child = await api.correct(token, state.run.runId, snap.brief.revision, text);
      api.selectRun(child.runId);
      setCorrection("");
      setShowAttach(false);
      setViewState((s) => {
        const next = {
          ...s,
          status: "progress" as const,
          error: null,
          previousReport: s.report ? { reportId: s.report.reportId, blocks: s.report.blocks } : s.previousReport,
          run: {
            runId: child.runId,
            lifecycle: "queued",
            phase: "preparing",
            outcome: null,
            reportId: null,
            labeledDemo: s.run?.labeledDemo ?? true,
          },
        };

        return next;
      });
      startPolling(token, child.runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else if (isOfflineError(e)) {
        setViewState((s) => ({ ...s, offline: true, error: (e as Error).message }));
      } else setViewState((s) => ({ ...s, error: (e as Error).message }));
    }
  }

  async function onContinueClarification() {
    if (!token || !state.run) return;
    const geography = clarifyAnswer.trim();
    if (!geography) {
      setViewState((s) => ({ ...s, error: "Enter a jurisdiction. The app will not assume a country." }));
      return;
    }
    try {
      await api.continueRun(token, state.run.runId, geography);
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
    }
  }

  async function onFollowUp() {
    if (!token || !state.run) return;
    try {
      const claimId = state.report?.blocks.find((b) => b.id === "answer")?.claimIds[0];
      if (!claimId) {
        setViewState((s) => ({ ...s, error: "This answer has no supported claim to check. Add a follow-up question in the composer." }));
        return;
      }
      const child = await api.followUp(token, state.run.runId, claimId, "Verify the answer claim only");
      api.selectRun(child.runId);
      setViewState((s) => {
        const next = {
          ...s,
          previousReport: s.report ? { reportId: s.report.reportId, blocks: s.report.blocks } : s.previousReport,
          status: "progress" as const,
        };

        return next;
      });
      startPolling(token, child.runId);
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setViewState((s) => ({ ...s, error: (e as Error).message }));
    }
  }

  async function onShare(reportId?: string) {
    const id = reportId ?? state.report?.reportId;
    if (!token || !id) return;
    try {
      const md = await api.exportMd(token, id);
      await Share.share({ message: md.markdown, title: "Research report" });
    } catch (e) {
      if (isSupersededRequest(e)) return;
      if (isExpiredSession(e)) await onAuthFailure();
      else setState((s) => ({ ...s, error: (e as Error).message }));
    }
  }

  const blocks: ReportBlock[] = state.report
    ? detailed
      ? state.report.blocks
      : conciseBlocks(state.report.blocks)
    : [];

  return (
    <SafeAreaView style={styles.safe} accessibilityLabel="Deep Research">
      <StatusBar style={theme === color.dark ? "light" : "dark"} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={insets.top}>
        <View style={styles.header}>
          <Text style={styles.wordmark} accessibilityRole="header" allowFontScaling maxFontSizeMultiplier={2}>
            Deep Research
          </Text>
          <Pressable onPress={() => setState((s) => ({ ...s, tab: "settings" }))} accessibilityRole="button" accessibilityLabel="Open profile and settings">
            <Text style={styles.link}>Profile</Text>
          </Pressable>
        </View>
        {state.routeMode === "fixture" ? (
          <View style={styles.banner} accessibilityLabel="Demo fixture route">
            <Text style={styles.bannerText}>Demo route — labeled fixture, not live research</Text>
          </View>
        ) : (
          <View style={styles.bannerLive}>
            <Text style={styles.bannerText}>Live research route</Text>
          </View>
        )}
        {state.error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {state.error}
          </Text>
        ) : null}

        {state.tab === "research" && !state.source ? (
          <ScrollView
            ref={conversationScroll}
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 200 }}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Research conversation"
          >
            {!state.run && !state.report ? (
              <Text style={styles.welcome}>
                Ask a comparison with hard constraints, or reconcile a document with public evidence. Research continues on the server if you leave.
              </Text>
            ) : null}

            {state.status === "progress" || state.status === "loading" ? (
              <View style={styles.card} accessibilityLabel="Research progress" accessibilityLiveRegion="polite">
                <Text style={styles.kicker}>{state.run?.phase ?? "queued"}</Text>
                <Text style={styles.bodyText}>
                  {state.events.at(-1)?.publicSummary ?? "Waiting for the server. Closing this app will not stop the job."}
                </Text>
                {state.reducedMotion ? null : <ActivityIndicator accessibilityLabel="In progress" />}
                <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel research">
                  <Text style={styles.link}>Cancel</Text>
                </Pressable>
              </View>
            ) : null}

            {state.status === "cancelled" ? (
              <Text style={styles.bodyText}>Cancelled. Partial evidence is kept unless you delete your account.</Text>
            ) : null}
            {state.status === "failed" ? (
              <Text style={styles.bodyText}>The run failed. Saved evidence, if any, is still in your library.</Text>
            ) : null}
            {state.status === "awaiting_input" ? (
              <View style={styles.card} accessibilityLabel="Clarification needed">
                <Text style={styles.kicker}>Need one detail</Text>
                <Text style={styles.bodyText}>{state.events.find((e) => e.type === "clarify")?.publicSummary ?? "Which jurisdiction should this answer apply to?"}</Text>
                <TextInput
                  value={clarifyAnswer}
                  onChangeText={setClarifyAnswer}
                  placeholder="Jurisdiction"
                  placeholderTextColor={theme.muted}
                  style={styles.input}
                  allowFontScaling
                  maxFontSizeMultiplier={2}
                  accessibilityLabel="Clarification answer"
                />
                <Pressable
                  onPress={() => void onContinueClarification()}
                  accessibilityRole="button"
                  accessibilityLabel="Submit clarification and continue"
                  disabled={!clarifyAnswer.trim()}
                >
                  <Text style={styles.send}>Continue research</Text>
                </Pressable>
              </View>
            ) : null}
            {state.offline ? (
              <Text style={styles.caveat} accessibilityLiveRegion="polite">
                Offline. Draft and last report stay on this device. Research will not be sent until you reconnect.
              </Text>
            ) : null}

            {state.report ? (
              <View style={styles.card} accessibilityLabel="Research report">
                <View style={styles.row}>
                  <Text style={styles.kicker}>{state.report.labeledDemo ? "Fixture report" : "Live report"}</Text>
                  <Pressable onPress={() => setDetailed((d) => !d)} accessibilityRole="button" accessibilityLabel={detailed ? "Show concise view" : "Show detailed view"}>
                    <Text style={styles.link}>{detailed ? "Concise" : "Detailed"}</Text>
                  </Pressable>
                </View>
                {detailed && blocks.length > 4 ? (
                  <View style={styles.outline} accessibilityLabel="Report outline">
                    <Text style={styles.kicker}>Outline</Text>
                    {blocks.map((b) => (
                      <Text key={`outline-${b.id}`} style={styles.outlineItem}>
                        {b.kind} · {b.id}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {blocks.map((b) => (
                  <ReportBlockView
                    key={b.id}
                    block={b}
                    styles={styles}
                    onOpenSource={(id) => void onOpenSource(id)}
                    onLayoutY={(y) => {
                      blockY.current[b.id] = y;
                      if (!state.source && state.readingAnchor?.blockId === b.id) {
                        conversationScroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
                      }
                    }}
                  />
                ))}
                {state.report.changeSummary ? (
                  <Text style={styles.caveat} accessibilityLabel="Change summary">
                    {formatChangeSummary(state.report.changeSummary)}
                  </Text>
                ) : null}
                {state.report.limitations.map((l) => (
                  <Text key={l} style={styles.caveat}>
                    {l}
                  </Text>
                ))}
                <Pressable onPress={() => onShare()} accessibilityRole="button" accessibilityLabel="Share report as Markdown">
                  <Text style={styles.link}>Share Markdown</Text>
                </Pressable>
                <Pressable onPress={onFollowUp} accessibilityRole="button" accessibilityLabel="Verify the answer claim">
                  <Text style={styles.link}>Verify this claim</Text>
                </Pressable>
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
            {state.previousReport ? (
              <View style={styles.card} accessibilityLabel="Previous report version">
                <Text style={styles.kicker}>Previous version</Text>
                <Text style={styles.bodyText}>{state.previousReport.blocks.find((b) => b.id === "answer")?.text ?? "Earlier result kept."}</Text>
                <Pressable
                  onPress={() => void onShare(state.previousReport?.reportId)}
                  accessibilityRole="button"
                  accessibilityLabel="Share previous report as Markdown"
                >
                  <Text style={styles.link}>Share previous Markdown</Text>
                </Pressable>
              </View>
            ) : null}

            {(state.report || state.status === "completed" || state.status === "partial") && state.run ? (
              <View style={styles.card} accessibilityLabel="Correction">
                <Text style={styles.kicker}>Correction</Text>
                <TextInput
                  value={correction}
                  onChangeText={setCorrection}
                  placeholder="Actually, the budget is 120 EUR"
                  placeholderTextColor={theme.muted}
                  style={styles.input}
                  allowFontScaling
                  maxFontSizeMultiplier={2}
                  accessibilityLabel="Correction field"
                />
                <Pressable onPress={onCorrect} accessibilityRole="button" accessibilityLabel="Submit correction">
                  <Text style={styles.send}>Update research</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        {state.source ? (
          <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Source sheet">
            <Text style={styles.title} accessibilityRole="header">{breakLongTokens(state.source.title)}</Text>
            <Text style={styles.kicker}>{state.source.accessLevel}</Text>
            <ScrollView style={styles.sheetBody} nestedScrollEnabled>
              {state.source.passageLocator?.block ? <Text selectable style={styles.bodyText}>{state.source.passageLocator.block}</Text> : null}
              {state.source.warnings?.length ? <Text style={styles.bodyText}>Partial extraction: some document structure or content may be unread.</Text> : null}
              <Text selectable style={styles.bodyText}>{breakLongTokens(state.source.exactText)}</Text>
            </ScrollView>
            <Pressable
              onPress={() => {
                api.closeSource();
                setState((s) => {
                  const next = { ...s, source: null };
                  requestAnimationFrame(() => restoreReadingPosition(next.report?.blocks, next.readingAnchor));
                  return next;
                });
              }}
              accessibilityRole="button"
              accessibilityLabel="Close source sheet"
            >
              <Text style={styles.link}>Close</Text>
            </Pressable>
          </View>
        ) : null}

        {state.tab === "library" ? (
          <Library
            token={token}
            styles={styles}
            onOpen={async (id) => {
              api.selectRun(id);
              if (!token) return;
              setState((s) => openLibraryItem(s, id));
              await refreshRun(token, id);
              startPolling(token, id);
            }}
            onShare={(reportId) => onShare(reportId)}
          />
        ) : null}
        {state.tab === "settings" ? (
          <Settings
            styles={styles}
            processors={processors}
            privacyFlows={privacyFlows}
            deletionVsSub={deletionVsSub}
            restoreMessage={restoreMessage}
            state={state}
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
            onMode={(routeMode) => setState((s) => ({ ...s, routeMode }))}
            onDelete={async () => {
              if (!token) return;
              try {
                stopPolling();
                const result = await api.deleteAccount(token);
                api.activateSession(null); clearPanels();
                setToken(null); setState({ ...emptyState(), error: result.fileCleanupPending ? "Account access removed. Stored file deletion is queued for retry." : null });
                await clearAccountLocal(sessionStorage);
              } catch (error) {
                if (isSupersededRequest(error)) return;
                setState((s) => ({ ...s, error: "Could not confirm complete deletion. Retry deletion or device cleanup." }));
              }
            }}
            onLogout={() => {
              stopPolling();
              api.activateSession(null); clearPanels();
              void logoutLocal(sessionStorage).catch(() => setState((s) => ({ ...s, error: "Device cleanup failed. Retry signing out." })));
              setToken(null);
              setState((s) => logoutState(s));
            }}
            onRevoke={async () => {
              if (!token) return;
              try { await api.consent(token, false); setState((s) => ({ ...s, consentGranted: false })); }
              catch (error) {
                if (isSupersededRequest(error)) return;
                setState((s) => ({ ...s, error: "Could not confirm consent revocation. Retry." }));
              }
            }}
          />
        ) : null}

        {state.tab === "research" && !state.source && !keyboardOpen && (showAttach || !state.report) ? (
          <View style={styles.attachRow}>
            <TextInput
              value={attachName}
              onChangeText={setAttachName}
              style={styles.input}
              allowFontScaling
              maxFontSizeMultiplier={2}
              accessibilityLabel="Attachment filename"
            />
            <TextInput
              value={attachText}
              onChangeText={setAttachText}
              placeholder="Paste a text or Markdown note"
              placeholderTextColor={theme.muted}
              allowFontScaling
              maxFontSizeMultiplier={2}
              style={styles.input}
              accessibilityLabel="Attachment text"
            />
            <Pressable
              onPress={() => {
                setState((s) =>
                  attachFile(s, {
                    filename: attachName.endsWith(".pdf") ? `${attachName}.notes.txt` : attachName || "note.txt",
                    mime: attachName.endsWith(".md") ? "text/markdown" : "text/plain",
                    text: attachText,
                  }),
                );
                setAttachText("");
                setShowAttach(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Attach pasted note"
            >
              <Text style={styles.link}>Attach note ({state.attachments.length}/3)</Text>
            </Pressable>
          </View>
        ) : null}
        {state.tab === "research" && !state.source && !keyboardOpen && state.report && !showAttach ? (
          <Pressable
            onPress={() => setShowAttach(true)}
            accessibilityRole="button"
            accessibilityLabel="Show attachment fields"
            style={styles.attachRow}
          >
            <Text style={styles.link}>Attach a file ({state.attachments.length}/3)</Text>
          </Pressable>
        ) : null}

        {state.tab === "research" && !state.source ? (
        <View style={styles.composerWrap}>
          <TextInput
            editable={hydrated}
            value={state.draft}
            onChangeText={(draft) => {
              setState((s) => {
                const next = { ...s, draft };

                return next;
              });
            }}
            placeholder="Ask with constraints, dates, and what would change the answer"
            placeholderTextColor={theme.muted}
            style={styles.composer}
            multiline
            allowFontScaling
            maxFontSizeMultiplier={2}
            accessibilityLabel="Research question"
          />
          <Pressable
            disabled={!hydrated}
            onPress={onSend}
            style={styles.sendBtn}
            accessibilityRole="button"
            accessibilityLabel="Start research"
            hitSlop={12}
          >
            <Text style={styles.send}>Send</Text>
          </Pressable>
        </View>
        ) : null}

        <View style={styles.tabs} accessibilityRole="tablist">
          {(["research", "library", "settings"] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setState((s) => ({ ...s, tab }))}
              accessibilityRole="tab"
              accessibilityState={{ selected: state.tab === tab }}
              accessibilityLabel={tab === "research" ? "Research" : tab === "library" ? "Library" : "Settings"}
              style={styles.tab}
            >
              <Text style={state.tab === tab ? styles.tabOn : styles.tabOff}>{tab}</Text>
            </Pressable>
          ))}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Library({
  token,
  styles,
  onOpen,
  onShare,
}: {
  token: string | null;
  styles: ReturnType<typeof makeStyles>;
  onOpen: (id: string) => void;
  onShare: (reportId: string) => void;
}) {
  type LibraryItem = { id: string; title: string; status: string; report_id?: string | null };
  const [loaded, setLoaded] = useState<{ token: string | null; items: LibraryItem[]; error: string | null }>({ token: null, items: [], error: null });
  const items = loaded.token === token ? loaded.items : [];
  useEffect(() => {
    if (!token) return;
    let current = true;
    void api.library(token).then((r) => { if (current) setLoaded((previous) => current ? { token, items: r.items ?? [], error: null } : previous); })
      .catch((error) => { if (current && !isSupersededRequest(error)) setLoaded({ token, items: [], error: "Could not load saved reports. Reopen Library to retry." }); });
    return () => { current = false; };
  }, [token]);
  if (!token) {
    return (
      <Text style={styles.bodyText} accessibilityLabel="Saved reports">
        Sign in from Profile to see saved reports.
      </Text>
    );
  }
  if (items.length === 0) {
    return (
      <Text style={styles.bodyText} accessibilityLabel="Saved reports">
        {loaded.token !== token ? "Loading saved reports…" : loaded.error ?? "No reports yet."}
      </Text>
    );
  }
  return (
    <ScrollView style={styles.body} accessibilityLabel="Saved reports">
      {items.map((it) => (
        <View key={it.id} style={styles.card}>
          <Pressable onPress={() => onOpen(it.id)} accessibilityRole="button" accessibilityLabel={`Open ${it.title}`}>
            <Text style={styles.title}>{breakLongTokens(it.title)}</Text>
            <Text style={styles.kicker}>{it.status}</Text>
          </Pressable>
          {it.report_id ? (
            <Pressable onPress={() => onShare(it.report_id!)} accessibilityRole="button" accessibilityLabel={`Share ${it.title}`}>
              <Text style={styles.link}>Share Markdown</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function Settings({
  styles,
  state,
  processors,
  privacyFlows,
  deletionVsSub,
  restoreMessage,
  onConsent,
  onSignIn,
  onMode,
  onRestore,
  onDelete,
  onLogout,
  onRevoke,
}: {
  styles: ReturnType<typeof makeStyles>;
  state: UiState;
  processors: string[];
  privacyFlows: string;
  deletionVsSub: string;
  restoreMessage: string | null;
  onConsent: () => void;
  onSignIn: () => void;
  onMode: (m: UiState["routeMode"]) => void;
  onRestore: () => void;
  onDelete: () => void;
  onLogout: () => void;
  onRevoke: () => void;
}) {
  return (
    <ScrollView style={styles.body} accessibilityLabel="Settings">
      <Text style={styles.title} accessibilityRole="header">Settings</Text>
      <Text style={styles.bodyText}>Account, appearance, privacy, and usage. Purchases and push stay unavailable until those integrations are enabled.</Text>
      <Pressable onPress={onSignIn} accessibilityRole="button" accessibilityLabel="Sign in development session">
        <Text style={styles.link}>{state.signedIn ? "Signed in (development)" : "Sign in (development)"}</Text>
      </Pressable>
      <Pressable onPress={onConsent} accessibilityRole="button" accessibilityLabel="Grant AI processing consent">
        <Text style={styles.link}>{state.consentGranted ? "Consent granted" : "Grant AI processing consent"}</Text>
      </Pressable>
      <Pressable onPress={() => onMode(state.routeMode === "fixture" ? "controlled-research" : "fixture")} accessibilityRole="button" accessibilityLabel="Toggle demo or live route">
        <Text style={styles.link}>Route: {state.routeMode}</Text>
      </Pressable>
      <Text style={styles.caveat}>Demo reports are labeled and never presented as live completed research.</Text>
      <Text style={styles.bodyText} accessibilityLabel="Processor disclosures">
        Processors: {processors.length ? processors.join(". ") : state.signedIn ? "Loading processor list." : "Sign in to see processor disclosures."}
      </Text>
      <Text style={styles.caveat}>This app cannot see a provider's internal searches.</Text>
      {privacyFlows ? <Text style={styles.bodyText} accessibilityLabel="Privacy data flows">{privacyFlows}</Text> : null}
      {deletionVsSub ? <Text style={styles.caveat} accessibilityLabel="Deletion versus subscription">{deletionVsSub}</Text> : null}
      <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel="Restore purchases">
        <Text style={styles.link}>Restore purchases</Text>
      </Pressable>
      {restoreMessage ? <Text style={styles.caveat} accessibilityLabel="Restore result">{restoreMessage}</Text> : null}
      <Text style={styles.caveat}>Purchases: unavailable until a store sandbox is connected. Restore explains that prerequisite and does not grant entitlement.</Text>
      <Text style={styles.caveat}>Notifications: optional. The app works if permission is denied; reopen to refresh.</Text>
      <Pressable onPress={onRevoke} accessibilityRole="button" accessibilityLabel="Revoke AI processing consent">
        <Text style={styles.link}>Revoke consent (stops new research)</Text>
      </Pressable>
      <Text style={styles.caveat}>Drafts and reports are saved on this device while signed in. Signing out clears this account’s saved content.</Text>
      <Pressable onPress={onLogout} accessibilityRole="button" accessibilityLabel="Log out and clear saved drafts and reports">
        <Text style={styles.link}>Log out and clear saved content</Text>
      </Pressable>
      <Pressable
        onPress={() => void Linking.openURL(deletionPageUrl)}
        accessibilityRole="button"
        accessibilityLabel="Open web deletion page"
      >
        <Text style={styles.link}>Open web deletion page</Text>
      </Pressable>
      <Pressable onPress={() => Alert.alert("Delete account and research?", "This removes saved research and cancels active runs. Store subscriptions are managed separately.", [
        { text: "Cancel", style: "cancel" }, { text: "Delete account", style: "destructive", onPress: onDelete },
      ])} accessibilityRole="button" accessibilityLabel="Delete account and derived data">
        <Text style={styles.error}>Delete account and derived research</Text>
      </Pressable>
    </ScrollView>
  );
}

function ReportBlockView({
  block,
  styles,
  onOpenSource,
  onLayoutY,
}: {
  block: ReportBlock;
  styles: ReturnType<typeof makeStyles>;
  onOpenSource: (id: string) => void;
  onLayoutY?: (y: number) => void;
}) {
  const text = breakLongTokens(block.text);
  let body: ReactNode;
  if (block.kind === "table") {
    const rows = parseTable(block.text);
    body = (
      <View style={styles.bounded}>
        <ScrollView horizontal nestedScrollEnabled accessibilityLabel={`Table ${block.id}`}>
          <View>
            {rows.map((row, i) => (
              <View key={`${block.id}-r${i}`} style={styles.tableRow}>
                {row.map((cell, j) => (
                  <Text
                    key={`${block.id}-c${i}-${j}`}
                    selectable
                    style={i === 0 ? styles.tableHead : styles.tableCell}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  } else if (block.kind === "code") {
    body = (
      <View style={styles.bounded}>
        <ScrollView horizontal nestedScrollEnabled accessibilityLabel={`Code ${block.id}`}>
          <Text selectable style={styles.code}>{block.text}</Text>
        </ScrollView>
      </View>
    );
  } else if (block.kind === "heading") {
    body = <Text selectable accessibilityRole="header" style={styles.title}>{text}</Text>;
  } else if (block.kind === "quote") {
    body = <Text selectable style={styles.quote}>{text}</Text>;
  } else {
    body = <Text selectable style={block.kind === "caveat" ? styles.caveat : styles.bodyText}>{text}</Text>;
  }
  return (
    <View
      nativeID={`block-${block.id}`}
      style={{ marginBottom: space.md }}
      onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}
    >
      {body}
      <View style={styles.citeRow}>
        {block.citationIds.map((id) => (
          <Pressable
            key={id}
            onPress={() => onOpenSource(id)}
            accessibilityRole="button"
            accessibilityLabel={`Open source ${id.slice(0, 8)}`}
            hitSlop={8}
          >
            <Text style={[styles.link, styles.citeLink]}>Source {id.slice(0, 8)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme: (typeof color)["light"] | (typeof color)["dark"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.bg },
    header: { paddingHorizontal: space.md, paddingVertical: space.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 },
    wordmark: { ...typeTokens.title, color: theme.ink, flexShrink: 1 },
    link: { color: theme.accent, fontSize: 16, paddingVertical: 8 },
    banner: { backgroundColor: theme.accentMuted, padding: space.sm, marginHorizontal: space.md, borderRadius: 8 },
    bannerLive: { backgroundColor: theme.accentMuted, padding: space.sm, marginHorizontal: space.md, borderRadius: 8 },
    bannerText: { color: theme.ink, fontSize: 13 },
    error: { color: theme.danger, padding: space.md },
    body: { flex: 1, padding: space.md },
    welcome: { ...typeTokens.body, color: theme.muted, marginBottom: space.md },
    card: { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1, borderRadius: 14, padding: space.md, marginBottom: space.md, overflow: "hidden" },
    sheet: { flex: 1, backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, borderRadius: 14, padding: space.md, marginBottom: space.md, maxWidth: "100%" },
    sheetBody: { flex: 1, maxHeight: "100%" },
    bounded: { width: "100%", maxWidth: "100%" },
    outline: { marginBottom: space.md, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: theme.line },
    outlineItem: { ...typeTokens.caption, color: theme.muted, marginBottom: 2 },
    tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.line },
    tableCell: { ...typeTokens.body, color: theme.ink, minWidth: 96, paddingVertical: 6, paddingRight: 12 },
    tableHead: { ...typeTokens.caption, color: theme.muted, minWidth: 96, paddingVertical: 6, paddingRight: 12, textTransform: "uppercase" },
    code: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13, color: theme.ink, paddingVertical: 8 },
    quote: { ...typeTokens.body, color: theme.ink, fontStyle: "italic", paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: theme.line },
    citeRow: { flexDirection: "row", flexWrap: "wrap" },
    citeLink: { paddingRight: 16 },
    kicker: { ...typeTokens.caption, color: theme.muted, textTransform: "uppercase", marginBottom: 6 },
    title: { ...typeTokens.title, color: theme.ink, marginBottom: 8 },
    bodyText: { ...typeTokens.body, color: theme.ink, flexShrink: 1 },
    caveat: { ...typeTokens.body, color: theme.caveat, marginTop: 8 },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    composerWrap: { flexDirection: "row", alignItems: "flex-end", padding: space.sm, borderTopWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
    composer: { flex: 1, minHeight: 44, maxHeight: 180, ...typeTokens.body, color: theme.ink, padding: space.sm },
    sendBtn: { paddingHorizontal: space.md, paddingVertical: space.sm },
    send: { color: theme.accent, fontWeight: "600", fontSize: 16 },
    tabs: { flexDirection: "row", borderTopWidth: 1, borderColor: theme.line },
    tab: { flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 4 },
    tabOn: { color: theme.ink, fontWeight: "600", textTransform: "capitalize", textAlign: "center" },
    tabOff: { color: theme.muted, textTransform: "capitalize", textAlign: "center" },
    input: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, padding: space.sm, color: theme.ink, marginBottom: 8 },
    attachRow: { paddingHorizontal: space.md, paddingTop: space.sm },
  });
}

export function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}
