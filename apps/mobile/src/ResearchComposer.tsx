import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Styles = {
  composerWrap: StyleProp<ViewStyle>;
  composer: StyleProp<TextStyle>;
  sendBtn: StyleProp<ViewStyle>;
  send: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
};

export function ResearchComposer({
  draft,
  muted,
  editable,
  sendDisabled,
  pendingAdmission,
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
  onChange(value: string): void;
  onSend(): void;
  onAttach(): void;
  styles: Styles;
}) {
  return (
    <View style={styles.composerWrap}>
      <Pressable onPress={onAttach} accessibilityRole="button" accessibilityLabel="Show attachment fields" hitSlop={8}>
        <Text style={styles.link}>Attach</Text>
      </Pressable>
      <TextInput
        editable={editable}
        value={draft}
        onChangeText={onChange}
        placeholder="What should I research?"
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
        style={styles.sendBtn}
        accessibilityRole="button"
        accessibilityLabel="Start research"
        hitSlop={12}
      >
        <Text style={styles.send}>{pendingAdmission ? "Retry" : "Research"}</Text>
      </Pressable>
    </View>
  );
}
