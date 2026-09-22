import React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { UiState } from "./state";

export type AppearancePreference = "system" | "light" | "dark";

/** Account presentation only; session authority and asynchronous mutations stay in App. */
export function ProfilePanel({
  styles,
  state,
  accountLabel,
  appearance,
  processors,
  privacyFlows,
  deletionVsSub,
  restoreMessage,
  onDone: _onDone,
  onOpenLibrary,
  onAppearance,
  onConsent,
  onSignIn,
  onRestore,
  onDelete,
  onLogout,
  onRevoke,
  onOpenDeletionPage,
  processorDetailsOpen = false,
  onToggleProcessorDetails,
}: {
  styles: {
    body: StyleProp<ViewStyle>;
    title: StyleProp<TextStyle>;
    bodyText: StyleProp<TextStyle>;
    link: StyleProp<TextStyle>;
    caveat: StyleProp<TextStyle>;
    error: StyleProp<TextStyle>;
    kicker?: StyleProp<TextStyle>;
    card?: StyleProp<ViewStyle>;
    row?: StyleProp<ViewStyle>;
    avatar?: StyleProp<ViewStyle>;
    avatarText?: StyleProp<TextStyle>;
    section?: StyleProp<ViewStyle>;
    switchRow?: StyleProp<ViewStyle>;
    settingsRow?: StyleProp<ViewStyle>;
    segment?: StyleProp<ViewStyle>;
    segmentOn?: StyleProp<TextStyle>;
    segmentOff?: StyleProp<TextStyle>;
  };
  state: Pick<UiState, "signedIn" | "consentGranted" | "routeMode">;
  accountLabel: string;
  appearance: AppearancePreference;
  processors: string[];
  privacyFlows: string;
  deletionVsSub: string;
  restoreMessage: string | null;
  onDone: () => void;
  onOpenLibrary: () => void;
  onAppearance: (value: AppearancePreference) => void;
  onConsent: () => void;
  onSignIn: () => void;
  onMode?: (m: UiState["routeMode"]) => void;
  onRestore: () => void;
  onDelete: () => void;
  onLogout: () => void;
  onRevoke: () => void;
  onOpenDeletionPage: () => void;
  processorDetailsOpen?: boolean;
  onToggleProcessorDetails?: () => void;
}) {
  const initials = accountInitials(accountLabel, state.signedIn);
  const processorLine = processors.length
    ? processors.join(". ")
    : state.signedIn
      ? "Loading processor list."
      : "Sign in to see processor disclosures.";

  return (
    <ScrollView style={styles.body} accessibilityLabel="Settings">
      <View style={styles.section} accessibilityLabel="Account">
        <Text style={styles.kicker}>Account</Text>
        <View style={styles.row}>
          <View style={styles.avatar} accessibilityLabel={state.signedIn ? "Account" : "Guest"}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.bodyText}>{state.signedIn ? accountLabel : "Not signed in"}</Text>
            <Text style={styles.caveat}>{state.signedIn ? "Signed in on this device" : "Sign in to save research"}</Text>
          </View>
        </View>
        <Pressable onPress={onSignIn} accessibilityRole="button" accessibilityLabel="Sign in to save research" style={styles.settingsRow}>
          <Text style={styles.link}>{state.signedIn ? "Manage account" : "Sign in"}</Text>
        </Pressable>
        <Pressable onPress={onOpenLibrary} accessibilityRole="button" accessibilityLabel="Open library" style={styles.settingsRow}>
          <Text style={styles.link}>Your research</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.kicker}>Appearance</Text>
        <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
          {(["system", "light", "dark"] as const).map((value) => {
            const selected = appearance === value;
            const label = value === "system" ? "System" : value === "light" ? "Light" : "Dark";
            return (
              <Pressable
                key={value}
                onPress={() => onAppearance(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Appearance ${label}`}
                hitSlop={8}
                style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, paddingVertical: 10 }}
              >
                <Text style={selected ? styles.segmentOn : styles.segmentOff}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.kicker}>Privacy & data</Text>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <Text style={styles.bodyText}>AI processing</Text>
            <Text style={styles.caveat}>Required for new research on this account.</Text>
          </View>
          <Switch
            value={state.consentGranted}
            onValueChange={(next) => {
              if (next) onConsent();
              else onRevoke();
            }}
            accessibilityLabel={state.consentGranted ? "Revoke AI processing consent" : "Grant AI processing consent"}
          />
        </View>
        <Pressable
          onPress={() => onToggleProcessorDetails?.()}
          accessibilityRole="button"
          accessibilityLabel={processorDetailsOpen ? "Hide how we process data" : "Show how we process data"}
          style={styles.settingsRow}
        >
          <Text style={styles.link}>{processorDetailsOpen ? "Hide how we process data" : "How we process data"}</Text>
        </Pressable>
        {processorDetailsOpen ? (
          <>
            <Text style={styles.bodyText} accessibilityLabel="Processor disclosures">
              Processors: {processorLine}
            </Text>
            <Text style={styles.caveat}>Private documents are only searched after you approve the exact terms. This app cannot see a provider's internal searches.</Text>
            {privacyFlows ? (
              <Text style={styles.bodyText} accessibilityLabel="Privacy data flows">
                {privacyFlows}
              </Text>
            ) : null}
            {deletionVsSub ? (
              <Text style={styles.caveat} accessibilityLabel="Deletion versus subscription">
                {deletionVsSub}
              </Text>
            ) : null}
          </>
        ) : null}
        <Pressable onPress={onOpenDeletionPage} accessibilityRole="button" accessibilityLabel="Open authenticated deletion page" style={styles.settingsRow}>
          <Text style={styles.link}>Delete in a browser</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert(
              "Delete account and research?",
              "This removes saved research and cancels active runs. Store subscriptions are managed separately.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete account", style: "destructive", onPress: onDelete },
              ],
            )
          }
          accessibilityRole="button"
          accessibilityLabel="Delete account and derived data"
          style={styles.settingsRow}
        >
          <Text style={styles.error}>Delete account and research</Text>
        </Pressable>
      </View>

      <View style={styles.section} accessibilityLabel="Help">
        <Text style={styles.kicker}>Help</Text>
        <Text style={styles.bodyText}>Ask a one-sentence question. Research runs on the server. This phone shows the question, progress, answer, and sources.</Text>
        <Text style={styles.caveat}>Stop is available while research is running. Citations open the exact passage.</Text>
      </View>

      <View style={styles.section} accessibilityLabel="About">
        <Text style={styles.kicker}>About</Text>
        <Text style={styles.bodyText}>Norrow</Text>
        <Text style={styles.caveat}>AI deep research</Text>
      </View>

      <View style={styles.section}>
        <Pressable onPress={onLogout} accessibilityRole="button" accessibilityLabel="Log out and clear saved drafts and reports" style={styles.settingsRow}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
        <Text style={styles.caveat}>Drafts and reports are saved on this device while signed in. Signing out clears this account’s saved content.</Text>
      </View>
    </ScrollView>
  );
}

function accountInitials(label: string, signedIn: boolean): string {
  if (!signedIn) return "?";
  const parts = label.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  const compact = label.replace(/[^a-zA-Z0-9]/g, "");
  return (compact.slice(0, 2) || "DR").toUpperCase();
}
