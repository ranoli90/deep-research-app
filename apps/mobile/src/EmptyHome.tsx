import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Styles = {
  emptyHero: StyleProp<ViewStyle>;
  welcomeDisplay: StyleProp<TextStyle>;
  exampleRow: StyleProp<ViewStyle>;
  exampleChip: StyleProp<ViewStyle>;
  exampleChipText: StyleProp<TextStyle>;
};

export function EmptyHome({
  title,
  examples,
  onPick,
  styles,
}: {
  title: string;
  examples: readonly string[];
  onPick: (example: string) => void;
  styles: Styles;
}) {
  return (
    <View style={styles.emptyHero} accessibilityLabel="Empty research">
      <Text style={styles.welcomeDisplay}>{title}</Text>
      <View style={styles.exampleRow}>
        {examples.map((example) => (
          <Pressable
            key={example}
            onPress={() => onPick(example)}
            accessibilityRole="button"
            accessibilityLabel={`Use example: ${example}`}
            hitSlop={8}
            style={styles.exampleChip}
          >
            <Text style={styles.exampleChipText}>{example}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
