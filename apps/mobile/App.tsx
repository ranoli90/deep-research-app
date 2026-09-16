import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { api } from "./src/api";
import {
  applySnapshot,
  canSubmit,
  conciseBlocks,
  emptyState,
  restoreAfterReopen,
  type ReportBlock,
  type UiState,
} from "./src/state";

function useTheme() {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return color[scheme];
}

function AppInner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<UiState>(emptyState());
  const [token, setToken] = useState<string | null>(null);
  const [detailed, setDetailed] = useState(true);
  const [correction, setCorrection] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  const styles = useMemo(() => makeStyles(theme), [theme]);

  const persistAnchor = useCallback((reportId: string, blockId: string) => {
    setState((s) => ({ ...s, readingAnchor: { reportId, blockId, offset: 0 } }));
  }, []);

  async function ensureSession() {
    const s = await api.session();
    setToken(s.token);
    setState((prev) => ({ ...prev, signedIn: true }));
    return s.token;
  }

  async function grantConsent() {
    const t = token ?? (await ensureSession());
    await api.consent(t, true);
    setState((s) => ({ ...s, consentGranted: true }));
  }

  async function refreshRun(t: string, runId: string) {
    const snap = await api.getRun(t, runId);
    setState((s) => applySnapshot(s, snap));
    const ev = await api.events(t, runId, 0);
    setState((s) => ({ ...s, events: ev.events ?? [] }));
    if (snap.reportId) {
      const report = await api.report(t, snap.reportId);
      setState((s) => ({
        ...s,
        report: {
          reportId: report.reportId,
          blocks: report.blocks,
          limitations: report.limitations ?? [],
          labeledDemo: report.labeledDemo,
        },
      }));
    }
  }

  function startPolling(t: string, runId: string) {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(() => {
      void refreshRun(t, runId);
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  async function onSend() {
    const gate = canSubmit(state);
    if (!gate.ok) {
      setState((s) => ({ ...s, error: gate.reason ?? "Cannot send" }));
      return;
    }
    try {
      const t = token ?? (await ensureSession());
      const created = await api.createRun(t, state.draft.trim(), state.routeMode, crypto.randomUUID());
      setState((s) => ({ ...s, status: "progress", error: null, run: { runId: created.runId, lifecycle: created.lifecycle, phase: created.phase, outcome: null, reportId: null, labeledDemo: created.labeledDemo } }));
      startPolling(t, created.runId);
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, status: "failed" }));
    }
  }

  async function onCancel() {
    if (!token || !state.run) return;
    await api.cancel(token, state.run.runId);
    await refreshRun(token, state.run.runId);
  }

  async function onOpenSource(id: string) {
    if (!token) return;
    if (state.report) persistAnchor(state.report.reportId, "answer");
    const src = await api.source(token, id);
    setState((s) => ({ ...s, source: src, tab: "research" }));
  }

  async function onCorrect() {
    if (!token || !state.run || !correction.trim()) return;
    const snap = await api.getRun(token, state.run.runId);
    const child = await api.correct(token, state.run.runId, snap.brief.revision, correction.trim());
    setCorrection("");
    startPolling(token, child.runId);
  }

  async function onShare() {
    if (!token || !state.report) return;
    const md = await api.exportMd(token, state.report.reportId);
    await Share.share({ message: md.markdown, title: "Research report" });
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
          <Text style={styles.wordmark} accessibilityRole="header">
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

        {state.tab === "research" ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            accessibilityLabel="Research conversation"
          >
            {!state.run && !state.report ? (
              <Text style={styles.welcome}>
                Ask a comparison with hard constraints, or reconcile a document with public evidence. Research continues on the server if you leave.
              </Text>
            ) : null}

            {state.status === "progress" || state.status === "loading" ? (
              <View style={styles.card} accessibilityLabel="Research progress">
                <Text style={styles.kicker}>{state.run?.phase ?? "queued"}</Text>
                <Text style={styles.bodyText}>
                  {state.events.at(-1)?.publicSummary ?? "Waiting for the server. Closing this app will not stop the job."}
                </Text>
                <ActivityIndicator accessibilityLabel="In progress" />
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

            {state.report ? (
              <View style={styles.card} accessibilityLabel="Research report">
                <View style={styles.row}>
                  <Text style={styles.kicker}>{state.report.labeledDemo ? "Fixture report" : "Live report"}</Text>
                  <Pressable onPress={() => setDetailed((d) => !d)} accessibilityRole="button" accessibilityLabel={detailed ? "Show concise view" : "Show detailed view"}>
                    <Text style={styles.link}>{detailed ? "Concise" : "Detailed"}</Text>
                  </Pressable>
                </View>
                {blocks.map((b) => (
                  <View key={b.id} style={{ marginBottom: space.md }}>
                    <Text style={b.kind === "caveat" ? styles.caveat : styles.bodyText}>{b.text}</Text>
                    {b.citationIds.map((id) => (
                      <Pressable key={id} onPress={() => onOpenSource(id)} accessibilityRole="link" accessibilityLabel={`Open source ${id.slice(0, 8)}`}>
                        <Text style={styles.link}>Source {id.slice(0, 8)}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
                {state.report.limitations.map((l) => (
                  <Text key={l} style={styles.caveat}>
                    {l}
                  </Text>
                ))}
                <Pressable onPress={onShare} accessibilityRole="button" accessibilityLabel="Share report as Markdown">
                  <Text style={styles.link}>Share Markdown</Text>
                </Pressable>
              </View>
            ) : null}

            {state.source ? (
              <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Source sheet">
                <Text style={styles.title}>{state.source.title}</Text>
                <Text style={styles.kicker}>{state.source.accessLevel}</Text>
                <Text style={styles.bodyText}>{state.source.exactText}</Text>
                <Pressable
                  onPress={() => setState((s) => ({ ...s, source: null }))}
                  accessibilityRole="button"
                  accessibilityLabel="Close source sheet"
                >
                  <Text style={styles.link}>Close</Text>
                </Pressable>
              </View>
            ) : null}

            {(state.status === "completed" || state.status === "partial") && state.run ? (
              <View style={styles.card}>
                <Text style={styles.kicker}>Correction</Text>
                <TextInput
                  value={correction}
                  onChangeText={setCorrection}
                  placeholder="Actually, the budget is 120 EUR"
                  placeholderTextColor={theme.muted}
                  style={styles.input}
                  accessibilityLabel="Correction field"
                />
                <Pressable onPress={onCorrect} accessibilityRole="button" accessibilityLabel="Submit correction">
                  <Text style={styles.send}>Update research</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        {state.tab === "library" ? <Library token={token} styles={styles} onOpen={(id) => token && startPolling(token, id)} /> : null}
        {state.tab === "settings" ? (
          <Settings
            styles={styles}
            state={state}
            onConsent={grantConsent}
            onSignIn={ensureSession}
            onMode={(routeMode) => setState((s) => ({ ...s, routeMode }))}
            onDelete={async () => {
              if (!token) return;
              await api.deleteAccount(token);
              setToken(null);
              setState(emptyState());
            }}
          />
        ) : null}

        <View style={styles.composerWrap}>
          <TextInput
            value={state.draft}
            onChangeText={(draft) => setState((s) => ({ ...s, draft }))}
            placeholder="Ask with constraints, dates, and what would change the answer"
            placeholderTextColor={theme.muted}
            style={styles.composer}
            multiline
            accessibilityLabel="Research question"
          />
          <Pressable
            onPress={onSend}
            style={styles.sendBtn}
            accessibilityRole="button"
            accessibilityLabel="Start research"
            hitSlop={12}
          >
            <Text style={styles.send}>Send</Text>
          </Pressable>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {(["research", "library", "settings"] as const).map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setState((s) => ({ ...s, tab }))}
              accessibilityRole="tab"
              accessibilityState={{ selected: state.tab === tab }}
              accessibilityLabel={tab}
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

function Library({ token, styles, onOpen }: { token: string | null; styles: ReturnType<typeof makeStyles>; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<{ id: string; title: string; status: string }[]>([]);
  useEffect(() => {
    if (!token) return;
    void api.library(token).then((r) => setItems(r.items ?? []));
  }, [token]);
  if (!token) return <Text style={styles.bodyText}>Sign in from Profile to see saved reports.</Text>;
  if (items.length === 0) return <Text style={styles.bodyText}>No reports yet.</Text>;
  return (
    <ScrollView style={styles.body}>
      {items.map((it) => (
        <Pressable key={it.id} onPress={() => onOpen(it.id)} accessibilityRole="button" accessibilityLabel={`Open ${it.title}`}>
          <View style={styles.card}>
            <Text style={styles.title}>{it.title}</Text>
            <Text style={styles.kicker}>{it.status}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Settings({
  styles,
  state,
  onConsent,
  onSignIn,
  onMode,
  onDelete,
}: {
  styles: ReturnType<typeof makeStyles>;
  state: UiState;
  onConsent: () => void;
  onSignIn: () => void;
  onMode: (m: UiState["routeMode"]) => void;
  onDelete: () => void;
}) {
  return (
    <ScrollView style={styles.body}>
      <Text style={styles.title}>Settings</Text>
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
      <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Delete account and derived data">
        <Text style={styles.error}>Delete account and derived research</Text>
      </Pressable>
    </ScrollView>
  );
}

function makeStyles(theme: (typeof color)["light"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.bg },
    header: { paddingHorizontal: space.md, paddingVertical: space.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    wordmark: { ...typeTokens.title, color: theme.ink },
    link: { color: theme.accent, fontSize: 16, paddingVertical: 8 },
    banner: { backgroundColor: theme.accentMuted, padding: space.sm, marginHorizontal: space.md, borderRadius: 8 },
    bannerLive: { backgroundColor: theme.accentMuted, padding: space.sm, marginHorizontal: space.md, borderRadius: 8 },
    bannerText: { color: theme.ink, fontSize: 13 },
    error: { color: theme.danger, padding: space.md },
    body: { flex: 1, padding: space.md },
    welcome: { ...typeTokens.body, color: theme.muted, marginBottom: space.md },
    card: { backgroundColor: theme.surface, borderColor: theme.line, borderWidth: 1, borderRadius: 14, padding: space.md, marginBottom: space.md },
    sheet: { backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, borderRadius: 14, padding: space.md, marginBottom: space.md },
    kicker: { ...typeTokens.caption, color: theme.muted, textTransform: "uppercase", marginBottom: 6 },
    title: { ...typeTokens.title, color: theme.ink, marginBottom: 8 },
    bodyText: { ...typeTokens.body, color: theme.ink },
    caveat: { ...typeTokens.body, color: theme.caveat, marginTop: 8 },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    composerWrap: { flexDirection: "row", alignItems: "flex-end", padding: space.sm, borderTopWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
    composer: { flex: 1, minHeight: 44, maxHeight: 120, ...typeTokens.body, color: theme.ink, padding: space.sm },
    sendBtn: { paddingHorizontal: space.md, paddingVertical: space.sm },
    send: { color: theme.accent, fontWeight: "600", fontSize: 16 },
    tabs: { flexDirection: "row", borderTopWidth: 1, borderColor: theme.line },
    tab: { flex: 1, alignItems: "center", paddingVertical: 12 },
    tabOn: { color: theme.ink, fontWeight: "600", textTransform: "capitalize" },
    tabOff: { color: theme.muted, textTransform: "capitalize" },
    input: { borderWidth: 1, borderColor: theme.line, borderRadius: 8, padding: space.sm, color: theme.ink, marginBottom: 8 },
  });
}

export function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

void AccessibilityInfo;
void restoreAfterReopen;
