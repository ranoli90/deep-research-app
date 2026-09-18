import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import { documentMetadata } from "./document-input";
import { SupersededRequest } from "./request-scope";

/** Only picker-created cache copies; never the user's original document. */
export function clearDocumentPickerCache() {
  const directory = new Directory(Paths.cache, "DocumentPicker");
  if (directory.exists) directory.delete();
}

export async function pickDocument(current: () => boolean) {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "text/plain", "text/markdown"], multiple: false, copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error("No document was selected.");
  const file = new File(asset.uri);
  const cache = new Directory(Paths.cache, "DocumentPicker");
  if (!file.uri.startsWith(`${cache.uri.replace(/\/$/, "")}/`)) throw new Error("The selected document could not be safely copied. Try again.");
  try {
    if (!current()) throw new SupersededRequest();
    const metadata = documentMetadata(asset.name, file.size);
    const bytes = await file.bytes();
    if (!current()) throw new SupersededRequest();
    documentMetadata(asset.name, bytes.byteLength);
    return { ...metadata, bytes };
  } finally {
    if (file.exists) file.delete();
  }
}
