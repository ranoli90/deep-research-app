import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Styles = {
  composerDock: StyleProp<ViewStyle>;
  composerWrap: StyleProp<ViewStyle>;
  composer: StyleProp<TextStyle>;
  sendBtn: StyleProp<ViewStyle>;
  sendBtnOff: StyleProp<ViewStyle>;
  send: StyleProp<TextStyle>;
  sendOff: StyleProp<TextStyle>;
  attachMark: StyleProp<TextStyle>;
};

export function ResearchComposer({
  draft,
  muted,
  editable,
  sendDisabled,
  pendingAdmission,
  placeholder = "What should I research?",
  sendLabel,
  sendAccessLabel = "Start research",
  onChange,
  onSend,
  onAttach,
  styles,
}: {
  draft: string;
  muted: string;
  editable: boolean;
  sendDisabled: boolean;
  pendingAdmission: boolean;
  placeholder?: string;
  sendLabel?: string;
  sendAccessLabel?: string;
  onChange(value: string): void;
  onSend(): void;
  onAttach(): void;
  styles: Styles;
}) {
  const action = sendLabel ?? (pendingAdmission ? "Retry" : "Research");
  return (
    <View style={styles.composerDock}>
      <View style={styles.composerWrap}>
        <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Show attachment fields" hitSlop={12} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.attachMark}>+</Text>
        </Pressable>
        <TextInput
          editable={editable}
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
          disabled={sendDisabled}
          accessibilityState={{ disabled: sendDisabled }}
          onPress={onSend}
          style={sendDisabled ? styles.sendBtnOff : styles.sendBtn}
          accessibilityRole="button"
          accessibilityLabel={sendAccessLabel}
          hitSlop={12}
        >
          <Text style={sendDisabled ? styles.sendOff : styles.send}>{action}</Text>
        </Pressable>
      </View>
    </View>
  );
}
