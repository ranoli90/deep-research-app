import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Styles = {
  composerDock: StyleProp<ViewStyle>;
  composerWrap: StyleProp<ViewStyle>;
  composer: StyleProp<TextStyle>;
  sendBtn: StyleProp<ViewStyle>;
  sendBtnOff: StyleProp<ViewStyle>;
  sendBtnIcon?: StyleProp<ViewStyle>;
  sendBtnIconOff?: StyleProp<ViewStyle>;
  sendBtnQuiet?: StyleProp<ViewStyle>;
  stopBtnIcon?: StyleProp<ViewStyle>;
  send: StyleProp<TextStyle>;
  sendOff: StyleProp<TextStyle>;
  attachMark: StyleProp<TextStyle>;
  attachHit?: StyleProp<ViewStyle>;
  stopGlyph?: StyleProp<TextStyle>;
};

export function ResearchComposer({
  draft,
  muted,
  sendInk,
  editable,
  sendDisabled,
  pendingAdmission,
  placeholder = "What should I research?",
  sendLabel,
  sendAccessLabel = "Start research",
  attachOpen = false,
  inProgress = false,
  onChange,
  onSend,
  onAttach,
  onCancel,
  styles,
}: {
  draft: string;
  muted: string;
  sendInk: string;
  editable: boolean;
  sendDisabled: boolean;
  pendingAdmission: boolean;
  placeholder?: string;
  sendLabel?: string;
  sendAccessLabel?: string;
  attachOpen?: boolean;
  inProgress?: boolean;
  onChange(value: string): void;
  onSend(): void;
  onAttach(): void;
  onCancel?(): void;
  styles: Styles;
}) {
  const hasDraft = Boolean(draft.trim());
  const action = sendLabel ?? (pendingAdmission ? "Retry" : "Research");
  const stop = inProgress && Boolean(onCancel);
  const iconSend = !pendingAdmission && !stop && hasDraft;
  const idleEmpty = !pendingAdmission && !stop && !hasDraft;
  const sendStyle = stop
    ? (styles.stopBtnIcon ?? styles.sendBtnIcon ?? styles.sendBtn)
    : iconSend
      ? (sendDisabled ? styles.sendBtnIconOff ?? styles.sendBtnOff : styles.sendBtnIcon ?? styles.sendBtn)
      : (sendDisabled ? styles.sendBtnOff : styles.sendBtn);
  return (
    <View style={styles.composerDock}>
      <View style={styles.composerWrap}>
        <Pressable
          onPress={onAttach}
          accessibilityRole="button"
          accessibilityLabel={attachOpen ? "Close add sources" : "Add sources"}
          hitSlop={12}
          style={styles.attachHit ?? { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={styles.attachMark}>{attachOpen ? "×" : "+"}</Text>
        </Pressable>
        <TextInput
          editable={editable && !stop}
          value={draft}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={muted}
          style={styles.composer}
          multiline
          allowFontScaling
          maxFontSizeMultiplier={2}
          accessibilityLabel="Research question"
        />
        <Pressable
          disabled={stop ? false : sendDisabled || idleEmpty}
          accessibilityState={{ disabled: stop ? false : sendDisabled || idleEmpty }}
          onPress={() => { if (stop) onCancel?.(); else onSend(); }}
          style={idleEmpty ? (styles.sendBtnQuiet ?? styles.sendBtnIconOff ?? styles.sendBtnOff) : sendStyle}
          accessibilityRole="button"
          accessibilityLabel={stop ? "Stop research" : pendingAdmission ? "Retry" : sendAccessLabel}
          hitSlop={12}
        >
          {stop ? (
            <Text style={styles.stopGlyph ?? styles.send}>■</Text>
          ) : iconSend ? (
            <Text style={{ color: sendDisabled ? muted : sendInk, fontSize: 18, fontWeight: "700" }}>↑</Text>
          ) : pendingAdmission ? (
            <Text style={sendDisabled ? styles.sendOff : styles.send}>{action}</Text>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}
