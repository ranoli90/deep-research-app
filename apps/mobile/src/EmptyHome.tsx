import { useState } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

export type HomeStarter = { id: string; label: string; description: string; scaffold: string };

/**
 * Task orientations, not engine modes. Selecting one inserts an editable
 * scaffold into the composer; it never sends, spends, or adds hidden
 * constraints. Ordinary one-sentence questions remain fully supported.
 */
export const HOME_STARTERS: readonly HomeStarter[] = [
  { id: "understand", label: "Understand a topic", description: "Find the important facts and where the evidence is limited.", scaffold: "Help me understand the evidence about " },
  { id: "compare", label: "Compare options", description: "Understand trade-offs before committing to a decision.", scaffold: "Help me compare these options: " },
  { id: "claim", label: "Check a claim", description: "See what supports a claim, what challenges it, and what is missing.", scaffold: "Check the evidence behind this claim: " },
];

type Styles = {
  emptyHero: StyleProp<ViewStyle>;
  welcomeDisplay: StyleProp<TextStyle>;
  welcomeSupport?: StyleProp<TextStyle>;
  welcomeQuiet?: StyleProp<TextStyle>;
  starterToggle?: StyleProp<ViewStyle>;
  starterToggleText?: StyleProp<TextStyle>;
  starterList?: StyleProp<ViewStyle>;
  starterRow?: StyleProp<ViewStyle>;
  starterLabel?: StyleProp<TextStyle>;
  starterDescription?: StyleProp<TextStyle>;
};

export function EmptyHome({
  onPickStarter,
  typing,
  styles,
}: {
  onPickStarter: (scaffold: string) => void;
  typing: boolean;
  styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.emptyHero} accessibilityLabel="Welcome to Norrow">
      <Text style={styles.welcomeDisplay} accessibilityRole="header">{"Research what\nmatters."}</Text>
      <Text style={styles.welcomeSupport}>Understand the evidence. See the trade-offs.</Text>
      {/* Collapse the starting-point guidance as soon as typing begins; it must
          never compete with the input. */}
      {!typing ? (
        <>
          <Text style={styles.welcomeQuiet}>Start with a question, a claim, or a decision.</Text>
          <Pressable
            onPress={() => setOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel="Choose a starting point"
            hitSlop={8}
            style={styles.starterToggle}
          >
            <Text style={styles.starterToggleText}>{open ? "Choose a starting point ▴" : "Choose a starting point ▾"}</Text>
          </Pressable>
          {open ? (
            <View style={styles.starterList} accessibilityLabel="Starting points">
              {HOME_STARTERS.map((starter) => (
                <Pressable
                  key={starter.id}
                  onPress={() => onPickStarter(starter.scaffold)}
                  accessibilityRole="button"
                  accessibilityLabel={starter.label}
                  style={styles.starterRow}
                >
                  <Text style={styles.starterLabel}>{starter.label}</Text>
                  <Text style={styles.starterDescription}>{starter.description}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
