import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { AttachmentDraft } from "./state";
type Props = {
  styles: { attachRow: StyleProp<ViewStyle>; input: StyleProp<TextStyle>; link: StyleProp<TextStyle>; bodyText: StyleProp<TextStyle> };
  muted: string; attachments: AttachmentDraft[]; pending: boolean; status: string | null; filename: string; text: string;
  onFilename(value: string): void; onText(value: string): void; onPick(): void; onRemove(index: number): void; onAttachNote(): void;
};
export function AttachmentPanel(props: Props) {
  const { styles } = props;
  return <View style={styles.attachRow}>
    <Pressable onPress={props.onPick} disabled={props.pending} accessibilityRole="button" accessibilityLabel="Choose PDF, text or Markdown document" accessibilityState={{ disabled: props.pending }}>
      <Text style={styles.link}>{props.pending && !props.status ? "Reading selected document…" : "Choose a document"}</Text>
    </Pressable>
    {props.status ? <Text style={styles.bodyText} accessibilityLiveRegion="polite">{props.status}</Text> : null}
    <Text style={styles.bodyText}>PDF, text or Markdown, up to 8 MiB. Selected files are sent when you submit and must be selected again if the app closes.</Text>
    {props.attachments.map((file, index) => <View key={index}>
      <Text style={styles.bodyText}>{file.filename}{file.bytes ? " — selected file" : " — pasted note"}</Text>
      <Pressable disabled={props.pending} accessibilityState={{ disabled: props.pending }} onPress={() => props.onRemove(index)} accessibilityRole="button" accessibilityLabel={`Remove ${file.filename}`}>
        <Text style={styles.link}>Remove</Text>
      </Pressable>
    </View>)}
    <TextInput editable={!props.pending} value={props.filename} onChangeText={props.onFilename} style={styles.input} allowFontScaling maxFontSizeMultiplier={2} accessibilityLabel="Attachment filename" />
    <TextInput editable={!props.pending} value={props.text} onChangeText={props.onText} placeholder="Paste a text or Markdown note" placeholderTextColor={props.muted} allowFontScaling maxFontSizeMultiplier={2} style={styles.input} accessibilityLabel="Attachment text" />
    <Pressable disabled={props.pending} accessibilityState={{ disabled: props.pending }} onPress={props.onAttachNote} accessibilityRole="button" accessibilityLabel="Attach pasted note">
      <Text style={styles.link}>Attach note ({props.attachments.length}/3)</Text>
    </Pressable>
  </View>;
}
