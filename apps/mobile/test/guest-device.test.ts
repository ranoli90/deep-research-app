import { describe, expect, it } from "vitest";
import { createGuestDeviceStore } from "../src/auth/guest-device";
import { createGuestPendingAction } from "../src/auth/guest-pending-action";
import { createProtectedContentStore } from "../src/protected-content";
import { emptyState } from "../src/state";
import { memoryStore } from "../src/persist";
import { sha256Hex } from "../src/sha256";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = {
  guestContextId: id(1), conversationId: id(2), conversationVersion: 1,
  expiresAt: "2026-09-22T00:00:00.000Z", consentPolicyVersion: "consent.v1",
  controlVersion: 0, acceptedTurnCount: 0, consentGranted: false,
};
const proof = "P".repeat(64);
function stores() {
  const ordinary = memoryStore(), nativeContent = memoryStore(), secure = memoryStore();
  return { ordinary, nativeContent, secure, content: createProtectedContentStore(ordinary, nativeContent) };
}
function action() {
  return createGuestPendingAction({
    submissionId: id(3), guestContextId: context.guestContextId, conversationId: context.conversationId,
    conversationVersion: 1, draftRevision: 1, draftDigest: sha256Hex("Second message"),
    payload: { kind: "follow_up", text: "Second message", parentRunId: id(4) },
    consentPolicyVersion: "consent.v1", createdAt: "2026-09-21T00:00:00.000Z", expiresAt: "2026-09-22T00:00:00.000Z",
  });
}

describe("guest device custody", () => {
  it("GUEST-01/02 durably separates proof from protected reader and exact action", async () => {
    const s = stores(), device = createGuestDeviceStore(s.content, s.secure);
    await device.saveBootstrap(context, proof);
    await device.saveSnapshot(context.guestContextId, { ...emptyState(), draft: "Second message", run: { runId: id(4), lifecycle: "terminal", phase: "done", outcome: "completed", reportId: id(5), labeledDemo: false }, status: "completed", routeMode: "controlled-research" });
    await device.savePendingAction(action());
    const relaunched = createGuestDeviceStore(s.content, s.secure);
    const saved = await relaunched.load();
    expect(saved?.proof).toBe(proof);
    expect(saved?.state.run?.runId).toBe(id(4));
    expect(saved?.state.draft).toBe("Second message");
    expect(saved?.pendingAction?.payload).toEqual(action().payload);
    expect(JSON.stringify(await s.ordinary.getItem("norrow.guest.pending-action.v2"))).not.toContain(proof);
    expect(await s.nativeContent.getItem("norrow.guest.pending-action.v2.content.v1.0.0")).not.toContain(proof);
  });

  it("GUEST-05 refuses to replace a live guest, action or server control with another identity", async () => {
    const s = stores(), device = createGuestDeviceStore(s.content, s.secure);
    await device.saveBootstrap(context, proof);
    await expect(device.saveBootstrap({ ...context, guestContextId: id(8) }, proof)).rejects.toThrow("already exists");
    await device.savePendingAction(action());
    await expect(device.savePendingAction({ ...action(), submissionId: id(8) })).rejects.toThrow("different saved message");
    await expect(device.updateContext({ ...context, controlVersion: -1 })).rejects.toThrow("invalid");
    expect((await device.load())?.pendingAction?.submissionId).toBe(id(3));
  });

  it("AUTH-14 holds malformed durable journal without minting a replacement", async () => {
    const s = stores(), device = createGuestDeviceStore(s.content, s.secure);
    await device.saveBootstrap(context, proof);
    await s.content.setItem("norrow.guest.pending-action.v2", JSON.stringify({ ...action(), payloadDigest: "0".repeat(64) }));
    await expect(device.load()).rejects.toThrow("Saved sign-in action is invalid");
    expect(await s.secure.getItem("norrow.guest.proof.v1")).toBe(proof);
  });

  it("DATA-12 clears proof, reader and action without affecting another device store", async () => {
    const s = stores(), device = createGuestDeviceStore(s.content, s.secure);
    await device.saveBootstrap(context, proof); await device.savePendingAction(action());
    await device.clear();
    expect(await device.load()).toBeNull();
    expect(await s.secure.getItem("norrow.guest.proof.v1")).toBeNull();
    expect(await s.content.getItem("norrow.guest.pending-action.v2")).toBeNull();
  });
});
