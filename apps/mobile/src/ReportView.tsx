import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { space } from "@deep/design";
import { breakLongTokens, parseTable } from "./report-layout";
import { citationChipLabel } from "./citation-chips";
import { editorialSections } from "./report-hierarchy";
import { uncertaintyFromBlock, uncertaintyLabel } from "./uncertainty";
import type { ReportBlock } from "./state";

export type ReportStyles = {
  card: StyleProp<ViewStyle>;
  row: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  outline: StyleProp<ViewStyle>;
  outlineItem: StyleProp<TextStyle>;
  bounded: StyleProp<ViewStyle>;
  tableRow: StyleProp<ViewStyle>;
  tableHead: StyleProp<TextStyle>;
  tableCell: StyleProp<TextStyle>;
  code: StyleProp<TextStyle>;
  quote: StyleProp<TextStyle>;
  title: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
  caveat: StyleProp<TextStyle>;
  citeRow: StyleProp<ViewStyle>;
  citeLink: StyleProp<TextStyle>;
  citeChip: StyleProp<TextStyle>;
  answerText: StyleProp<TextStyle>;
};

export function ReportBlockView({
  block,
  styles,
  onOpenSource,
  onLayoutY,
  emphasizeAnswer = false,
  citationIndex = {},
}: {
  block: ReportBlock;
  styles: ReportStyles;
  onOpenSource: (id: string) => void;
  onLayoutY?: (y: number) => void;
  emphasizeAnswer?: boolean;
  citationIndex?: Record<string, number>;
}) {
  const text = breakLongTokens(block.text);
  const uncertainty = uncertaintyFromBlock(block);
  let body: ReactNode;
  if (block.kind === "table") {
    const rows = parseTable(block.text);
    body = (
      <View style={styles.bounded}>
        <ScrollView horizontal nestedScrollEnabled accessibilityLabel={`Table ${block.id}`}>
          <View>
            {rows.map((row, i) => (
              <View key={`${block.id}-r${i}`} style={styles.tableRow}>
                {row.map((cell, j) => (
                  <Text
                    key={`${block.id}-c${i}-${j}`}
                    selectable
                    style={[i === 0 ? styles.tableHead : styles.tableCell, { flexShrink: 0 }]}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  } else if (block.kind === "code") {
    body = (
      <View style={styles.bounded}>
        <ScrollView horizontal nestedScrollEnabled accessibilityLabel={`Code ${block.id}`}>
          <Text selectable style={styles.code}>{block.text}</Text>
        </ScrollView>
      </View>
    );
  } else if (block.kind === "heading") {
    body = <Text selectable accessibilityRole="header" style={styles.title}>{text}</Text>;
  } else if (block.kind === "quote") {
    body = <Text selectable style={styles.quote}>{text}</Text>;
  } else {
    body = <Text selectable style={block.kind === "caveat" ? styles.caveat : emphasizeAnswer ? styles.answerText : styles.bodyText}>{text}</Text>;
  }
  return (
    <View
      nativeID={`block-${block.id}`}
      style={{ marginBottom: space.md }}
      onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}
    >
      {uncertainty ? <Text style={styles.kicker}>{uncertaintyLabel(uncertainty)}</Text> : null}
      {body}
      <View style={styles.citeRow}>
        {block.citationIds.map((id) => {
          const index = citationIndex[id];
          if (index == null) return null;
          return (
            <Pressable
              key={id}
              onPress={() => onOpenSource(id)}
              accessibilityRole="button"
              accessibilityLabel={`Open source ${index}`}
              hitSlop={12}
            >
              <Text style={[styles.link, styles.citeLink, styles.citeChip]}>{citationChipLabel(index)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ReportSections({
  blocks,
  detailed,
  styles,
  onOpenSource,
  onLayoutY,
  citationIndex = {},
}: {
  blocks: ReportBlock[];
  detailed: boolean;
  styles: ReportStyles;
  onOpenSource: (id: string, blockId: string) => void;
  onLayoutY: (blockId: string, y: number) => void;
  citationIndex?: Record<string, number>;
}) {
  const sections = editorialSections(blocks);
  return (
    <>
      {detailed && sections.length > 1 ? (
        <View style={styles.outline} accessibilityLabel="Report outline">
          <Text style={styles.kicker}>Outline</Text>
          {sections.map((section) => (
            <Text key={`outline-${section.id}`} style={styles.outlineItem}>
              {section.title}
            </Text>
          ))}
        </View>
      ) : null}
      {sections.map((section) => (
        <View key={section.id} accessibilityLabel={section.title}>
          <Text style={styles.kicker}>{section.title}</Text>
          {section.blocks.map((b) => (
            <ReportBlockView
              key={b.id}
              block={b}
              styles={styles}
              onOpenSource={(id) => onOpenSource(id, b.id)}
              onLayoutY={(y) => onLayoutY(b.id, y)}
              emphasizeAnswer={section.id === "answer"}
              citationIndex={citationIndex}
            />
          ))}
        </View>
      ))}
    </>
  );
}
