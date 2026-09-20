import { sha256Hex } from "./sha256";

function requestId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function followUpPayloadDigest(runId: string, revision: number, message: string): string {
  return sha256Hex(JSON.stringify({
    parentRunId: runId,
    expectedBriefRevision: revision,
    message: message.trim(),
  }));
}

export function mutatingFollowUpKey(runId: string, revision: number, message: string): string {
  const digest = followUpPayloadDigest(runId, revision, message);
  return `${runId}-followup-${revision}-${digest}`.slice(0, 200);
}

export function newFollowUpRequestId(): string {
  return requestId();
}

/** Child identity from a mutating follow-up or assumption replace; never poll the parent when a child is returned. */
export async function adoptReturnedChild(args: {
  parentRunId: string;
  body: { runId?: unknown; kind?: unknown };
  requireRunId?: boolean;
  selectRun: (runId: string) => void;
  refresh: (runId: string) => Promise<void>;
  poll: (runId: string) => void;
}): Promise<string> {
  if (args.requireRunId && (typeof args.body.runId !== "string" || !args.body.runId)) {
    throw new Error("Follow-up was not accepted. Retry the saved request.");
  }
  const runId = typeof args.body.runId === "string" && args.body.runId ? args.body.runId : args.parentRunId;
  if (runId !== args.parentRunId) args.selectRun(runId);
  await args.refresh(runId);
  if (runId !== args.parentRunId) args.poll(runId);
  return runId;
}
