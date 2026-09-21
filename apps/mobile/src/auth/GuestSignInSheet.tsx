import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { motion } from "@deep/design";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CloseIcon } from "../icons";
import {
  guestSignInBusy,
  guestEmailCanResend,
  type GuestSignInAttempt,
  type GuestSignInOperation,
  type GuestProviderAvailability,
  type GuestSignInProvider,
  type GuestSignInSheetEvent,
  type GuestSignInSessionTask,
  type GuestSignInSheetState,
} from "./guest-sign-in-sheet-state";
import { GuestSignInAttemptGate } from "./guest-sign-in-attempt-gate";

export type GuestSignInDismissal = {
  preserveDraft: true;
  preserveReadingPosition: true;
  restoreComposerFocus: true;
};

/**
 * The screen has no authentication SDK dependency. The application adapter
 * owns Clerk calls, cancellation, durable pending-action updates and the
 * eventual claim; this component only starts explicitly configured work.
 */
export type GuestSignInAttemptRequest = {
  operation: Extract<GuestSignInOperation, "provider" | "email_code" | "resend_email_code" | "verify_email_code">;
  provider: "apple" | "google" | "email";
  email: string | null;
};

/**
 * All operations are async so the sheet can wait for the host to journal an
 * attempt before opening a provider or sending a code. `prepareAttempt` must
 * resolve only after that durable write; it is not an auth or claim result.
 */
export type GuestSignInTransport = {
  prepareAttempt(request: GuestSignInAttemptRequest): Promise<GuestSignInAttempt>;
  startProvider(attempt: GuestSignInAttempt): Promise<void>;
  cancelProvider?(attempt: GuestSignInAttempt): Promise<void>;
  cancelEmailAttempt?(): Promise<void>;
  requestEmailCode(attempt: GuestSignInAttempt): Promise<void>;
  verifyEmailCode(attempt: GuestSignInAttempt, code: string): Promise<void>;
  /** Resolves only after auto-continuation has been durably suppressed. */
  dismiss(context: { task: GuestSignInSessionTask | null; reason: "dismissed" }): Promise<void>;
};

export type GuestSignInSheetProps = {
  visible: boolean;
  state: GuestSignInSheetState;
  providers: Record<GuestSignInProvider, GuestProviderAvailability>;
  reducedMotion?: boolean;
  colorScheme?: "light" | "dark";
  /** The app owns journal persistence and authenticating/claiming transport. */
  onEvent(event: GuestSignInSheetEvent): Promise<void>;
  /** Called only after `transport.dismiss` records the non-destructive dismissal. */
  onDismiss(context: GuestSignInDismissal): void;
  /** The host owns the URL, in-app browser, and return focus for legal documents. */
  onOpenLegalDocument(document: "terms" | "privacy"): Promise<void> | void;
  transport: GuestSignInTransport;
};

const copy = {
  title: "Continue your research",
  subtitle: "Sign in to keep this conversation and send your next message.",
};

function providerLabel(provider: GuestSignInProvider): string {
  return provider === "apple" ? "Continue with Apple" : provider === "google" ? "Continue with Google" : "Continue with email";
}

function ProviderMark({ provider, dark }: { provider: GuestSignInProvider; dark: boolean }) {
  const name = provider === "apple" ? "logo-apple" : provider === "google" ? "logo-google" : "mail-outline";
  return <Ionicons name={name} size={22} color={provider === "google" ? "#4285F4" : dark ? "#FFFFFF" : "#101010"} accessible={false} />;
}

/**
 * A controlled, adapter-driven bottom sheet. It intentionally has no Clerk
 * import and cannot report sign-in/claim success: the application must pass a
 * state transition after its pending-action journal and server claim are safe.
 */
export function GuestSignInSheet({
  visible, state, providers, reducedMotion = false, colorScheme = "light", onEvent, onDismiss, transport,
  onOpenLegalDocument,
}: GuestSignInSheetProps) {
  const dark = colorScheme === "dark";
  const { width } = useWindowDimensions();
  const title = useRef<Text>(null);
  const focused = useRef(false);
  const rise = useRef(new Animated.Value(reducedMotion ? 0 : 28)).current;
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const [email, setEmail] = useState(state.email);
  const [code, setCode] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [closing, setClosing] = useState(false);
  const gate = useRef<GuestSignInAttemptGate | null>(null);
  const dismissal = useRef<Promise<void> | null>(null);
  const transportRef = useRef(transport);
  transportRef.current = transport;
  if (!gate.current) {
    gate.current = new GuestSignInAttemptGate({
      prepareAttempt: request => transportRef.current.prepareAttempt(request),
      dismiss: context => transportRef.current.dismiss(context),
    });
  }
  const busy = guestSignInBusy(state);
  const interactionLocked = busy || closing;
  const tablet = width >= 600;
  const ink = dark ? "#F6F2EC" : "#1C1916";
  const muted = dark ? "#C8C0B5" : "#6E6860";
  const surface = dark ? "#211F1C" : "#FFFCF7";
  const field = dark ? "#2B2824" : "#F5F1EB";
  const line = dark ? "#514B43" : "#D6CEC4";
  const accent = dark ? "#D8B878" : "#76511A";

  useEffect(() => setEmail(state.email), [state.email]);
  useEffect(() => { setCode(""); }, [visible, state.email, state.step === "sending_code"]);
  useEffect(() => { if (state.codeExpired) setCode(""); }, [state.codeExpired]);
  useEffect(() => {
    if (!visible || state.resend.status === "available") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, state.resend.status]);
  useEffect(() => { if (visible) gate.current?.resetForVisibleSheet(); }, [visible]);
  useEffect(() => {
    if (!visible) { focused.current = false; return; }
    if (reducedMotion) { rise.setValue(0); opacity.setValue(1); return; }
    rise.setValue(28); opacity.setValue(0);
    Animated.parallel([
      Animated.timing(rise, { toValue: 0, duration: motion.sheet, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: motion.fast, useNativeDriver: true }),
    ]).start();
  }, [visible, reducedMotion, rise, opacity]);

  const reportTransportError = async (error: unknown) => {
    const message = error instanceof Error && error.message ? error.message : "Sign-in could not be started. Please try again.";
    await onEvent({ type: "recoverable_error", message });
  };
  const close = async () => {
    if (dismissal.current) return dismissal.current;
    setClosing(true);
    const operation = (async () => {
      try {
        // A close never erases the draft. The local lease is invalidated before
        // waiting for a prepare result, then the host durably suppresses any
        // automatic continuation before the modal can disappear.
        const task = await gate.current!.dismiss(state.sessionTask);
        await onEvent({ type: "dismissed" });
        if (task?.kind === "provider") {
          try { await transportRef.current.cancelProvider?.(task.attempt); } catch { /* dismissal remains durable */ }
        }
        onDismiss({ preserveDraft: true, preserveReadingPosition: true, restoreComposerFocus: true });
      } catch (error) {
        await reportTransportError(error);
      } finally {
        dismissal.current = null;
        setClosing(false);
      }
    })();
    dismissal.current = operation;
    return operation;
  };
  const choose = async (provider: GuestSignInProvider) => {
    if (!providers[provider]?.available || interactionLocked) return;
    if (provider === "email") {
      await onEvent({ type: "choose_provider", provider });
      return;
    }
    try {
      await gate.current!.run(
        { operation: "provider", provider, email: null },
        async attempt => { await onEvent({ type: "begin_provider", provider, attempt }); },
        attempt => transportRef.current.startProvider(attempt),
      );
    } catch (error) {
      if (!gate.current!.isDismissed()) await reportTransportError(error);
    }
  };
  const submitEmail = async (operation: "email_code" | "resend_email_code" = "email_code") => {
    const normalized = email.trim();
    if (!normalized || interactionLocked) return;
    try {
      await onEvent({ type: "edit_email", email: normalized });
      await gate.current!.run(
        { operation, provider: "email", email: normalized },
        async attempt => { await onEvent({ type: "begin_email_code", attempt }); },
        attempt => transportRef.current.requestEmailCode(attempt),
      );
    } catch (error) {
      if (!gate.current!.isDismissed()) await reportTransportError(error);
    }
  };
  const submitCode = async () => {
    if (!code.trim() || interactionLocked) return;
    try {
      await gate.current!.run(
        { operation: "verify_email_code", provider: "email", email: state.email },
        async attempt => { await onEvent({ type: "begin_code_verification", attempt }); },
        attempt => transportRef.current.verifyEmailCode(attempt, code.trim()),
      );
    } catch (error) {
      if (!gate.current!.isDismissed()) await reportTransportError(error);
    }
  };
  const cancelProvider = async () => {
    if (state.sessionTask?.kind !== "provider") return;
    try {
      // The host records cancellation before the external provider can be
      // closed, so a late callback cannot revive automatic continuation.
      await transportRef.current.cancelProvider?.(state.sessionTask.attempt);
      await onEvent({ type: "provider_cancelled" });
    } catch (error) {
      await reportTransportError(error);
    }
  };
  const leaveEmail = async (event: "provider_cancelled" | "use_different_email") => {
    try {
      await transportRef.current.cancelEmailAttempt?.();
      setCode("");
      await onEvent({ type: event });
    } catch (error) { await reportTransportError(error); }
  };
  const focusHeading = () => {
    if (focused.current || !visible) return;
    const tag = findNodeHandle(title.current);
    if (tag !== null) { focused.current = true; AccessibilityInfo.setAccessibilityFocus(tag); }
  };
  const openLegal = async (document: "terms" | "privacy") => {
    try { await onOpenLegalDocument(document); } catch (error) { await reportTransportError(error); }
  };
  const message = state.error ?? (state.step === "claiming" ? "Keeping your conversation together…" : state.step === "reconciling" ? "Checking the saved request without sending it again…" : state.step === "verifying_code" ? "Checking your code…" : state.step === "sending_code" ? "Sending your code…" : state.step === "provider_pending" ? "Continue in the provider window, then return here." : null);
  const showChooser = state.step === "chooser" || state.step === "provider_pending" || (state.step === "error" && state.retryStep === "chooser");
  const showEmail = state.step === "email" || state.step === "sending_code";
  const showCode = state.step === "code" || state.step === "verifying_code";

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.36)" }}>
        <Pressable accessibilityLabel="Dismiss sign-in sheet" accessibilityRole="button" onPress={() => { void close(); }} style={{ flex: 1 }} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={0}>
          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel="Sign in to continue your research"
            style={{ opacity, transform: [{ translateY: rise }], backgroundColor: surface, borderColor: line, borderWidth: 1, borderTopLeftRadius: tablet ? 24 : 28, borderTopRightRadius: tablet ? 24 : 28, maxWidth: tablet ? 560 : undefined, width: "100%", alignSelf: "center", maxHeight: "90%", paddingHorizontal: tablet ? 28 : 20, paddingTop: 12, paddingBottom: 20 }}
          >
            <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: line, marginBottom: 12 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text ref={title} onLayout={focusHeading} accessibilityRole="header" maxFontSizeMultiplier={1.8} style={{ color: ink, fontSize: 25, lineHeight: 31, fontWeight: "700", letterSpacing: -0.3 }}>{copy.title}</Text>
                <Text maxFontSizeMultiplier={1.8} style={{ color: muted, fontSize: 16, lineHeight: 23, marginTop: 5 }}>{copy.subtitle}</Text>
              </View>
              <Pressable onPress={() => { void close(); }} accessibilityRole="button" accessibilityLabel="Close sign-in sheet" hitSlop={12} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                <CloseIcon color={muted} size={17} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 20, paddingBottom: 4 }}>
              {message ? <Text accessibilityLiveRegion="polite" accessibilityRole={state.error ? "alert" : "text"} style={{ color: state.error ? "#B3261E" : accent, fontSize: 15, lineHeight: 21, marginBottom: 14 }}>{message}</Text> : null}
              {showChooser ? <>
                {(["apple", "google", "email"] as const).map((provider) => {
                  const availability = providers[provider];
                  const unavailable = !availability?.available;
                  const selected = state.step === "provider_pending" && state.provider === provider;
                  return <View key={provider} style={{ marginBottom: 10 }}>
                    <Pressable
                      disabled={unavailable || interactionLocked}
                      onPress={() => { void choose(provider); }}
                      accessibilityRole="button"
                      accessibilityLabel={unavailable ? `${providerLabel(provider)} unavailable` : providerLabel(provider)}
                      accessibilityHint={unavailable ? availability?.unavailableReason ?? "Not configured" : undefined}
                      accessibilityState={{ disabled: unavailable || interactionLocked, busy: selected }}
                      style={{ minHeight: 52, borderRadius: 13, borderColor: line, borderWidth: 1, backgroundColor: unavailable ? field : surface, opacity: unavailable ? 0.62 : 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, paddingHorizontal: 16 }}
                    >
                      <ProviderMark provider={provider} dark={dark} />
                      <Text maxFontSizeMultiplier={1.8} style={{ color: ink, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{selected ? "Waiting for sign-in…" : providerLabel(provider)}</Text>
                    </Pressable>
                    {unavailable ? <Text style={{ color: muted, fontSize: 13, lineHeight: 18, marginTop: 4 }}>{availability?.unavailableReason ?? "Not available yet."}</Text> : null}
                  </View>;
                })}
              </> : null}
              {state.step === "provider_pending" && state.provider && state.provider !== "email" ? <QuietButton label="Cancel sign-in" onPress={() => { void cancelProvider(); }} disabled={false} color={accent} /> : null}
              {showEmail ? <>
                <Text style={{ color: ink, fontSize: 16, lineHeight: 22, fontWeight: "600", marginBottom: 8 }}>Email address</Text>
                <TextInput value={email} onChangeText={(value) => { setEmail(value); void onEvent({ type: "edit_email", email: value }); }} editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="Email address" placeholder="you@example.com" placeholderTextColor={muted} maxFontSizeMultiplier={1.8} style={{ minHeight: 52, borderRadius: 13, borderColor: line, borderWidth: 1, backgroundColor: field, color: ink, fontSize: 17, paddingHorizontal: 14, marginBottom: 12 }} />
                <SheetButton label={state.step === "sending_code" ? "Sending code…" : "Email me a code"} onPress={() => { void submitEmail(); }} disabled={!email.trim() || busy} fill={ink} text={surface} />
                <QuietButton label="Use another sign-in option" onPress={() => { void leaveEmail("provider_cancelled"); }} disabled={busy} color={accent} />
              </> : null}
              {showCode ? <>
                <Text style={{ color: ink, fontSize: 16, lineHeight: 22, fontWeight: "600", marginBottom: 5 }}>Enter the code we emailed you</Text>
                <Text style={{ color: muted, fontSize: 14, lineHeight: 20, marginBottom: 10 }}>Sent to {state.email}</Text>
                <TextInput value={code} onChangeText={setCode} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" textContentType="oneTimeCode" accessibilityLabel="Email verification code" placeholder="123456" placeholderTextColor={muted} maxFontSizeMultiplier={1.8} style={{ minHeight: 52, borderRadius: 13, borderColor: line, borderWidth: 1, backgroundColor: field, color: ink, fontSize: 20, letterSpacing: 3, paddingHorizontal: 14, marginBottom: 12 }} />
                <SheetButton label={state.step === "verifying_code" ? "Checking code…" : "Continue"} onPress={() => { void submitCode(); }} disabled={!code.trim() || busy || state.codeExpired} fill={ink} text={surface} />
                <QuietButton label="Use a different email" onPress={() => { void leaveEmail("use_different_email"); }} disabled={busy} color={accent} />
                <QuietButton label={state.resend.status === "rate_limited" ? "Resend limited" : "Resend code"} onPress={() => { void submitEmail("resend_email_code"); }} disabled={busy || !guestEmailCanResend(state, new Date(clock))} color={accent} />
              </> : null}
              {state.step === "claiming" || state.step === "reconciling" ? <View accessibilityLabel={state.step === "claiming" ? "Claiming your guest conversation" : "Reconciling your saved request"} style={{ paddingVertical: 16 }}><Text style={{ color: ink, fontSize: 16, lineHeight: 23 }}>Your first conversation stays intact. We’ll send your saved next message only after the claim is confirmed.</Text></View> : null}
              {state.step === "expired" || state.step === "deleted" ? <View accessibilityRole="alert" style={{ paddingVertical: 16 }}><Text style={{ color: ink, fontSize: 16, lineHeight: 23 }}>{state.step === "deleted" ? "This saved conversation was deleted. Your current draft is still yours to review." : "This saved sign-in action has expired. Your current draft is still available."}</Text></View> : null}
              {state.step === "error" && state.retryStep !== "chooser" ? <SheetButton label="Try again" onPress={() => { void onEvent({ type: "retry" }); }} disabled={busy} fill={ink} text={surface} /> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
                <Text style={{ color: muted, fontSize: 12, lineHeight: 18 }}>By continuing, you agree to our </Text>
                <LegalLink label="Terms" onPress={() => { void openLegal("terms"); }} color={accent} />
                <Text style={{ color: muted, fontSize: 12, lineHeight: 18 }}> and </Text>
                <LegalLink label="Privacy Notice" onPress={() => { void openLegal("privacy"); }} color={accent} />
                <Text style={{ color: muted, fontSize: 12, lineHeight: 18 }}>.</Text>
              </View>
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function SheetButton({ label, onPress, disabled, fill, text }: { label: string; onPress(): void; disabled: boolean; fill: string; text: string }) {
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={{ minHeight: 52, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: fill, opacity: disabled ? 0.48 : 1, paddingHorizontal: 16 }}><Text maxFontSizeMultiplier={1.8} style={{ color: text, fontSize: 16, fontWeight: "700" }}>{label}</Text></Pressable>;
}
function QuietButton({ label, onPress, disabled, color }: { label: string; onPress(): void; disabled: boolean; color: string }) {
  return <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} style={{ minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginTop: 4, opacity: disabled ? 0.5 : 1 }}><Text maxFontSizeMultiplier={1.8} style={{ color, fontSize: 15, fontWeight: "600" }}>{label}</Text></Pressable>;
}
function LegalLink({ label, onPress, color }: { label: string; onPress(): void; color: string }) {
  return <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={label} hitSlop={6}><Text style={{ color, fontSize: 12, lineHeight: 18, fontWeight: "600", textDecorationLine: "underline" }}>{label}</Text></Pressable>;
}
