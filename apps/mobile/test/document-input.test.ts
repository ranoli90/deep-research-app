import { expect, it, vi, beforeEach } from "vitest";
import { documentMetadata, MAX_DOCUMENT_BYTES } from "../src/document-input";
const mocks = vi.hoisted(() => ({ pick: vi.fn(), remove: vi.fn(), bytes: vi.fn(), size: 12 }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: mocks.pick }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///app/cache/" },
  Directory: class { uri = "file:///app/cache/DocumentPicker"; exists = true; delete = mocks.remove; },
  File: class { constructor(public uri: string) {} get size() { return mocks.size; } exists = true; bytes = mocks.bytes; delete = mocks.remove; },
}));
import { pickDocument } from "../src/native-documents";
beforeEach(() => { vi.clearAllMocks(); mocks.size = 12; mocks.bytes.mockResolvedValue(new Uint8Array(12)); mocks.pick.mockResolvedValue({ canceled: false, assets: [{ name: "Study.PDF", uri: "file:///app/cache/DocumentPicker/generated.pdf" }] }); });
it("limits supported local document metadata without trusting a MIME label", () => {
  expect(documentMetadata("Study.PDF", 12).mime).toBe("application/pdf");
  expect(documentMetadata("notes.md", MAX_DOCUMENT_BYTES).mime).toBe("text/markdown");
  for (const [name, size] of [["../secret.pdf", 12], ["a.exe", 12], ["a.pdf", 0], ["a.pdf", MAX_DOCUMENT_BYTES + 1], ["a.pdf", NaN]] as const) expect(() => documentMetadata(name, size)).toThrow();
});
it("returns actual binary data and deletes only the temporary picker copy", async () => {
  const selected = await pickDocument(() => true);
  expect(selected?.bytes).toBeInstanceOf(Uint8Array); expect(selected?.bytes.byteLength).toBe(12);
  expect(selected).not.toHaveProperty("text"); expect(mocks.remove).toHaveBeenCalledOnce();
});
it("cancellation does not read or remove a file", async () => {
  mocks.pick.mockResolvedValue({ canceled: true }); expect(await pickDocument(() => true)).toBeNull();
  expect(mocks.bytes).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it("refuses a URI outside the picker cache without deleting the original", async () => {
  mocks.pick.mockResolvedValue({ canceled: false, assets: [{ name: "private.pdf", uri: "file:///documents/private.pdf" }] });
  await expect(pickDocument(() => true)).rejects.toThrow("safely copied");
  expect(mocks.bytes).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it("rejects oversized copies before reading and removes the cache copy", async () => {
  mocks.size = MAX_DOCUMENT_BYTES + 1; await expect(pickDocument(() => true)).rejects.toThrow("8 MiB");
  expect(mocks.bytes).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce();
});
it("account change while reading prevents adoption and still removes the copy", async () => {
  let current = true; mocks.bytes.mockImplementation(async () => { current = false; return new Uint8Array(12); });
  await expect(pickDocument(() => current)).rejects.toThrow("superseded"); expect(mocks.remove).toHaveBeenCalledOnce();
});
it("cleanup failure is visible instead of reporting an attachment success", async () => {
  mocks.remove.mockImplementationOnce(() => { throw new Error("cache cleanup failed"); });
  await expect(pickDocument(() => true)).rejects.toThrow("cache cleanup failed");
});
