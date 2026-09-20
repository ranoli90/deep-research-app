import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  UIManager,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { motion } from "@deep/design";
import {
  collapseResearchActivity,
  currentActivityLine,
  displayCollapsedSummary,
  researchTraceSections,
  runningElapsedLabel,
  visibleResearchEvents,
  type ResearchEvent,
  type VisibleResearchEvent,
} from "./research-activity";
import { liveSourcePillsFromEvents, visibleLiveSourcePills } from "./live-source-appearance";
import { ChevronIcon } from "./icons";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    /* js tests have no native LayoutAnimation */
  }
}

type Styles = {
  thinkingStream: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  activityLine: StyleProp<TextStyle>;
  activityNow: StyleProp<TextStyle>;
  activityItem: StyleProp<ViewStyle>;
  activityDetail?: StyleProp<TextStyle>;
  activityRail?: StyleProp<ViewStyle>;
  activityTick?: StyleProp<ViewStyle>;
  activityTickNow?: StyleProp<ViewStyle>;
  activityStem?: StyleProp<ViewStyle>;
  activityCopy?: StyleProp<ViewStyle>;
  link: StyleProp<TextStyle>;
  row: StyleProp<ViewStyle>;
  sourcePill?: StyleProp<ViewStyle>;
  sourcePillText?: StyleProp<TextStyle>;
  sourceRow?: StyleProp<ViewStyle>;
  shimmer?: StyleProp<TextStyle>;
  jumpLatest?: StyleProp<TextStyle>;
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
        Animated.timing(pulse, { toValue: 1, duration: motion.pulse / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.28, duration: motion.pulse / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
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

function TraceRow({
  event,
  live,
  last,
  reduced,
  animateEnter,
  styles,
}: {
  event: VisibleResearchEvent;
  live: boolean;
  last: boolean;
  reduced: boolean;
  animateEnter: boolean;
  styles: Styles;
}) {
  const opacity = useRef(new Animated.Value(reduced || !animateEnter ? 1 : 0)).current;
  const shift = useRef(new Animated.Value(reduced || !animateEnter ? 0 : 5)).current;
  useEffect(() => {
    if (reduced || !animateEnter) {
      opacity.setValue(1);
      shift.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: motion.row, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(shift, { toValue: 0, duration: motion.row, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [animateEnter, opacity, reduced, shift]);
  return (
    <Animated.View
      style={[styles.activityItem, { opacity, transform: [{ translateY: shift }] }]}
      accessibilityLabel={`Activity ${event.sequence}`}
    >
      <View style={styles.activityRail}>
        <View style={live ? styles.activityTickNow : styles.activityTick} />
        {last ? null : <View style={styles.activityStem} />}
      </View>
      <View style={styles.activityCopy}>
        <Text style={live ? styles.activityNow : styles.activityLine}>{event.label}</Text>
        {event.detail ? (
          <Text
            style={styles.activityDetail ?? styles.activityLine}
            accessibilityLabel={[event.sourceTitle, event.sourceDomain].filter(Boolean).join(" · ") || event.detail}
          >
            {event.detail}
          </Text>
        ) : null}
      </View>
    </Animated.View>
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
  showJumpToLatest = false,
  onJumpToLatest,
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
  showJumpToLatest?: boolean;
  onJumpToLatest?(): void;
  onToggle(): void;
  styles: Styles;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const seen = useRef(new Set<number>());
  const expandedRef = useRef(expanded);
  useEffect(() => {
    if (!inProgress || reducedMotion) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress, reducedMotion]);
  const visible = visibleResearchEvents(events);
  const collapsed = collapseResearchActivity({ events, lifecycle, outcome });
  const current = visible.at(-1)?.label ?? currentActivityLine([]);
  const elapsed = inProgress && lifecycle === "running" ? runningElapsedLabel(events, nowMs) : null;
  const pills = inProgress ? visibleLiveSourcePills(liveSourcePillsFromEvents(events)) : { visible: [], overflow: 0 };
  const sections = researchTraceSections(visible);
  if (!inProgress && visible.length === 0) return null;
  const rawHeadline = inProgress ? current : collapsed.summary;
  const labeled = labeledDemo ? (rawHeadline.toLowerCase().startsWith("sample") ? rawHeadline : `Sample · ${rawHeadline}`) : rawHeadline;
  const headline = collapsed.expandable ? displayCollapsedSummary(labeled) : labeled;
  const wasExpanded = expandedRef.current;
  expandedRef.current = expanded;
  function toggle() {
    if (!reducedMotion) {
      try {
        LayoutAnimation.configureNext({
          duration: motion.collapse,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
          create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
          delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
        });
      } catch {
        /* no native driver in unit tests */
      }
    }
    onToggle();
  }
  return (
    <View style={styles.thinkingStream} accessibilityLabel="Research progress">
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={expanded ? "Collapse research activity" : "Expand research activity"} hitSlop={8}>
        <View style={styles.row}>
          {inProgress ? <ResearchPulse reduced={reducedMotion} color={accent} /> : null}
          <Text
            style={[inProgress ? styles.activityNow : styles.activityLine, { flex: 1, minWidth: 0 }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={headline}
          >
            {headline}
          </Text>
          {elapsed ? <Text style={styles.activityDetail ?? styles.activityLine}>{elapsed}</Text> : null}
          {collapsed.expandable ? <ChevronIcon color={accent} down={expanded} /> : null}
        </View>
      </Pressable>
      {pills.visible.length > 0 ? (
        <View style={styles.sourceRow} accessibilityLabel="Sources found">
          {pills.visible.map((pill) => (
            <View key={pill.key} style={styles.sourcePill}>
              <Text style={styles.sourcePillText}>{pill.domain}</Text>
            </View>
          ))}
          {pills.overflow > 0 ? <Text style={styles.activityDetail}>+{pills.overflow}</Text> : null}
        </View>
      ) : null}
      {showJumpToLatest && onJumpToLatest ? (
        <Pressable onPress={onJumpToLatest} accessibilityRole="button" accessibilityLabel="Latest activity" hitSlop={8}>
          <Text style={styles.jumpLatest ?? styles.link}>Latest activity</Text>
        </Pressable>
      ) : null}
      {expanded ? sections.map((section) => (
        <View key={section.phase + String(section.events[0]?.sequence)}>
          {sections.length > 1 ? <Text style={styles.kicker}>{section.title}</Text> : null}
          {section.events.map((event) => {
            const last = event.sequence === visible.at(-1)?.sequence;
            const live = last && inProgress;
            const animateEnter = wasExpanded && !seen.current.has(event.sequence);
            seen.current.add(event.sequence);
            return (
              <TraceRow
                key={event.sequence}
                event={event}
                live={live}
                last={last}
                reduced={reducedMotion}
                animateEnter={animateEnter}
                styles={styles}
              />
            );
          })}
        </View>
      )) : null}
    </View>
  );
}
