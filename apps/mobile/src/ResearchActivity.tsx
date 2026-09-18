import { ActivityIndicator, Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import {
  collapseResearchActivity,
  currentActivityLine,
  visibleResearchEvents,
  type ResearchEvent,
} from "./research-activity";

type Styles = {
  card: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
  activityNow: StyleProp<TextStyle>;
  activityItem: StyleProp<ViewStyle>;
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
  const visible = visibleResearchEvents(events);
  const collapsed = collapseResearchActivity({ events, lifecycle, outcome });
  const current = currentActivityLine(events);
  if (!inProgress && visible.length === 0) return null;
  return (
    <View style={styles.card} accessibilityLabel="Research progress" accessibilityLiveRegion="polite">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse research activity" : "Expand research activity"}>
        <Text style={styles.kicker}>{inProgress ? "Researching" : "Research trail"}</Text>
        <Text style={inProgress ? styles.activityNow : styles.bodyText}>{inProgress ? current : collapsed.summary}</Text>
      </Pressable>
      {inProgress && !reducedMotion && visible.length === 0 ? <ActivityIndicator accessibilityLabel="In progress" /> : null}
      {expanded ? visible.map((event, index) => (
        <View key={event.sequence} style={styles.activityItem} accessibilityLabel={`Activity ${event.sequence}`}>
          <Text style={index === visible.length - 1 && inProgress ? styles.activityNow : styles.bodyText}>{event.label}</Text>
          {event.detail ? <Text style={styles.kicker}>{event.detail}</Text> : null}
        </View>
      )) : null}
      {inProgress ? (
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel research">
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      ) : collapsed.expandable && !expanded ? (
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel="Show research trail">
          <Text style={styles.link}>Show trail</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
