import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { productHaptic } from "./haptics";
import { ArrowUpIcon, CloseIcon, PlusIcon, StopIcon } from "./icons";

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
  sendHit?: StyleProp<ViewStyle>;
  stopGlyph?: StyleProp<TextStyle>;
};

function ActionGlyph({
  mode,
  reduced,
  children,
}: {
  mode: string;
  reduced: boolean;
  children: ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      return;
    }
    scale.setValue(0.86);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7, tension: 160 }).start();
  }, [mode, reduced, scale]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

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
  reducedMotion = false,
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
  reducedMotion?: boolean;
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
  const mode = stop ? "stop" : pendingAdmission ? "retry" : iconSend ? "send" : "idle";
  const glyphStyle = stop
    ? (styles.stopBtnIcon ?? styles.sendBtnIcon ?? styles.sendBtn)
    : iconSend
      ? (sendDisabled ? styles.sendBtnIconOff ?? styles.sendBtnOff : styles.sendBtnIcon ?? styles.sendBtn)
      : idleEmpty
        ? (styles.sendBtnQuiet ?? styles.sendBtnIconOff ?? styles.sendBtnOff)
        : (sendDisabled ? styles.sendBtnOff : styles.sendBtn);
  return (
    <View style={styles.composerDock}>
      <View style={styles.composerWrap}>
        <Pressable
          onPress={onAttach}
          accessibilityRole="button"
          accessibilityLabel={attachOpen ? "Close add sources" : "Add sources"}
          hitSlop={8}
          style={styles.attachHit ?? { width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          {attachOpen ? <CloseIcon color={muted} /> : <PlusIcon color={muted} />}
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
          onPress={() => {
            if (stop) {
              productHaptic("stop");
              onCancel?.();
            } else {
              productHaptic("send");
              onSend();
            }
          }}
          style={styles.sendHit ?? { width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
          accessibilityRole="button"
          accessibilityLabel={stop ? "Stop research" : pendingAdmission ? "Retry" : sendAccessLabel}
        >
          <ActionGlyph mode={mode} reduced={reducedMotion}>
            <View style={glyphStyle}>
              {stop ? (
                <StopIcon color={sendInk} />
              ) : iconSend ? (
                <ArrowUpIcon color={sendDisabled ? muted : sendInk} />
              ) : pendingAdmission ? (
                <Text style={sendDisabled ? styles.sendOff : styles.send}>{action}</Text>
              ) : (
                <ArrowUpIcon color={muted} />
              )}
            </View>
          </ActionGlyph>
        </Pressable>
      </View>
    </View>
  );
}
