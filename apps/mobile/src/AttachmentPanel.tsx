import { useState } from "react";
import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import type { AttachmentDraft } from "./state";

type Props = {
  styles: {
    attachSheet: StyleProp<ViewStyle>;
    attachAction: StyleProp<ViewStyle>;
    input: StyleProp<TextStyle>;
    link: StyleProp<TextStyle>;
    bodyText: StyleProp<TextStyle>;
    kicker: StyleProp<TextStyle>;
    caveat: StyleProp<TextStyle>;
  };
  muted: string;
  attachments: AttachmentDraft[];
  pending: boolean;
  visible?: boolean;
  status: string | null;
  filename: string;
  text: string;
  onFilename(value: string): void;
  onText(value: string): void;
  onPick(): void;
  onRemove(index: number): void;
  onAttachNote(): void;
};

export function AttachmentPanel(props: Props) {
  const { styles, visible = true } = props;
  const [pasteOpen, setPasteOpen] = useState(Boolean(props.text));
  const fieldsOpen = visible && pasteOpen;
  return (
    <View style={styles.attachSheet} accessibilityLabel="Add sources">
      <Text style={styles.kicker}>Add sources</Text>
      <Pressable
        onPress={props.onPick}
        disabled={props.pending}
        accessibilityRole="button"
        accessibilityLabel="Choose PDF, text or Markdown document"
        accessibilityState={{ disabled: props.pending }}
        style={styles.attachAction}
      >
        <Text style={styles.bodyText}>{props.pending && !props.status ? "Reading selected document…" : "Files"}</Text>
        <Text style={styles.caveat}>PDF, .txt, .md · up to 8 MiB · {props.attachments.length}/3</Text>
      </Pressable>
      <Pressable
        onPress={() => setPasteOpen((open) => !open)}
        disabled={props.pending}
        accessibilityRole="button"
        accessibilityLabel="Paste a note"
        accessibilityState={{ disabled: props.pending, expanded: pasteOpen }}
        style={styles.attachAction}
      >
        <Text style={styles.bodyText}>Paste note</Text>
      </Pressable>
      {fieldsOpen ? (
        <>
          <TextInput
            editable={!props.pending}
            value={props.text}
            onChangeText={props.onText}
            placeholder="Paste a text or Markdown note"
            placeholderTextColor={props.muted}
            allowFontScaling
            maxFontSizeMultiplier={2}
            style={styles.input}
            accessibilityLabel="Attachment text"
            showSoftInputOnFocus
          />
          <Pressable
            disabled={props.pending}
            accessibilityState={{ disabled: props.pending }}
            onPress={props.onAttachNote}
            accessibilityRole="button"
            accessibilityLabel="Attach pasted note"
            style={styles.attachAction}
          >
            <Text style={styles.link}>Attach note ({props.attachments.length}/3)</Text>
          </Pressable>
        </>
      ) : null}
      {props.status ? <Text style={styles.bodyText} accessibilityLiveRegion="polite">{props.status}</Text> : null}
      {props.attachments.map((file, index) => (
        <View key={`${file.filename}-${index}`} style={styles.attachAction}>
          <Text style={styles.bodyText}>{file.filename}{file.bytes ? " — file" : " — pasted note"}</Text>
          <Pressable
            disabled={props.pending}
            accessibilityState={{ disabled: props.pending }}
            onPress={() => props.onRemove(index)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${file.filename}`}
          >
            <Text style={styles.link}>Remove</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
