import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { publicSourceUrl, sourceLocation, sourceCellLabel, type SourceDetail } from "./source-view";
import { breakLongTokens } from "./report-layout";

type Props = { source: SourceDetail; onClose(): void; onOpenOriginal(url: string): void;
  styles: { sheet: StyleProp<ViewStyle>; sheetBody: StyleProp<ViewStyle>; title: StyleProp<TextStyle>;
    kicker: StyleProp<TextStyle>; bodyText: StyleProp<TextStyle>; link: StyleProp<TextStyle> } };
export function SourceSheet({ source, styles, onClose, onOpenOriginal }: Props) {
  const url = publicSourceUrl(source.locator);
  return <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Source sheet">
    <Text style={styles.title} accessibilityRole="header">{breakLongTokens(source.title)}</Text>
    <Text style={styles.kicker}>Access: {source.accessLevel} · Coverage: {source.coverage ?? "unknown"}</Text>
    <ScrollView style={styles.sheetBody} nestedScrollEnabled>
      <Text selectable style={styles.bodyText}>{sourceLocation(source)}</Text>
      <Text style={styles.bodyText}>Publisher: {source.publisher ?? "unknown"}. Publication, effective and retrieval dates unavailable.</Text>
      <Text selectable style={styles.bodyText}>{source.exactText}</Text>
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
      {url ? <Pressable onPress={() => onOpenOriginal(url)} accessibilityRole="link" accessibilityLabel="Open original source in browser">
        <Text style={styles.link}>Open original source</Text>
      </Pressable> : <Text style={styles.bodyText}>Original document is not available through a public web link.</Text>}
    </ScrollView>
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close source sheet"><Text style={styles.link}>Close</Text></Pressable>
  </View>;
}
