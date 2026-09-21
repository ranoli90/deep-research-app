import { useState } from "react";
import { AuthView } from "@clerk/expo/native";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Keep Clerk's native pending-session task UI mounted outside signed-in/out branches. */
export function ClerkSessionTaskView({ visible, onClose, colorScheme = "light" }: { visible: boolean; onClose(): Promise<void>; colorScheme?: "light" | "dark" }) {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dark = colorScheme === "dark";
  const close = async () => {
    if (closing) return;
    setClosing(true);
    try { await onClose(); setError(null); }
    catch { setError("Could not confirm sign-in cancellation. Reconnect and try closing again; your message is saved."); }
    finally { setClosing(false); }
  };
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { void close(); }}>
    <SafeAreaView style={{ flex: 1, backgroundColor: dark ? "#211F1C" : "#FFFCF7" }} accessibilityViewIsModal>
      <View style={{ minHeight: 52, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={{ flex: 1, paddingRight: 12, color: dark ? "#F6F2EC" : "#1C1916", fontSize: 18, fontWeight: "700" }}>Complete sign-in</Text>
        <Pressable onPress={() => { void close(); }} disabled={closing} accessibilityRole="button" accessibilityLabel="Close account security step" accessibilityState={{ disabled: closing }} hitSlop={10} style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}>
          <Text maxFontSizeMultiplier={2} style={{ color: dark ? "#D8B878" : "#76511A", fontSize: 16, fontWeight: "600" }}>{closing ? "Closing…" : "Close"}</Text>
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: dark ? "#FFB4AB" : "#B3261E", paddingHorizontal: 20, paddingVertical: 8 }}>{error}</Text> : null}
      <View style={{ flex: 1 }}>{visible ? <AuthView mode="signInOrUp" isDismissable={false} /> : null}</View>
    </SafeAreaView>
  </Modal>;
}
