import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { composer as composerMetrics } from "@deep/design";
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
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7, tension: 160, delay: 0 }).start();
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
  placeholder = "Ask anything…",
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
  const stop = inProgress && Boolean(onCancel) && !hasDraft;
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
          style={({ pressed }) => [
            styles.attachHit ?? { width: composerMetrics.hit, height: composerMetrics.hit, alignItems: "center", justifyContent: "center" },
            !reducedMotion && pressed ? { opacity: 0.82 } : null,
          ]}
        >
          {attachOpen ? <CloseIcon color={muted} size={16} /> : <PlusIcon color={muted} size={composerMetrics.attachIcon} />}
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
          style={({ pressed }) => [
            styles.sendHit ?? { width: composerMetrics.hit, height: composerMetrics.hit, alignItems: "center", justifyContent: "center" },
            !reducedMotion && pressed ? { opacity: 0.82 } : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={stop ? "Stop research" : pendingAdmission ? "Retry" : sendAccessLabel}
        >
          <ActionGlyph mode={mode} reduced={reducedMotion}>
            <View style={glyphStyle}>
              {stop ? (
                <StopIcon color={sendInk} size={12} />
              ) : iconSend ? (
                <ArrowUpIcon color={sendDisabled ? muted : sendInk} size={16} />
              ) : pendingAdmission ? (
                <Text style={sendDisabled ? styles.sendOff : styles.send}>{action}</Text>
              ) : (
                <ArrowUpIcon color={muted} size={16} />
              )}
            </View>
          </ActionGlyph>
        </Pressable>
      </View>
    </View>
  );
}
