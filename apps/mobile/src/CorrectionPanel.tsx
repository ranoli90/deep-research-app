import { Pressable, Text, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import type { AttachmentDraft } from "./state";

type Styles = {
  bodyText: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  input: StyleProp<TextStyle>;
};

export function CorrectionPanel({
  staleCorrection,
  savedBaseRevision,
  originalQuestion,
  correctionMode,
  showCorrectionOptions,
  pendingCorrectionDocuments,
  correctionFiles,
  documentPending,
  correctionPending,
  correctionReady,
  correctionReserveMicro,
  composerContinues,
  correction,
  evidencePolicy,
  verificationBusy,
  pendingVerification,
  muted,
  styles,
  onRebase,
  onToggleOptions,
  onRemoveFile,
  onPickDocument,
  onAddDocuments,
  onUseCurrentQuestion,
  onEvidencePolicy,
  onChangeCorrection,
  onSubmit,
}: {
  staleCorrection: boolean;
  savedBaseRevision?: number;
  originalQuestion?: string;
  correctionMode: "legacy" | "replace_question" | "unavailable";
  showCorrectionOptions: boolean;
  pendingCorrectionDocuments: boolean;
  correctionFiles: AttachmentDraft[];
  documentPending: boolean;
  correctionPending: boolean;
  correctionReady: boolean;
  correctionReserveMicro?: number;
  composerContinues: boolean;
  correction: string;
  evidencePolicy: "reuse_snapshot" | "refresh";
  verificationBusy: boolean;
  pendingVerification: boolean;
  muted: string;
  styles: Styles;
  onRebase(): void;
  onToggleOptions(): void;
  onRemoveFile(index: number): void;
  onPickDocument(): void;
  onAddDocuments(): void;
  onUseCurrentQuestion(): void;
  onEvidencePolicy(policy: "reuse_snapshot" | "refresh"): void;
  onChangeCorrection(value: string): void;
  onSubmit(): void;
}) {
  return (
    <View accessibilityLabel="Correction">
      {staleCorrection ? (
        <>
          <Text style={styles.bodyText}>This saved correction was written for version {savedBaseRevision}. Review it against the current question before submitting: {originalQuestion}</Text>
          <Pressable disabled={correctionPending} accessibilityRole="button" accessibilityLabel="Use saved correction for current version" onPress={onRebase}>
            <Text style={styles.link}>Use this correction for the current version</Text>
          </Pressable>
        </>
      ) : null}
      {correctionMode !== "unavailable" ? (
        <Pressable onPress={onToggleOptions} accessibilityRole="button" accessibilityLabel="Documents and evidence options" accessibilityState={{ expanded: showCorrectionOptions }} hitSlop={12}>
          <Text style={styles.link}>{showCorrectionOptions ? "Hide documents and evidence options" : "Documents and evidence options"}</Text>
        </Pressable>
      ) : null}
      {showCorrectionOptions && correctionMode === "replace_question" && !pendingCorrectionDocuments ? (
        <View>
          <Text style={styles.bodyText}>Add documents to this report using the same question and saved evidence. Research will reassess the answer. The total limit is three documents, including existing files.</Text>
          {correctionFiles.map((file, index) => (
            <Pressable key={index} disabled={correctionPending} accessibilityRole="button" accessibilityLabel={`Remove ${file.filename}`} onPress={() => onRemoveFile(index)}>
              <Text style={styles.link}>{file.filename} · Remove</Text>
            </Pressable>
          ))}
          <Pressable disabled={documentPending || correctionPending || correctionFiles.length >= 3} accessibilityRole="button" accessibilityLabel="Select document for correction" onPress={onPickDocument}>
            <Text style={styles.link}>Select document for this report</Text>
          </Pressable>
          <Pressable disabled={documentPending || correctionPending || !correctionFiles.length || !correctionReady} accessibilityRole="button" accessibilityLabel="Add documents and update report" onPress={onAddDocuments}>
            <Text style={styles.link}>Add documents and update report</Text>
          </Pressable>
          <Text style={styles.bodyText}>Selected file bytes stay in memory until submitted. After closing the app, select unconfirmed files again.</Text>
        </View>
      ) : null}
      {showCorrectionOptions && correctionMode === "replace_question" ? (
        <>
          <Text style={styles.bodyText}>Write the complete updated question. Its conclusions will be checked again.</Text>
          <Pressable disabled={correctionPending} onPress={onUseCurrentQuestion} accessibilityRole="button" accessibilityLabel="Use current question">
            <Text style={styles.link}>Edit current question</Text>
          </Pressable>
          {(["reuse_snapshot", "refresh"] as const).map((policy) => (
            <Pressable key={policy} disabled={correctionPending} onPress={() => onEvidencePolicy(policy)} accessibilityRole="radio" accessibilityState={{ checked: evidencePolicy === policy, disabled: correctionPending }} accessibilityLabel={policy === "reuse_snapshot" ? "Reuse previously read source versions" : "Read sources again"}>
              <Text style={styles.bodyText}>{evidencePolicy === policy ? "● " : "○ "}{policy === "reuse_snapshot" ? "Reuse previously read source versions" : "Read sources again"}</Text>
            </Pressable>
          ))}
          <Text style={styles.bodyText}>Reused versions may be older. Refresh requests new evidence; uploaded files retain their supplied bytes.</Text>
        </>
      ) : null}
      {!composerContinues ? (
        <>
          {correctionMode === "unavailable" ? <Text style={styles.bodyText}>Corrections are not available on this research route.</Text> : null}
          {correctionReady && Number.isSafeInteger(correctionReserveMicro) && correctionReserveMicro! >= 0 ? <Text style={styles.bodyText}>Reserves US${(correctionReserveMicro! / 1_000_000).toFixed(2)} of research allowance. Your earlier report remains available.</Text> : null}
          <TextInput
            value={correction}
            onChangeText={onChangeCorrection}
            placeholder={correctionMode === "replace_question" ? "Your complete revised research question" : "Actually, the budget is 120 EUR"}
            multiline
            maxLength={20_000}
            editable={!correctionPending && !verificationBusy && !pendingVerification && correctionMode !== "unavailable"}
            placeholderTextColor={muted}
            style={styles.input}
            allowFontScaling
            maxFontSizeMultiplier={2}
            accessibilityLabel={correctionMode === "replace_question" ? "Revised research question" : "Correction field"}
          />
          <Pressable onPress={onSubmit} disabled={correctionPending || pendingCorrectionDocuments || !correctionReady} accessibilityState={{ disabled: correctionPending || pendingCorrectionDocuments || !correctionReady, busy: correctionPending }} accessibilityRole="button" accessibilityLabel="Submit correction">
            <Text style={styles.link}>{correctionPending ? "Updating…" : "Update research"}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
