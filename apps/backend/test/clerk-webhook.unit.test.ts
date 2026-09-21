import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyClerkWebhook } from "../src/adapters/auth/clerk-webhook.js";

const key = randomBytes(32);
const config = { signingSecret: `whsec_${key.toString("base64")}`,
  expectedInstanceId: "ins_syntheticStage1", issuer: "https://synthetic.clerk.accounts.dev" };

function signed(kind: string, data: Record<string, unknown>, options: {
  eventId?: string; instanceId?: string; timestamp?: number; body?: Buffer;
} = {}) {
  const eventId = options.eventId ?? `msg_${randomBytes(8).toString("hex")}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const body = options.body ?? Buffer.from(JSON.stringify({ object: "event", type: kind,
    instance_id: options.instanceId ?? config.expectedInstanceId, timestamp: Date.now(), data }));
  const signature = createHmac("sha256", key).update(`${eventId}.${timestamp}.`).update(body).digest("base64");
  return { body, headers: { "svix-id": eventId, "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}` } };
}

describe("Clerk raw webhook adapter", () => {
  it("AUTH-11 verifies exact signed bytes and pins the endpoint instance and issuer", async () => {
    const message = signed("user.deleted", { id: "user_Synthetic1", email_addresses: [{ email_address: "not-an-owner-key@example.test" }] });
    const result = await verifyClerkWebhook(message.body, message.headers, config);
    expect(result).toMatchObject({ eventId: message.headers["svix-id"], kind: "user.deleted",
      subject: "user_Synthetic1", issuer: config.issuer });
    expect(result.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("email_address");
    await expect(verifyClerkWebhook(Buffer.concat([message.body, Buffer.from(" ")]), message.headers, config))
      .rejects.toThrow("clerk_webhook_rejected");
    await expect(verifyClerkWebhook(message.body, message.headers, { ...config, signingSecret: undefined }))
      .rejects.toThrow("clerk_webhook_rejected");
  });

  it("AUTH-11 denies signed cross-instance messages, malformed IDs and unsupported effects", async () => {
    const other = signed("user.deleted", { id: "user_Synthetic1" }, { instanceId: "ins_anotherStage" });
    await expect(verifyClerkWebhook(other.body, other.headers, config)).rejects.toThrow("clerk_webhook_rejected");
    const emailOnly = signed("user.deleted", { id: "someone@example.test" });
    await expect(verifyClerkWebhook(emailOnly.body, emailOnly.headers, config)).rejects.toThrow("clerk_webhook_rejected");
    const unsupported = signed("organization.created", { id: "org_Synthetic1" });
    await expect(verifyClerkWebhook(unsupported.body, unsupported.headers, config)).rejects.toThrow("clerk_webhook_rejected");
    const badSession = signed("session.revoked", { id: "user_Synthetic1" });
    await expect(verifyClerkWebhook(badSession.body, badSession.headers, config)).rejects.toThrow("clerk_webhook_rejected");
  });

  it("AUTH-11 accepts exact session end/revocation and harmless user update semantics", async () => {
    for (const kind of ["session.ended", "session.revoked"]) {
      const message = signed(kind, { id: "sess_Synthetic1", user_id: "user_Synthetic1" });
      expect(await verifyClerkWebhook(message.body, message.headers, config)).toMatchObject({
        kind, sessionId: "sess_Synthetic1", subject: "user_Synthetic1" });
    }
    const update = signed("user.updated", { id: "user_Synthetic1", email_addresses: [] });
    expect(await verifyClerkWebhook(update.body, update.headers, config)).toMatchObject({
      kind: "user.updated", subject: "user_Synthetic1" });
  });

  it("AUTH-11 rejects stale signatures, ambiguous headers, invalid UTF-8 and oversized bodies", async () => {
    const stale = signed("user.deleted", { id: "user_Synthetic1" },
      { timestamp: Math.floor(Date.now() / 1000) - 600 });
    await expect(verifyClerkWebhook(stale.body, stale.headers, config)).rejects.toThrow("clerk_webhook_rejected");
    const message = signed("user.deleted", { id: "user_Synthetic1" });
    await expect(verifyClerkWebhook(message.body,
      { ...message.headers, "Svix-Id": "msg_ambiguous" }, config)).rejects.toThrow("clerk_webhook_rejected");
    await expect(verifyClerkWebhook(Buffer.from([0xff, 0xfe]), message.headers, config))
      .rejects.toThrow("clerk_webhook_rejected");
    await expect(verifyClerkWebhook(Buffer.alloc(256 * 1024 + 1), message.headers, config))
      .rejects.toThrow("clerk_webhook_rejected");
  });
});
