import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import {
  collapseResearchActivity,
  currentActivityLine,
  runningElapsedLabel,
  visibleResearchEvents,
  type ResearchEvent,
} from "./research-activity";

type Styles = {
  card: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
  activityNow: StyleProp<TextStyle>;
  activityItem: StyleProp<ViewStyle>;
  activityDetail?: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  row: StyleProp<ViewStyle>;
};

export function ResearchActivity({
  events,
  lifecycle,
  outcome,
  inProgress,
  reducedMotion,
  expanded,
  onToggle,
  onCancel,
  styles,
}: {
  events: ResearchEvent[];
  lifecycle?: string;
  outcome?: string | null;
  inProgress: boolean;
  reducedMotion: boolean;
  expanded: boolean;
  onToggle(): void;
  onCancel(): void;
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
  const headline = inProgress
    ? (elapsed ? `${current} · ${elapsed}` : current)
    : collapsed.summary;
  if (!inProgress && visible.length === 0) return null;
  return (
    <View style={styles.card} accessibilityLabel="Research progress">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse research activity" : "Expand research activity"} hitSlop={8}>
        <View style={styles.row}>
          <Text style={styles.kicker}>{inProgress ? (lifecycle === "awaiting_input" ? "Need a detail" : lifecycle === "queued" ? "Queued" : "Researching") : "Research trail"}</Text>
          {inProgress && !reducedMotion ? <ActivityIndicator accessibilityLabel="In progress" /> : null}
        </View>
        <Text
          style={inProgress ? styles.activityNow : styles.bodyText}
          accessibilityLiveRegion="polite"
          accessibilityLabel={inProgress ? current : collapsed.summary}
        >
          {headline}
        </Text>
      </Pressable>
      {inProgress && reducedMotion ? <Text style={styles.activityDetail ?? styles.bodyText} accessibilityLabel="In progress">In progress</Text> : null}
      {expanded ? visible.map((event, index) => (
        <View key={event.sequence} style={styles.activityItem} accessibilityLabel={`Activity ${event.sequence}`}>
          <Text style={index === visible.length - 1 && inProgress ? styles.activityNow : styles.bodyText}>{event.label}</Text>
          {event.detail ? <Text style={styles.activityDetail ?? styles.bodyText}>{event.detail}</Text> : null}
        </View>
      )) : null}
      {inProgress ? (
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel research" hitSlop={12}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      ) : collapsed.expandable && !expanded ? (
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel="Show research trail" hitSlop={12}>
          <Text style={styles.link}>Show trail</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
