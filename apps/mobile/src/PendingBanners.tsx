import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Styles = {
  card: StyleProp<ViewStyle>;
  bodyText: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
};

type Upload = { filename: string; attachmentId?: string | null };

export function PendingBanners({
  styles,
  pendingContentInvalidation,
  pendingCorrectionDocuments,
  correctionFiles,
  documentPending,
  correctionPending,
  uploadStatus,
  pendingVerification,
  verificationBusy,
  pendingSourceDeletion,
  sourceDeleteBusy,
  onRetryCleanup,
  onRemoveCorrectionFile,
  onPickCorrectionDocument,
  onRetryDocumentCorrection,
  onResolveDocumentCorrection,
  onRetryVerification,
  onResolveVerification,
  onRetryDeletion,
}: {
  styles: Styles;
  pendingContentInvalidation: boolean;
  pendingCorrectionDocuments: { upload: { uploads: Upload[] } } | null;
  correctionFiles: { filename: string }[];
  documentPending: boolean;
  correctionPending: boolean;
  uploadStatus: string | null;
  pendingVerification: boolean;
  verificationBusy: boolean;
  pendingSourceDeletion: boolean;
  sourceDeleteBusy: boolean;
  onRetryCleanup(): void;
  onRemoveCorrectionFile(index: number): void;
  onPickCorrectionDocument(): void;
  onRetryDocumentCorrection(): void;
  onResolveDocumentCorrection(): void;
  onRetryVerification(): void;
  onResolveVerification(): void;
  onRetryDeletion(): void;
}) {
  return (
    <>
      {pendingContentInvalidation ? (
        <View style={styles.card} accessibilityLabel="Deleted source cleanup">
          <Text style={styles.bodyText}>A deleted source invalidated this report. Its saved content is hidden while device cleanup is retried.</Text>
          <Pressable accessibilityRole="button" onPress={onRetryCleanup}><Text style={styles.link}>Retry device cleanup</Text></Pressable>
        </View>
      ) : null}
      {pendingCorrectionDocuments ? (
        <View style={styles.card} accessibilityLabel="Saved document correction">
          <Text style={styles.bodyText}>A document correction is saved for its original report. Retry the same request to avoid starting another correction.</Text>
          <Text style={styles.bodyText}>{pendingCorrectionDocuments.upload.uploads.map((u) => `${u.filename}: ${u.attachmentId ? "uploaded" : "select original file again"}`).join("\n")}</Text>
          {correctionFiles.map((file, index) => (
            <Pressable key={index} disabled={correctionPending} accessibilityRole="button" onPress={() => onRemoveCorrectionFile(index)}>
              <Text style={styles.link}>{file.filename} · Remove selection</Text>
            </Pressable>
          ))}
          <Pressable disabled={documentPending || correctionPending} accessibilityRole="button" onPress={onPickCorrectionDocument}><Text style={styles.link}>Select original file</Text></Pressable>
          <Pressable disabled={documentPending || correctionPending} accessibilityRole="button" onPress={onRetryDocumentCorrection}><Text style={styles.link}>Retry document correction</Text></Pressable>
          <Pressable disabled={documentPending || correctionPending} accessibilityRole="button" onPress={onResolveDocumentCorrection}><Text style={styles.link}>Check or withdraw document correction</Text></Pressable>
          {uploadStatus ? <Text accessibilityLiveRegion="polite">{uploadStatus}</Text> : null}
        </View>
      ) : null}
      {pendingVerification ? (
        <View style={styles.card} accessibilityLabel="Saved verification request">
          <Text style={styles.bodyText}>Verification is awaiting confirmation. Retry keeps the same claim, evidence policy and request identity.</Text>
          <Pressable disabled={verificationBusy} accessibilityRole="button" accessibilityLabel="Retry saved verification" onPress={onRetryVerification}><Text style={styles.link}>Retry verification</Text></Pressable>
          <Pressable disabled={verificationBusy} accessibilityRole="button" accessibilityLabel="Check or withdraw verification" onPress={onResolveVerification}><Text style={styles.link}>Check or withdraw</Text></Pressable>
        </View>
      ) : null}
      {pendingSourceDeletion ? (
        <View style={styles.card} accessibilityLabel="Pending source deletion">
          <Text style={styles.bodyText}>Source and cached reports are hidden here. Server deletion is not yet confirmed. Retry to confirm it before reopening research.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry source deletion" disabled={sourceDeleteBusy} onPress={onRetryDeletion}>
            <Text style={styles.link}>{sourceDeleteBusy ? "Confirming deletion…" : "Retry deletion"}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
