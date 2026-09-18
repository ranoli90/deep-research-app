import type { DocumentDigester } from "./admission-retry";

/** Exact bytes through the SDK's native SHA256 implementation; no JS fallback. */
export const nativeDocumentDigest: DocumentDigester = async bytes => {
  const Crypto = await import("expo-crypto").catch(() => {
    throw new Error("Native document SHA256 is unavailable. Use a current app build to submit documents; saved reports remain readable.");
  });
  if (typeof Crypto.digest !== "function") throw new Error("Native document SHA256 is unavailable.");
  const result = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) throw new Error("Native document SHA256 returned an invalid digest.");
  return new Uint8Array(result);
};
