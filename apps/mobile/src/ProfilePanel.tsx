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
  onMode,
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
  onMode: (m: UiState["routeMode"]) => void;
  onRestore: () => void;
  onDelete: () => void;
  onLogout: () => void;
  onRevoke: () => void;
  onOpenDeletionPage: () => void;
  processorDetailsOpen?: boolean;
  onToggleProcessorDetails?: () => void;
}) {
  const demoOn = state.routeMode === "fixture";
  const initials = accountInitials(accountLabel, state.signedIn);
  const processorLine = processors.length
    ? processors.join(". ")
    : state.signedIn
      ? "Loading processor list."
      : "Sign in to see processor disclosures.";

  return (
    <ScrollView style={styles.body} accessibilityLabel="Settings">
      <View style={styles.card} accessibilityLabel="Account">
        <View style={styles.row}>
          <View style={styles.avatar} accessibilityLabel={`Avatar ${initials}`}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.bodyText}>{state.signedIn ? accountLabel : "Not signed in"}</Text>
            <Text style={styles.caveat}>{state.signedIn ? "Signed in on this device" : "Sign in to save research"}</Text>
          </View>
        </View>
        <Pressable onPress={onSignIn} accessibilityRole="button" accessibilityLabel="Sign in development session">
          <Text style={styles.link}>{state.signedIn ? "Refresh session" : "Sign in"}</Text>
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
        <Text style={styles.kicker}>Privacy</Text>
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
        >
          <Text style={styles.link}>{processorDetailsOpen ? "Hide how we process data" : "How we process data"}</Text>
        </Pressable>
        {processorDetailsOpen ? (
          <>
            <Text style={styles.bodyText} accessibilityLabel="Processor disclosures">
              Processors: {processorLine}
            </Text>
            <Text style={styles.caveat}>This app cannot see a provider's internal searches.</Text>
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
        <Pressable onPress={onOpenDeletionPage} accessibilityRole="button" accessibilityLabel="Open web deletion page">
          <Text style={styles.link}>Open web deletion page</Text>
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
        >
          <Text style={styles.error}>Delete account and derived research</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.kicker}>Library</Text>
        <Pressable onPress={onOpenLibrary} accessibilityRole="button" accessibilityLabel="Open library">
          <Text style={styles.link}>Saved reports</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.kicker}>Preferences</Text>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <Text style={styles.bodyText}>Demo mode</Text>
            <Text style={styles.caveat}>Demo reports are labeled and never presented as live completed research.</Text>
          </View>
          <Switch
            value={demoOn}
            onValueChange={(next) => onMode(next ? "fixture" : "controlled-research")}
            accessibilityLabel="Switch between demo and research mode"
          />
        </View>
        <Text style={styles.bodyText}>Research mode: {demoOn ? "Demo" : "Research"}</Text>
      </View>

      <View style={styles.section}>
        <Pressable onPress={onLogout} accessibilityRole="button" accessibilityLabel="Log out and clear saved drafts and reports">
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
        <Text style={styles.caveat}>Drafts and reports are saved on this device while signed in. Signing out clears this account’s saved content.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.kicker}>Purchases</Text>
        <Text style={styles.caveat}>Purchases and push notifications are currently unavailable.</Text>
        <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel="Restore purchases">
          <Text style={styles.link}>Restore purchases</Text>
        </Pressable>
        {restoreMessage ? (
          <Text style={styles.caveat} accessibilityLabel="Restore result">
            {restoreMessage}
          </Text>
        ) : null}
        <Text style={styles.caveat}>
          Purchases: unavailable until a store sandbox is connected. Restore explains that prerequisite and does not grant entitlement.
        </Text>
        <Text style={styles.caveat}>Push notifications are unavailable. Reopen the app to refresh research progress.</Text>
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
