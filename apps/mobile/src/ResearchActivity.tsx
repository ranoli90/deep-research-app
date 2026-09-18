import { useEffect, useState } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
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

function Shimmer({ reduced, style }: { reduced: boolean; style?: StyleProp<TextStyle> }) {
  const [n, setN] = useState(1);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setN((value) => (value % 4) + 1), 400);
    return () => clearInterval(timer);
  }, [reduced]);
  return (
    <Text accessibilityLabel="In progress" style={[{ letterSpacing: 1 }, style]}>
      {reduced ? "…" : "·".repeat(n).padEnd(4, " ")}
    </Text>
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
  const elapsed = inProgress ? runningElapsedLabel(events, nowMs) : null;
  const pills = inProgress ? liveSourcePillsFromEvents(events) : [];
  if (!inProgress && visible.length === 0) return null;
  const rawHeadline = inProgress ? current : collapsed.summary;
  const headline = labeledDemo ? (rawHeadline.toLowerCase().startsWith("sample") ? rawHeadline : `Sample · ${rawHeadline}`) : rawHeadline;
  return (
    <View style={styles.thinkingStream} accessibilityLabel="Research progress">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse research activity" : "Expand research activity"} hitSlop={8}>
        <View style={styles.row}>
          {inProgress ? <Shimmer reduced={reducedMotion} style={styles.shimmer} /> : null}
          <Text
            style={[inProgress ? styles.activityNow : styles.activityLine, { flex: 1, minWidth: 0 }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={headline}
          >
            {headline}
          </Text>
          {elapsed ? <Text style={styles.activityDetail ?? styles.activityLine}>{elapsed} ›</Text> : !inProgress && collapsed.expandable ? <Text style={styles.link}>›</Text> : null}
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
          {event.detail ? <Text style={styles.activityDetail ?? styles.activityLine}>{event.detail}</Text> : null}
        </View>
      )) : null}
    </View>
  );
}
