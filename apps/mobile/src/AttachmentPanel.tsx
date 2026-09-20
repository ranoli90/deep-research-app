import { useState } from "react";
import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { publicUrlAttachment } from "./document-input";
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
  onAttachUrl?(file: { filename: string; mime: "text/plain"; text: string }): void;
  urlError?: string | null;
};

export function AttachmentPanel(props: Props) {
  const { styles, visible = true } = props;
  const [pasteOpen, setPasteOpen] = useState(Boolean(props.text));
  const [urlOpen, setUrlOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
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
      <Pressable
        onPress={() => setUrlOpen((open) => !open)}
        disabled={props.pending}
        accessibilityRole="button"
        accessibilityLabel="Add a URL"
        accessibilityState={{ disabled: props.pending, expanded: urlOpen }}
        style={styles.attachAction}
      >
        <Text style={styles.bodyText}>Add URL</Text>
      </Pressable>
      {visible && urlOpen ? (
        <>
          <TextInput
            editable={!props.pending}
            value={urlDraft}
            onChangeText={(value) => { setUrlDraft(value); setUrlError(null); }}
            placeholder="https://"
            placeholderTextColor={props.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            allowFontScaling
            maxFontSizeMultiplier={2}
            style={styles.input}
            accessibilityLabel="Source URL"
          />
          {urlError || props.urlError ? <Text style={styles.caveat}>{urlError ?? props.urlError}</Text> : null}
          <Pressable
            disabled={props.pending}
            accessibilityState={{ disabled: props.pending }}
            onPress={() => {
              try {
                const file = publicUrlAttachment(urlDraft);
                props.onAttachUrl?.(file);
                setUrlDraft("");
                setUrlError(null);
              } catch (error) {
                setUrlError(error instanceof Error ? error.message : "Enter a public http(s) URL.");
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Attach URL"
            style={styles.attachAction}
          >
            <Text style={styles.link}>Attach URL</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPress={() => setPrefsOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel="Source preferences"
        accessibilityState={{ expanded: prefsOpen }}
        style={styles.attachAction}
      >
        <Text style={styles.bodyText}>Source preferences</Text>
      </Pressable>
      {visible && prefsOpen ? (
        <Text style={styles.caveat}>Public web plus files you add. Private documents stay off the public web until you approve the exact search terms.</Text>
      ) : null}
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
