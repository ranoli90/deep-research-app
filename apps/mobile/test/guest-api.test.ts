import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { createGuestPendingAction, beginGuestAuth, completeGuestAuth, beginGuestClaim } from "../src/auth/guest-pending-action";
import { sha256Hex } from "../src/sha256";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const proof = "p".repeat(43);
const token = "member-session-only";
const action = beginGuestClaim(completeGuestAuth(beginGuestAuth(createGuestPendingAction({
  submissionId: id(1), guestContextId: id(2), conversationId: id(3), conversationVersion: 1,
  draftRevision: 1, draftDigest: sha256Hex("second"), payload: { kind: "follow_up", text: "second", parentRunId: id(4) },
  consentPolicyVersion: "consent.v1", createdAt: "2026-09-21T00:00:00.000Z", expiresAt: "2026-09-22T00:00:00.000Z",
}), { id: id(5), provider: "email" }, new Date("2026-09-21T01:00:00.000Z")), id(5), id(6), new Date("2026-09-21T01:00:00.000Z")), id(7), new Date("2026-09-21T01:00:00.000Z"));

afterEach(() => { api.activateSession(null); api.clearGuest(); vi.unstubAllGlobals(); });

it("GUEST-01/CLAIM-01 sends proof only on frozen guest-control and guest-reader routes, never as a URL or body", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  api.activateGuest(proof, id(2));
  await api.guest.consent(proof, true);
  await api.guest.createRun(proof, "First question", id(8), id(3));
  await api.guest.registerAction(proof, action);
  await api.guest.beginAuthAttempt(proof, action.submissionId, action.authAttempt!.id, "email");
  await api.guest.getRun(proof, id(4));
  await api.guest.claim(proof, token, action);
  for (const [url, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(url).not.toContain(proof);
    expect(String(init.body ?? "")).not.toContain(proof);
    expect(init.headers).toMatchObject({ "x-norrow-guest-proof": proof });
    expect(init.redirect).toBe("error");
  }
  expect((fetcher.mock.calls[5] as unknown as [string, RequestInit])[1].headers).toMatchObject({ authorization: `Bearer ${token}` });
  expect((fetcher.mock.calls[5] as unknown as [string, RequestInit])[1].body).toContain(action.authAttempt!.id);
});

it("CLAIM-01 drops late guest results after claim, deletion, or another context without remounting content", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  api.activateGuest(proof, id(2));
  const pending = api.guest.getRun(proof, id(4)).catch(error => error);
  api.rotateGuestScope();
  resolve(Response.json({ runId: id(4), private: "old guest" }));
  await expect(pending).resolves.toMatchObject({ name: "SupersededRequest" });
  const afterClaim = api.guest.getRun(proof, id(4)).catch(error => error);
  api.clearGuest();
  resolve(Response.json({ runId: id(4), private: "deleted guest" }));
  await expect(afterClaim).resolves.toMatchObject({ name: "SupersededRequest" });
  api.activateGuest("q".repeat(43), id(9));
  await expect(api.guest.getRun(proof, id(4))).rejects.toMatchObject({ name: "SupersededRequest" });
});

it("CLAIM-07 member claim resolution and continuation never carry the guest proof", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  api.activateSession(token, id(6));
  await api.resolveGuestClaim(token, id(7), id(1));
  await api.resumeGuestAction(token, action);
  await api.resolveGuestAction(token, action);
  for (const [url, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(url).not.toContain(proof);
    expect(JSON.stringify(init)).not.toContain(proof);
    expect(init.headers).not.toHaveProperty("x-norrow-guest-proof");
  }
});
