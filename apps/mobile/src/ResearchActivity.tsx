import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import {
  collapseResearchActivity,
  currentActivityLine,
  runningElapsedLabel,
  visibleResearchEvents,
  type ResearchEvent,
} from "./research-activity";
import { liveSourcePillsFromEvents } from "./live-source-appearance";

type Styles = {
  thinkingStream: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  activityLine: StyleProp<TextStyle>;
  activityNow: StyleProp<TextStyle>;
  activityItem: StyleProp<ViewStyle>;
  activityDetail?: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  row: StyleProp<ViewStyle>;
  sourcePill?: StyleProp<ViewStyle>;
  sourcePillText?: StyleProp<TextStyle>;
  sourceRow?: StyleProp<ViewStyle>;
  shimmer?: StyleProp<TextStyle>;
};

function ResearchPulse({ reduced, color }: { reduced: boolean; color: string }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (reduced) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.28, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View
      accessibilityLabel="In progress"
      style={{
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: color,
        opacity: reduced ? 1 : pulse,
        marginRight: 8,
      }}
    />
  );
}

export function ResearchActivity({
  events,
  lifecycle,
  outcome,
  inProgress,
  reducedMotion,
  expanded,
  labeledDemo = false,
  accent = "#255F5A",
  onToggle,
  styles,
}: {
  events: ResearchEvent[];
  lifecycle?: string;
  outcome?: string | null;
  inProgress: boolean;
  reducedMotion: boolean;
  expanded: boolean;
  labeledDemo?: boolean;
  accent?: string;
  onToggle(): void;
  styles: Styles;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!inProgress || reducedMotion) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress, reducedMotion]);
  const visible = visibleResearchEvents(events);
  const collapsed = collapseResearchActivity({ events, lifecycle, outcome });
  const current = visible.at(-1)?.label ?? currentActivityLine([]);
  const elapsed = inProgress && lifecycle !== "cancelling" ? runningElapsedLabel(events, nowMs) : null;
  const pills = inProgress ? liveSourcePillsFromEvents(events) : [];
  if (!inProgress && visible.length === 0) return null;
  const rawHeadline = inProgress ? current : collapsed.summary;
  const headline = labeledDemo ? (rawHeadline.toLowerCase().startsWith("sample") ? rawHeadline : `Sample · ${rawHeadline}`) : rawHeadline;
  return (
    <View style={styles.thinkingStream} accessibilityLabel="Research progress">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse research activity" : "Expand research activity"} hitSlop={8}>
        <View style={styles.row}>
          {inProgress ? <ResearchPulse reduced={reducedMotion} color={accent} /> : null}
          <Text
            style={[inProgress ? styles.activityNow : styles.activityLine, { flex: 1, minWidth: 0 }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={headline}
          >
            {headline}
          </Text>
          {elapsed ? <Text style={styles.activityDetail ?? styles.activityLine}>{elapsed}</Text> : !inProgress && collapsed.expandable ? <Text style={styles.link}>Details</Text> : null}
        </View>
      </Pressable>
      {pills.length > 0 ? (
        <View style={styles.sourceRow} accessibilityLabel="Sources found">
          {pills.slice(0, 5).map((pill) => (
            <View key={pill.key} style={styles.sourcePill}>
              <Text style={styles.sourcePillText}>{pill.domain}</Text>
            </View>
          ))}
          {pills.length > 5 ? <Text style={styles.activityDetail}>+{pills.length - 5}</Text> : null}
        </View>
      ) : null}
      {expanded ? visible.map((event, index) => (
        <View key={event.sequence} style={styles.activityItem} accessibilityLabel={`Activity ${event.sequence}`}>
          <Text style={index === visible.length - 1 && inProgress ? styles.activityNow : styles.activityLine}>{event.label}</Text>
          {event.detail ? (
            <Text
              style={styles.activityDetail ?? styles.activityLine}
              accessibilityLabel={[event.sourceTitle, event.sourceDomain].filter(Boolean).join(" · ") || event.detail}
            >
              {event.detail}
            </Text>
          ) : null}
        </View>
      )) : null}
    </View>
  );
}
