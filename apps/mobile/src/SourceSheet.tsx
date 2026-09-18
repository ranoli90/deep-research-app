import React, { useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { publicSourceUrl, sourceDomain, sourceLocation, sourceCellLabel, type SourceDetail } from "./source-view";
import { sameSourceDeletionTarget, sourceDeletionTarget, sourceDeletionUnavailable, type SourceDeletionTarget } from "./source-deletion";
import { breakLongTokens } from "./report-layout";
import { uncertaintyFromSource, uncertaintyLabel } from "./uncertainty";

type Props = { source: SourceDetail; canFocus?(): boolean; onClose(): void; onOpenOriginal(url: string): void;
  onDelete?(target: SourceDeletionTarget): void; deletionPending?: boolean; deletionError?: string | null;
  offline?: boolean; admissionPending?: boolean;
  relatedClaim?: string | null;
  onChallenge?(): void; onVerify?(): void;
  styles: { sheet: StyleProp<ViewStyle>; sheetBody: StyleProp<ViewStyle>; title: StyleProp<TextStyle>;
    kicker: StyleProp<TextStyle>; bodyText: StyleProp<TextStyle>; link: StyleProp<TextStyle>; quote?: StyleProp<TextStyle> } };
export function SourceSheet({ source, canFocus, styles, onClose, onOpenOriginal, onDelete, deletionPending = false,
  deletionError, offline = false, admissionPending = false, relatedClaim, onChallenge, onVerify }: Props) {
  const heading = useRef<Text>(null);
  const focusedPassage = useRef<string | null>(null);
  const [confirmation, setConfirmation] = useState<SourceDeletionTarget | null>(null);
  const target = sourceDeletionTarget(source);
  const unavailable = sourceDeletionUnavailable({ target, offline, admissionPending, busy: deletionPending });
  const confirming = sameSourceDeletionTarget(confirmation, target);
  const url = publicSourceUrl(source.locator);
  const domain = sourceDomain(source.locator);
  const quality = uncertaintyFromSource(source);
  return <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Source sheet">
    <Text ref={heading} onLayout={() => {
      if (focusedPassage.current === source.passageId || canFocus?.() === false) return;
      const tag = findNodeHandle(heading.current);
      if (tag !== null) { focusedPassage.current = source.passageId; AccessibilityInfo.setAccessibilityFocus(tag); }
    }} style={styles.title} accessibilityRole="header">{breakLongTokens(source.title)}</Text>
    <ScrollView style={styles.sheetBody} nestedScrollEnabled>
      <Text selectable style={styles.quote ?? styles.bodyText}>{source.exactText}</Text>
      <Text style={styles.kicker}>{domain ? `${domain} · ` : ""}{uncertaintyLabel(quality)} · Access: {source.accessLevel} · Coverage: {source.coverage ?? "unknown"}</Text>
      {relatedClaim ? <Text style={styles.bodyText} accessibilityLabel="Related claim">Cited in: {relatedClaim}</Text> : null}
      {onChallenge ? <Pressable onPress={onChallenge} accessibilityRole="button" accessibilityLabel="Challenge this conclusion" hitSlop={12}>
        <Text style={styles.link}>Challenge this conclusion</Text>
      </Pressable> : null}
      {onVerify ? <Pressable onPress={onVerify} accessibilityRole="button" accessibilityLabel="Request targeted verification" hitSlop={12}>
        <Text style={styles.link}>Verify this conclusion</Text>
      </Pressable> : null}
      <Text selectable style={styles.bodyText}>{sourceLocation(source)}</Text>
      <Text style={styles.bodyText}>Publisher: {source.publisher ?? "unknown"}. Publication, effective and retrieval dates unavailable.</Text>
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
      {url ? <Pressable onPress={() => onOpenOriginal(url)} accessibilityRole="link" accessibilityLabel="Open original source in browser" hitSlop={12}>
        <Text style={styles.link}>Open original source</Text>
      </Pressable> : <Text style={styles.bodyText}>Original document is not available through a public web link.</Text>}
      {onDelete ? <View>
        {deletionError ? <Text style={styles.bodyText} accessibilityLiveRegion="polite">{deletionError}</Text> : null}
        {unavailable ? <Text style={styles.bodyText} accessibilityLiveRegion="polite">{unavailable}</Text> : null}
        {confirming ? <View accessibilityLabel="Confirm source deletion">
          <Text style={styles.bodyText}>Delete this source from your account? Its stored content will be removed and research that depends on it will become unavailable. Copies of an uploaded document used by other research are included. Cached reports and selected attachments on this device will be cleared; other saved reports can be reopened from Library. Your original file is unchanged.</Text>
          <Pressable disabled={!!unavailable} accessibilityState={{disabled:!!unavailable}} accessibilityRole="button" accessibilityLabel="Confirm delete source and dependent research"
            onPress={() => { if (!unavailable && target && sameSourceDeletionTarget(confirmation,target)) { setConfirmation(null); onDelete(target); } }}>
            <Text style={styles.link}>Delete source and dependent research</Text>
          </Pressable>
          <Pressable disabled={deletionPending} accessibilityRole="button" accessibilityLabel="Keep source" onPress={() => setConfirmation(null)}><Text style={styles.link}>Keep source</Text></Pressable>
        </View> : <Pressable disabled={!!unavailable} accessibilityState={{disabled:!!unavailable}} accessibilityRole="button" accessibilityLabel="Delete this source"
          onPress={() => { if (!unavailable && target) setConfirmation(target); }}><Text style={styles.link}>Delete this source</Text></Pressable>}
      </View> : null}
    </ScrollView>
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close source sheet" hitSlop={12}><Text style={styles.link}>Close</Text></Pressable>
  </View>;
}
