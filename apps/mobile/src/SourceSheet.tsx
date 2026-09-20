import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, findNodeHandle, Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { motion } from "@deep/design";
import { publicSourceUrl, sourceDomain, sourceLocation, sourceCellLabel, sourceFreshnessCopy, sourceIndependenceCopy, type SourceDetail } from "./source-view";
import { sameSourceDeletionTarget, sourceDeletionTarget, sourceDeletionUnavailable, type SourceDeletionTarget } from "./source-deletion";
import { breakLongTokens } from "./report-layout";
import { uncertaintyFromSource, uncertaintyLabel } from "./uncertainty";
import { CloseIcon } from "./icons";
import { productHaptic } from "./haptics";

type Props = {
  source: SourceDetail;
  canFocus?(): boolean;
  onClose(): void;
  onOpenOriginal(url: string): void;
  onDelete?(target: SourceDeletionTarget): void;
  deletionPending?: boolean;
  deletionError?: string | null;
  offline?: boolean;
  admissionPending?: boolean;
  relatedClaim?: string | null;
  claimChoices?: { id: string; text: string }[];
  selectedClaimId?: string | null;
  onSelectClaim?(claimId: string): void;
  onChallenge?(): void;
  onVerify?(): void;
  reducedMotion?: boolean;
  ink?: string;
  styles: {
    sheet: StyleProp<ViewStyle>;
    sheetBody: StyleProp<ViewStyle>;
    sheetHandle?: StyleProp<ViewStyle>;
    sheetField?: StyleProp<ViewStyle>;
    title: StyleProp<TextStyle>;
    kicker: StyleProp<TextStyle>;
    bodyText: StyleProp<TextStyle>;
    link: StyleProp<TextStyle>;
    quietLink?: StyleProp<TextStyle>;
    quote?: StyleProp<TextStyle>;
    headerIconHit?: StyleProp<ViewStyle>;
  };
};

export function SourceSheet({
  source, canFocus, styles, onClose, onOpenOriginal, onDelete, deletionPending = false,
  deletionError, offline = false, admissionPending = false, relatedClaim, claimChoices = [], selectedClaimId = null, onSelectClaim, onChallenge, onVerify,
  reducedMotion = false, ink = "#1C1916",
}: Props) {
  const heading = useRef<Text>(null);
  const focusedPassage = useRef<string | null>(null);
  const [confirmation, setConfirmation] = useState<SourceDeletionTarget | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const rise = useRef(new Animated.Value(reducedMotion ? 0 : 24)).current;
  const fade = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      rise.setValue(0);
      fade.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(rise, { toValue: 0, duration: motion.sheet, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: motion.fast, useNativeDriver: true }),
    ]).start();
  }, [reducedMotion, rise, fade]);
  const target = sourceDeletionTarget(source);
  const unavailable = sourceDeletionUnavailable({ target, offline, admissionPending, busy: deletionPending });
  const confirming = sameSourceDeletionTarget(confirmation, target);
  const url = publicSourceUrl(source.locator);
  const domain = sourceDomain(source.locator);
  const quality = uncertaintyFromSource(source);
  const publisher = source.publisher?.trim() || domain || "Unknown publisher";
  return (
    <Animated.View
      style={[styles.sheet, { opacity: fade, transform: [{ translateY: rise }] }]}
      accessibilityViewIsModal
      accessibilityLabel="Source sheet"
    >
      {styles.sheetHandle ? <View style={styles.sheetHandle} /> : null}
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <Text style={styles.kicker}>Source</Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close source sheet"
          hitSlop={12}
          style={styles.headerIconHit ?? { width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <CloseIcon color={ink} />
        </Pressable>
      </View>
      <ScrollView style={styles.sheetBody} nestedScrollEnabled>
        <View style={styles.sheetField}>
          <Text style={styles.kicker}>Quote</Text>
          <Text selectable style={styles.quote ?? styles.bodyText}>{source.exactText}</Text>
        </View>
        <Text style={styles.bodyText}>{publisher}{domain && source.publisher ? ` · ${domain}` : ""}</Text>
        {claimChoices.length > 1 ? (
          <View style={styles.sheetField} accessibilityLabel="Choose conclusion">
            <Text style={styles.kicker}>Which conclusion?</Text>
            {claimChoices.map((claim) => (
              <Pressable
                key={claim.id}
                onPress={() => onSelectClaim?.(claim.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedClaimId === claim.id }}
                accessibilityLabel={claim.text}
                hitSlop={12}
              >
                <Text style={selectedClaimId === claim.id ? styles.link : styles.bodyText}>
                  {selectedClaimId === claim.id ? "Selected · " : ""}{claim.text}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : relatedClaim ? (
          <View style={styles.sheetField}>
            <Text style={styles.kicker}>Claim</Text>
            <Text style={styles.bodyText} accessibilityLabel="Related claim" numberOfLines={3} ellipsizeMode="tail">Cited in: {relatedClaim}</Text>
          </View>
        ) : null}
        <Text ref={heading} onLayout={() => {
          if (focusedPassage.current === source.passageId || canFocus?.() === false) return;
          const tag = findNodeHandle(heading.current);
          if (tag !== null) { focusedPassage.current = source.passageId; AccessibilityInfo.setAccessibilityFocus(tag); }
        }} style={styles.title} accessibilityRole="header">{breakLongTokens(source.title)}</Text>
        <View style={styles.sheetField}>
          <Text style={styles.kicker}>Freshness</Text>
          <Text style={styles.bodyText}>{sourceFreshnessCopy(source)}</Text>
        </View>
        <View style={styles.sheetField}>
          <Text style={styles.kicker}>Independence</Text>
          <Text style={styles.bodyText}>{sourceIndependenceCopy(source)}</Text>
        </View>
        <View style={styles.sheetField}>
          <Text style={styles.kicker}>Relationship</Text>
          <Text style={styles.bodyText}>{uncertaintyLabel(quality)}</Text>
        </View>
        {url ? <Pressable onPress={() => onOpenOriginal(url)} accessibilityRole="link" accessibilityLabel="Open original source in browser" hitSlop={12}>
          <Text style={styles.link}>Open original source</Text>
        </Pressable> : <Text style={styles.bodyText}>Original document is not available through a public web link.</Text>}
        {onChallenge ? <Pressable onPress={onChallenge} accessibilityRole="button" accessibilityLabel="Challenge this conclusion" hitSlop={12}>
          <Text style={styles.link}>Challenge this conclusion</Text>
        </Pressable> : null}
        {onVerify ? <Pressable onPress={onVerify} accessibilityRole="button" accessibilityLabel="Request targeted verification" hitSlop={12}>
          <Text style={styles.link}>Verify this conclusion</Text>
        </Pressable> : null}
        <Pressable onPress={() => setTechnicalOpen((open) => !open)} accessibilityRole="button" accessibilityLabel={technicalOpen ? "Hide technical details" : "Show technical details"} hitSlop={12}>
          <Text style={styles.link}>{technicalOpen ? "Hide technical details" : "Technical details ›"}</Text>
        </Pressable>
        {technicalOpen ? <View accessibilityLabel="Technical details">
          <Text style={styles.bodyText}>Access: {source.accessLevel} · Coverage: {source.coverage ?? "unknown"}</Text>
          <Text selectable style={styles.bodyText}>{sourceLocation(source)}</Text>
          {source.passageLocator?.rows?.length ? <View accessibilityLabel="Extracted table rows">
            <Text style={styles.kicker}>Extracted table (row order preserved)</Text>
            {source.passageLocator.rows.map((row, index) => <Text key={index} selectable style={styles.bodyText}>Row {index + 1}: {row.map(sourceCellLabel).join(" | ")}</Text>)}
          </View> : null}
          <Text style={styles.bodyText}>Extraction: {source.extractionMethod ?? "unknown"}</Text>
          {source.warnings?.map((warning, index) => <Text key={index} selectable style={styles.bodyText}>{warning}</Text>)}
          {source.coverage !== "complete" ? <Text style={styles.bodyText}>This extraction may omit content or structure. The displayed passage does not establish complete document coverage.</Text> : null}
          {source.passageLocator?.geometry?.length ? <View accessibilityLabel="Extracted passage coordinates">
            <Text style={styles.kicker}>Extracted coordinates: {source.passageLocator.coordinates ?? "coordinate system unknown"}. No page image or highlight is available.</Text>
            {source.passageLocator.geometry.map((item, index) => <Text selectable key={index} style={styles.bodyText}>{item.text} — {item.box.join(", ")}</Text>)}
          </View> : null}
          <Text selectable style={styles.bodyText}>Source version: {source.sourceVersionId ?? "unavailable"}</Text>
        </View> : null}
        {onDelete ? <View>
          {deletionError ? <Text style={styles.bodyText} accessibilityLiveRegion="polite">{deletionError}</Text> : null}
          {unavailable ? <Text style={styles.bodyText} accessibilityLiveRegion="polite">{unavailable}</Text> : null}
          {confirming ? <View accessibilityLabel="Confirm source deletion">
            <Text style={styles.bodyText}>Delete this source from your account? Its stored content will be removed and research that depends on it will become unavailable. Copies of an uploaded document used by other research are included. Cached reports and selected attachments on this device will be cleared; other saved reports can be reopened from Library. Your original file is unchanged.</Text>
            <Pressable disabled={!!unavailable} accessibilityState={{disabled:!!unavailable}} accessibilityRole="button" accessibilityLabel="Confirm delete source and dependent research"
              onPress={() => { if (!unavailable && target && sameSourceDeletionTarget(confirmation,target)) { productHaptic("warn"); setConfirmation(null); onDelete(target); } }}>
              <Text style={styles.link}>Delete source and dependent research</Text>
            </Pressable>
            <Pressable disabled={deletionPending} accessibilityRole="button" accessibilityLabel="Keep source" onPress={() => setConfirmation(null)}><Text style={styles.link}>Keep source</Text></Pressable>
          </View> : <Pressable disabled={!!unavailable} accessibilityState={{disabled:!!unavailable}} accessibilityRole="button" accessibilityLabel="Delete this source"
            onPress={() => { if (!unavailable && target) setConfirmation(target); }}><Text style={styles.quietLink ?? styles.link}>Delete this source</Text></Pressable>}
        </View> : null}
      </ScrollView>
    </Animated.View>
  );
}
