import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { ResearchBriefView } from "./research-brief";

type Styles = {
  card: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  title: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  send: StyleProp<TextStyle>;
  input: StyleProp<TextStyle>;
};

export function ResearchBriefCard({
  view,
  clarifyAnswer,
  muted,
  onClarify,
  onContinue,
  onEdit,
  styles,
}: {
  view: ResearchBriefView;
  clarifyAnswer: string;
  muted: string;
  onClarify(value: string): void;
  onContinue(): void;
  onEdit(): void;
  styles: Styles;
}) {
  if (!view.show) return null;
  return (
    <View style={styles.card} accessibilityLabel={view.blocking ? "Clarification needed" : "Researching this"}>
      <Text style={styles.kicker}>{view.blocking ? "Need one detail" : "Researching this"}</Text>
      <Text style={styles.bodyText}>{view.objective}</Text>
      {view.assumptions.map((line) => (
        <Text key={line} style={styles.kicker}>{line}</Text>
      ))}
      {view.materialClarification ? <Text style={styles.bodyText}>{view.materialClarification}</Text> : null}
      {view.blocking ? (
        <>
          <TextInput
            value={clarifyAnswer}
            onChangeText={onClarify}
            placeholder="Jurisdiction"
            placeholderTextColor={muted}
            style={styles.input}
            allowFontScaling
            maxFontSizeMultiplier={2}
            accessibilityLabel="Clarification answer"
          />
          <Pressable
            onPress={onContinue}
            accessibilityRole="button"
            accessibilityLabel="Submit clarification and continue"
            disabled={!clarifyAnswer.trim()}
          >
            <Text style={styles.send}>Continue research</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit assumptions">
          <Text style={styles.link}>Edit assumptions</Text>
        </Pressable>
      )}
    </View>
  );
}
