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
import { CloseIcon } from "../icons";
import {
  guestSignInBusy,
  type GuestProviderAvailability,
  type GuestSignInProvider,
  type GuestSignInSheetEvent,
  type GuestSignInSheetState,
} from "./guest-sign-in-sheet-state";

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
export type GuestSignInTransport = {
  startProvider(provider: "apple" | "google"): void;
  cancelProvider?(provider: "apple" | "google"): void;
  requestEmailCode(email: string): void;
  verifyEmailCode(code: string): void;
};

export type GuestSignInSheetProps = {
  visible: boolean;
  state: GuestSignInSheetState;
  providers: Record<GuestSignInProvider, GuestProviderAvailability>;
  reducedMotion?: boolean;
  colorScheme?: "light" | "dark";
  /** The app owns journal persistence and authenticating/claiming transport. */
  onEvent(event: GuestSignInSheetEvent): void;
  /** Close/back is non-destructive: host preserves the exact draft and reader position. */
  onDismiss(context: GuestSignInDismissal): void;
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
  if (provider === "apple") return <Text accessible={false} style={{ color: dark ? "#FFFFFF" : "#101010", fontSize: 21, lineHeight: 22 }}></Text>;
  if (provider === "google") return <Text accessible={false} style={{ color: "#4285F4", fontSize: 19, lineHeight: 22, fontWeight: "700" }}>G</Text>;
  return <Text accessible={false} style={{ color: dark ? "#FFFFFF" : "#101010", fontSize: 18, lineHeight: 22 }}>✉</Text>;
}

/**
 * A controlled, adapter-driven bottom sheet. It intentionally has no Clerk
 * import and cannot report sign-in/claim success: the application must pass a
 * state transition after its pending-action journal and server claim are safe.
 */
export function GuestSignInSheet({
  visible, state, providers, reducedMotion = false, colorScheme = "light", onEvent, onDismiss, transport,
}: GuestSignInSheetProps) {
  const dark = colorScheme === "dark";
  const { width } = useWindowDimensions();
  const title = useRef<Text>(null);
  const focused = useRef(false);
  const rise = useRef(new Animated.Value(reducedMotion ? 0 : 28)).current;
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const [email, setEmail] = useState(state.email);
  const [code, setCode] = useState("");
  const busy = guestSignInBusy(state);
  const tablet = width >= 600;
  const ink = dark ? "#F6F2EC" : "#1C1916";
  const muted = dark ? "#C8C0B5" : "#6E6860";
  const surface = dark ? "#211F1C" : "#FFFCF7";
  const field = dark ? "#2B2824" : "#F5F1EB";
  const line = dark ? "#514B43" : "#D6CEC4";
  const accent = dark ? "#D8B878" : "#76511A";

  useEffect(() => setEmail(state.email), [state.email]);
  useEffect(() => {
    if (!visible) { focused.current = false; return; }
    if (reducedMotion) { rise.setValue(0); opacity.setValue(1); return; }
    rise.setValue(28); opacity.setValue(0);
    Animated.parallel([
      Animated.timing(rise, { toValue: 0, duration: motion.sheet, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: motion.fast, useNativeDriver: true }),
    ]).start();
  }, [visible, reducedMotion, rise, opacity]);

  const close = () => {
    if (state.step === "provider_pending" && state.provider && state.provider !== "email") {
      transport.cancelProvider?.(state.provider);
      onEvent({ type: "provider_cancelled" });
    }
    onDismiss({ preserveDraft: true, preserveReadingPosition: true, restoreComposerFocus: true });
  };
  const choose = (provider: GuestSignInProvider) => {
    if (!providers[provider]?.available || busy) return;
    onEvent({ type: "choose_provider", provider });
    if (provider !== "email") transport.startProvider(provider);
  };
  const submitEmail = () => {
    const normalized = email.trim();
    if (!normalized || busy) return;
    onEvent({ type: "edit_email", email: normalized });
    onEvent({ type: "begin_email_code" });
    transport.requestEmailCode(normalized);
  };
  const submitCode = () => {
    if (!code.trim() || busy) return;
    onEvent({ type: "begin_code_verification" });
    transport.verifyEmailCode(code.trim());
  };
  const focusHeading = () => {
    if (focused.current || !visible) return;
    const tag = findNodeHandle(title.current);
    if (tag !== null) { focused.current = true; AccessibilityInfo.setAccessibilityFocus(tag); }
  };
  const message = state.error ?? (state.step === "claiming" ? "Keeping your conversation together…" : state.step === "verifying_code" ? "Checking your code…" : state.step === "sending_code" ? "Sending your code…" : state.step === "provider_pending" ? "Continue in the provider window, then return here." : null);
  const showChooser = state.step === "chooser" || state.step === "provider_pending" || (state.step === "error" && state.retryStep === "chooser");
  const showEmail = state.step === "email" || state.step === "sending_code";
  const showCode = state.step === "code" || state.step === "verifying_code";

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.36)" }}>
        <Pressable accessibilityLabel="Dismiss sign-in sheet" accessibilityRole="button" onPress={close} style={{ flex: 1 }} />
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
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close sign-in sheet" hitSlop={12} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
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
                      disabled={unavailable || busy}
                      onPress={() => choose(provider)}
                      accessibilityRole="button"
                      accessibilityLabel={unavailable ? `${providerLabel(provider)} unavailable` : providerLabel(provider)}
                      accessibilityHint={unavailable ? availability?.unavailableReason ?? "Not configured" : undefined}
                      accessibilityState={{ disabled: unavailable || busy, busy: selected }}
                      style={{ minHeight: 52, borderRadius: 13, borderColor: line, borderWidth: 1, backgroundColor: unavailable ? field : surface, opacity: unavailable ? 0.62 : 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 10, paddingHorizontal: 16 }}
                    >
                      <ProviderMark provider={provider} dark={dark} />
                      <Text maxFontSizeMultiplier={1.8} style={{ color: ink, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{selected ? "Waiting for sign-in…" : providerLabel(provider)}</Text>
                    </Pressable>
                    {unavailable ? <Text style={{ color: muted, fontSize: 13, lineHeight: 18, marginTop: 4 }}>{availability?.unavailableReason ?? "Not available yet."}</Text> : null}
                  </View>;
                })}
              </> : null}
              {state.step === "provider_pending" && state.provider && state.provider !== "email" ? <QuietButton label="Cancel sign-in" onPress={() => { transport.cancelProvider?.(state.provider as "apple" | "google"); onEvent({ type: "provider_cancelled" }); }} disabled={false} color={accent} /> : null}
              {showEmail ? <>
                <Text style={{ color: ink, fontSize: 16, lineHeight: 22, fontWeight: "600", marginBottom: 8 }}>Email address</Text>
                <TextInput value={email} onChangeText={(value) => { setEmail(value); onEvent({ type: "edit_email", email: value }); }} editable={!busy} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="Email address" placeholder="you@example.com" placeholderTextColor={muted} maxFontSizeMultiplier={1.8} style={{ minHeight: 52, borderRadius: 13, borderColor: line, borderWidth: 1, backgroundColor: field, color: ink, fontSize: 17, paddingHorizontal: 14, marginBottom: 12 }} />
                <SheetButton label={state.step === "sending_code" ? "Sending code…" : "Email me a code"} onPress={submitEmail} disabled={!email.trim() || busy} fill={ink} text={surface} />
                <QuietButton label="Use another sign-in option" onPress={() => onEvent({ type: "provider_cancelled" })} disabled={busy} color={accent} />
              </> : null}
              {showCode ? <>
                <Text style={{ color: ink, fontSize: 16, lineHeight: 22, fontWeight: "600", marginBottom: 5 }}>Enter the code we emailed you</Text>
                <Text style={{ color: muted, fontSize: 14, lineHeight: 20, marginBottom: 10 }}>Sent to {state.email}</Text>
                <TextInput value={code} onChangeText={setCode} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="number-pad" textContentType="oneTimeCode" accessibilityLabel="Email verification code" placeholder="123456" placeholderTextColor={muted} maxFontSizeMultiplier={1.8} style={{ minHeight: 52, borderRadius: 13, borderColor: line, borderWidth: 1, backgroundColor: field, color: ink, fontSize: 20, letterSpacing: 3, paddingHorizontal: 14, marginBottom: 12 }} />
                <SheetButton label={state.step === "verifying_code" ? "Checking code…" : "Continue"} onPress={submitCode} disabled={!code.trim() || busy} fill={ink} text={surface} />
                <QuietButton label="Use a different email" onPress={() => onEvent({ type: "use_different_email" })} disabled={busy} color={accent} />
                <QuietButton label="Resend code" onPress={() => { if (!busy && state.email) { onEvent({ type: "begin_email_code" }); transport.requestEmailCode(state.email); } }} disabled={busy} color={accent} />
              </> : null}
              {state.step === "claiming" ? <View accessibilityLabel="Claiming your guest conversation" style={{ paddingVertical: 16 }}><Text style={{ color: ink, fontSize: 16, lineHeight: 23 }}>Your first conversation stays intact. We’ll send your saved next message only after the claim is confirmed.</Text></View> : null}
              {state.step === "error" && state.retryStep !== "chooser" ? <SheetButton label="Try again" onPress={() => onEvent({ type: "retry" })} disabled={busy} fill={ink} text={surface} /> : null}
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
