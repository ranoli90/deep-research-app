import React from "react";
import { Alert, Pressable, ScrollView, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { UiState } from "./state";

/** Account presentation only; session authority and asynchronous mutations stay in App. */
export function ProfilePanel({
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
  onOpenDeletionPage,
}: {
  styles: { body: StyleProp<ViewStyle>; title: StyleProp<TextStyle>; bodyText: StyleProp<TextStyle>; link: StyleProp<TextStyle>; caveat: StyleProp<TextStyle>; error: StyleProp<TextStyle>; kicker?: StyleProp<TextStyle> };
  state: Pick<UiState, "signedIn" | "consentGranted" | "routeMode">;
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
  onOpenDeletionPage: () => void;
}) {
  return (
    <ScrollView style={styles.body} accessibilityLabel="Settings">
      <Text style={styles.title} accessibilityRole="header">Settings</Text>
      <Text style={styles.bodyText}>Account, privacy, and research permissions. Purchases and push notifications are currently unavailable.</Text>
      <Text style={styles.kicker}>Account</Text>
      <Pressable onPress={onSignIn} accessibilityRole="button" accessibilityLabel="Sign in development session">
        <Text style={styles.link}>{state.signedIn ? "Signed in (development)" : "Sign in (development)"}</Text>
      </Pressable>
      <Pressable onPress={onConsent} accessibilityRole="button" accessibilityLabel="Grant AI processing consent">
        <Text style={styles.link}>{state.consentGranted ? "Consent granted" : "Grant AI processing consent"}</Text>
      </Pressable>
      <Pressable onPress={() => onMode(state.routeMode === "fixture" ? "controlled-research" : "fixture")} accessibilityRole="button" accessibilityLabel="Switch between demo and research mode">
        <Text style={styles.link}>Research mode: {state.routeMode === "fixture" ? "Demo" : "Research"}</Text>
      </Pressable>
      <Text style={styles.caveat}>Demo reports are labeled and never presented as live completed research.</Text>
      <Text style={styles.kicker}>Privacy</Text>
      <Text style={styles.bodyText} accessibilityLabel="Processor disclosures">
        Processors: {processors.length ? processors.join(". ") : state.signedIn ? "Loading processor list." : "Sign in to see processor disclosures."}
      </Text>
      <Text style={styles.caveat}>This app cannot see a provider's internal searches.</Text>
      {privacyFlows ? <Text style={styles.bodyText} accessibilityLabel="Privacy data flows">{privacyFlows}</Text> : null}
      {deletionVsSub ? <Text style={styles.caveat} accessibilityLabel="Deletion versus subscription">{deletionVsSub}</Text> : null}
      <Text style={styles.kicker}>Purchases</Text>
      <Pressable onPress={onRestore} accessibilityRole="button" accessibilityLabel="Restore purchases">
        <Text style={styles.link}>Restore purchases</Text>
      </Pressable>
      {restoreMessage ? <Text style={styles.caveat} accessibilityLabel="Restore result">{restoreMessage}</Text> : null}
      <Text style={styles.caveat}>Purchases: unavailable until a store sandbox is connected. Restore explains that prerequisite and does not grant entitlement.</Text>
      <Text style={styles.caveat}>Push notifications are unavailable. Reopen the app to refresh research progress.</Text>
      <Text style={styles.kicker}>Deletion</Text>
      <Pressable onPress={onRevoke} accessibilityRole="button" accessibilityLabel="Revoke AI processing consent">
        <Text style={styles.link}>Revoke consent (stops new research)</Text>
      </Pressable>
      <Text style={styles.caveat}>Drafts and reports are saved on this device while signed in. Signing out clears this account’s saved content.</Text>
      <Pressable onPress={onLogout} accessibilityRole="button" accessibilityLabel="Log out and clear saved drafts and reports">
        <Text style={styles.link}>Log out and clear saved content</Text>
      </Pressable>
      <Pressable
        onPress={onOpenDeletionPage}
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
