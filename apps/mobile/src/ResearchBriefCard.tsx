import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { clarificationPlaceholder, type ResearchBriefView } from "./research-brief";

type Styles = {
  card: StyleProp<ViewStyle>;
  kicker: StyleProp<TextStyle>;
  title: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
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
    <View style={styles.card} accessibilityLabel={view.blocking ? "Clarification needed" : "Assumptions"}>
      <Text style={styles.kicker}>{view.blocking ? "Need one detail" : "Assumptions"}</Text>
      {view.blocking ? (
        <Text style={styles.bodyText}>{view.materialClarification ?? view.objective}</Text>
      ) : (
        view.assumptions.map((line) => (
          <Text key={line} style={styles.bodyText}>{line}</Text>
        ))
      )}
      {view.blocking || clarifyAnswer ? (
        <>
          <TextInput
            value={clarifyAnswer}
            onChangeText={onClarify}
            placeholder={view.blocking ? clarificationPlaceholder(view.materialClarification) : "Answer the detail above"}
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
            <Text style={styles.link}>Continue research</Text>
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
