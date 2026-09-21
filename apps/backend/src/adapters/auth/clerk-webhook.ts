import { createHash } from "node:crypto";
import { verifyWebhook } from "@clerk/backend/webhooks";

export type ClerkWebhookKind = "user.created" | "user.updated" | "user.deleted" |
  "session.ended" | "session.revoked";

export type VerifiedClerkWebhookEvent = {
  eventId: string;
  payloadDigest: string;
  kind: ClerkWebhookKind;
  issuer: string;
  subject?: string;
  sessionId?: string;
};

type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;
type WebhookConfig = { signingSecret: string | undefined; expectedInstanceId: string | undefined; issuer: string };

const MAX_BODY_BYTES = 256 * 1024;
const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SUBJECT = /^user_[A-Za-z0-9]+$/;
const SESSION = /^sess_[A-Za-z0-9]+$/;

function reject(): never { throw new Error("clerk_webhook_rejected"); }

function exactHeader(headers: WebhookHeaders, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? reject();
  const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  if (entries.length !== 1 || typeof entries[0]![1] !== "string") return reject();
  return entries[0]![1];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject();
  return value as Record<string, unknown>;
}

/** Verify raw bytes before parsing. Only this exact Clerk instance can issue local revocations. */
export async function verifyClerkWebhook(
  rawBody: Buffer, headers: WebhookHeaders, config: WebhookConfig,
): Promise<VerifiedClerkWebhookEvent> {
  if (!Buffer.isBuffer(rawBody) || rawBody.length < 2 || rawBody.length > MAX_BODY_BYTES ||
      !config.signingSecret?.startsWith("whsec_") ||
      !/^ins_[A-Za-z0-9_-]+$/.test(config.expectedInstanceId ?? "")) return reject();
  let issuer: URL;
  try { issuer = new URL(config.issuer); } catch { return reject(); }
  if (issuer.protocol !== "https:" || issuer.origin !== config.issuer || issuer.username || issuer.password) return reject();

  const eventId = exactHeader(headers, "svix-id");
  const timestamp = exactHeader(headers, "svix-timestamp");
  const signature = exactHeader(headers, "svix-signature");
  if (!EVENT_ID.test(eventId) || !/^\d{9,12}$/.test(timestamp) || signature.length > 2048 ||
      !/^v1,[A-Za-z0-9+/=]+(?: v1,[A-Za-z0-9+/=]+)*$/.test(signature)) return reject();

  // The SDK verifies the Svix/Standard Webhooks HMAC and timestamp. Reject invalid
  // UTF-8/BOM so its Request.text() sees precisely the signed bytes we hash.
  let body: string;
  try { body = new TextDecoder("utf-8", { fatal: true }).decode(rawBody); }
  catch { return reject(); }
  if (!Buffer.from(body, "utf8").equals(rawBody)) return reject();
  const request = new Request("https://clerk-webhook.local/verify", {
    method: "POST", headers: { "svix-id": eventId, "svix-timestamp": timestamp,
      "svix-signature": signature }, body,
  });
  let verified: { type: string; data: unknown };
  try { verified = await verifyWebhook(request, { signingSecret: config.signingSecret }); }
  catch { return reject(); }

  let envelope: Record<string, unknown>;
  try { envelope = record(JSON.parse(body)); } catch { return reject(); }
  if (envelope.object !== "event" || envelope.instance_id !== config.expectedInstanceId ||
      !Number.isSafeInteger(envelope.timestamp) || Number(envelope.timestamp) <= 0 ||
      envelope.type !== verified.type || JSON.stringify(envelope.data) !== JSON.stringify(verified.data)) return reject();
  const data = record(envelope.data);
  const kind = envelope.type;
  let subject: string | undefined;
  let sessionId: string | undefined;
  if (kind === "user.created" || kind === "user.updated" || kind === "user.deleted") {
    if (typeof data.id !== "string" || !SUBJECT.test(data.id)) return reject();
    subject = data.id;
  } else if (kind === "session.ended" || kind === "session.revoked") {
    if (typeof data.id !== "string" || !SESSION.test(data.id) ||
        (data.user_id !== undefined && (typeof data.user_id !== "string" || !SUBJECT.test(data.user_id)))) return reject();
    sessionId = data.id;
    subject = data.user_id as string | undefined;
  } else return reject();

  return { eventId, payloadDigest: createHash("sha256").update(rawBody).digest("hex"),
    kind, issuer: config.issuer, ...(subject ? { subject } : {}), ...(sessionId ? { sessionId } : {}) };
}
