import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { OUTPUT_REPORT_CATEGORIES } from "@deep/contracts";

type Styles = {
  bodyText: StyleProp<TextStyle>;
  quietLink: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  caveat: StyleProp<TextStyle>;
  kicker: StyleProp<TextStyle>;
  input: StyleProp<TextStyle>;
  error: StyleProp<TextStyle>;
};

export function ReportActions({
  labeledDemo,
  showVerification,
  verificationNote,
  verificationBusy,
  pendingVerification,
  verificationPolicy,
  flagSent,
  flagStatus,
  flagOpen,
  flagCategory,
  flagNote,
  flagInclude,
  styles,
  onShare,
  onToggleVerification,
  onVerificationNote,
  onTogglePolicy,
  onSubmitVerification,
  onToggleFlag,
  onFlagCategory,
  onFlagNote,
  onToggleFlagInclude,
  onSubmitFlag,
}: {
  labeledDemo: boolean;
  showVerification: boolean;
  verificationNote: string;
  verificationBusy: boolean;
  pendingVerification: boolean;
  verificationPolicy: "reuse_snapshot" | "refresh_sources";
  flagSent: boolean;
  flagStatus: "idle" | "submitting" | "submitted" | "error";
  flagOpen: boolean;
  flagCategory: (typeof OUTPUT_REPORT_CATEGORIES)[number];
  flagNote: string;
  flagInclude: boolean;
  styles: Styles;
  onShare(): void;
  onToggleVerification(): void;
  onVerificationNote(value: string): void;
  onTogglePolicy(): void;
  onSubmitVerification(): void;
  onToggleFlag(): void;
  onFlagCategory(value: (typeof OUTPUT_REPORT_CATEGORIES)[number]): void;
  onFlagNote(value: string): void;
  onToggleFlagInclude(): void;
  onSubmitFlag(): void;
}) {
  return (
    <>
      <Pressable onPress={onShare} accessibilityRole="button" accessibilityLabel="Share report" hitSlop={12}>
        <Text style={styles.link}>Share report</Text>
      </Pressable>
      {!labeledDemo ? (
        <View>
          <Pressable onPress={onToggleVerification} accessibilityRole="button" accessibilityLabel="Recheck the answer claim" hitSlop={12}>
            <Text style={styles.quietLink}>{showVerification ? "Hide recheck" : "Recheck answer"}</Text>
          </Pressable>
          {showVerification ? (
            <>
              <Text style={styles.bodyText}>Recheck the answer claim against the inspected source evidence. This uses your research allowance; it does not independently establish every fact.</Text>
              <TextInput
                value={verificationNote}
                onChangeText={onVerificationNote}
                maxLength={4000}
                editable={!verificationBusy && !pendingVerification}
                accessibilityLabel="Optional feedback saved with verification"
                placeholder="Optional feedback for this request"
                style={styles.input}
              />
              <Text style={styles.caveat}>Feedback is saved with the request. The check assesses the selected claim and evidence; it does not assess this note.</Text>
              <Pressable disabled={verificationBusy || pendingVerification} accessibilityRole="button" accessibilityLabel="Change verification evidence policy" onPress={onTogglePolicy}>
                <Text style={styles.quietLink}>{verificationPolicy === "reuse_snapshot" ? "Use inspected evidence" : "Refresh inspected sources"}</Text>
              </Pressable>
              <Pressable onPress={onSubmitVerification} disabled={verificationBusy || pendingVerification} accessibilityRole="button" accessibilityLabel="Submit answer recheck">
                <Text style={styles.quietLink}>{verificationBusy ? "Requesting check…" : "Recheck answer claim"}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
      {flagSent || flagStatus === "submitted" ? (
        <Text style={styles.caveat} accessibilityLabel="Flag submitted">Report submitted. Thank you.</Text>
      ) : flagOpen ? (
        <View accessibilityLabel="Report generated output">
          <Text style={styles.kicker}>Report this generated answer</Text>
          {OUTPUT_REPORT_CATEGORIES.map((cat) => (
            <Pressable
              key={cat}
              onPress={() => onFlagCategory(cat)}
              accessibilityRole="button"
              accessibilityLabel={`Category ${cat}`}
              accessibilityState={{ selected: flagCategory === cat }}
            >
              <Text style={flagCategory === cat ? styles.link : styles.bodyText}>{cat}</Text>
            </Pressable>
          ))}
          <TextInput
            value={flagNote}
            onChangeText={onFlagNote}
            placeholder="Optional explanation"
            accessibilityLabel="Report explanation"
            style={styles.input}
            multiline
          />
          <Pressable
            onPress={onToggleFlagInclude}
            accessibilityRole="button"
            accessibilityLabel="Include report excerpt"
            accessibilityState={{ selected: flagInclude }}
          >
            <Text style={styles.link}>{flagInclude ? "Include excerpt: yes" : "Include excerpt: no"}</Text>
          </Pressable>
          <Pressable onPress={onSubmitFlag} accessibilityRole="button" accessibilityLabel="Submit generated-output report" disabled={flagStatus === "submitting"}>
            <Text style={styles.link}>{flagStatus === "submitting" ? "Submitting…" : "Submit report"}</Text>
          </Pressable>
          {flagStatus === "error" ? <Text style={styles.error}>Could not submit. Try again.</Text> : null}
        </View>
      ) : (
        <Pressable onPress={onToggleFlag} accessibilityRole="button" accessibilityLabel="Flag this generated answer">
          <Text style={styles.link}>Flag this answer</Text>
        </Pressable>
      )}
    </>
  );
}
