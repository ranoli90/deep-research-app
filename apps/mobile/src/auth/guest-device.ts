import { readGuestPendingAction, type GuestPendingAction } from "./guest-pending-action";
import { emptyState, type UiState } from "../state";
import { parseState, storedState, type KeyValueStore } from "../persist";
import { sha256Hex } from "../sha256";

const CONTEXT_KEY = "norrow.guest.context.v1";
const PROOF_KEY = "norrow.guest.proof.v1";
const SNAPSHOT_KEY = "norrow.guest.snapshot.v1";
const ACTION_KEY = "norrow.guest.pending-action.v2";
const ABANDONED_KEY = "norrow.guest.abandoned-actions.v1";
const FIRST_REQUEST_KEY = "norrow.guest.first-request.v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GuestContext = {
  guestContextId: string;
  conversationId: string;
  conversationVersion: number;
  expiresAt: string;
  consentPolicyVersion: string;
  controlVersion: number;
  acceptedTurnCount: number;
  consentGranted: boolean;
};

export type GuestDevice = {
  context: GuestContext;
  proof: string;
  state: UiState;
  draftRevision: number;
  pendingAction: GuestPendingAction | null;
  firstRequest: GuestFirstRequest | null;
};

export type GuestFirstRequest = { id: string; guestContextId: string; question: string; digest: string; phase: "prepared" | "uncertain" | "accepted"; runId: string | null };
function readFirstRequest(value: unknown): GuestFirstRequest {
  if (!object(value) || Object.keys(value).sort().join() !== ["id", "guestContextId", "question", "digest", "phase", "runId"].sort().join() ||
    !uuid.test(String(value.id)) || !uuid.test(String(value.guestContextId)) || typeof value.question !== "string" || !value.question.trim() || value.question.length > 20_000 ||
    value.digest !== sha256Hex(value.question) || !["prepared", "uncertain", "accepted"].includes(String(value.phase)) ||
    !(value.runId === null || uuid.test(String(value.runId))) || ((value.phase === "accepted") !== (value.runId !== null))) {
    throw new Error("Saved first research request is invalid. It cannot be sent again.");
  }
  return value as GuestFirstRequest;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readGuestContext(value: unknown): GuestContext {
  if (!object(value) || Object.keys(value).sort().join() !== [
    "acceptedTurnCount", "consentGranted", "consentPolicyVersion", "controlVersion", "conversationId", "conversationVersion", "expiresAt", "guestContextId",
  ].sort().join() || !uuid.test(String(value.guestContextId)) || !uuid.test(String(value.conversationId)) ||
    ![value.conversationVersion, value.controlVersion, value.acceptedTurnCount].every(v => Number.isSafeInteger(v) && (v as number) >= 0) ||
    typeof value.consentGranted !== "boolean" || typeof value.consentPolicyVersion !== "string" || !value.consentPolicyVersion || value.consentPolicyVersion.length > 120 ||
    typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)) || new Date(Date.parse(value.expiresAt)).toISOString() !== value.expiresAt) {
    throw new Error("Saved guest conversation is invalid. Research is held on this device.");
  }
  return value as GuestContext;
}

/** Proof is a bearer secret. It is held in a separate native keychain service, never in the journal or UI snapshot. */
export function createGuestDeviceStore(content: KeyValueStore, secure: KeyValueStore) {
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = tail.then(operation, operation);
    tail = next.catch(() => undefined);
    return next;
  }
  return {
    async saveBootstrap(context: GuestContext, proof: string): Promise<void> {
      const checked = readGuestContext(context);
      if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new Error("Invalid guest proof.");
      await serial(async () => {
        if (await content.getItem("deep.install.v2") !== "1") throw new Error("Device installation is not established. Guest proof was not saved.");
        const old = await secure.getItem(CONTEXT_KEY);
        if (old !== null) throw new Error("A guest conversation already exists. It cannot be replaced silently.");
        await secure.setItem(PROOF_KEY, proof);
        await secure.setItem(CONTEXT_KEY, JSON.stringify(checked));
      });
    },
    async updateContext(context: GuestContext): Promise<void> {
      const checked = readGuestContext(context);
      await serial(async () => {
        const raw = await secure.getItem(CONTEXT_KEY);
        if (raw === null) throw new Error("Guest conversation was not saved.");
        const previous = readGuestContext(JSON.parse(raw));
        if (previous.guestContextId !== checked.guestContextId || previous.conversationId !== checked.conversationId || previous.conversationVersion > checked.conversationVersion || previous.controlVersion > checked.controlVersion || previous.acceptedTurnCount > checked.acceptedTurnCount || previous.expiresAt !== checked.expiresAt || previous.consentPolicyVersion !== checked.consentPolicyVersion || (previous.consentGranted && !checked.consentGranted && previous.controlVersion === checked.controlVersion)) throw new Error("Guest conversation changed unexpectedly.");
        await secure.setItem(CONTEXT_KEY, JSON.stringify(checked));
      });
    },
    async saveSnapshot(contextId: string, state: UiState, draftRevision = 0): Promise<void> {
      if (!Number.isSafeInteger(draftRevision) || draftRevision < 0) throw new Error("Guest draft revision is invalid.");
      await serial(async () => {
        const raw = await secure.getItem(CONTEXT_KEY);
        if (raw === null || readGuestContext(JSON.parse(raw)).guestContextId !== contextId) throw new Error("Guest conversation changed before saving its reader.");
        await content.setItem(SNAPSHOT_KEY, JSON.stringify({ accountId: contextId, draftRevision, state: storedState({ ...state, signedIn: false }) }));
      });
    },
    async savePendingAction(action: GuestPendingAction, expected?: GuestPendingAction | null): Promise<void> {
      const checked = readGuestPendingAction(action);
      await serial(async () => {
        const rawContext = await secure.getItem(CONTEXT_KEY);
        if (rawContext === null || readGuestContext(JSON.parse(rawContext)).guestContextId !== checked.guestContextId) throw new Error("Guest conversation changed before saving its next message.");
        const raw = await content.getItem(ACTION_KEY);
        if (expected !== undefined) {
          const prior = raw === null ? null : readGuestPendingAction(JSON.parse(raw));
          if (JSON.stringify(prior) !== JSON.stringify(expected === null ? null : readGuestPendingAction(expected))) throw new Error("Saved guest action changed before this transition. Its later state is held.");
        }
        if (raw !== null) {
          const old = readGuestPendingAction(JSON.parse(raw));
          if (old.submissionId !== checked.submissionId || old.guestContextId !== checked.guestContextId || old.payloadDigest !== checked.payloadDigest) throw new Error("A different saved message is already awaiting sign-in.");
        }
        await content.setItem(ACTION_KEY, JSON.stringify(checked));
      });
    },
    /** A new submission is permitted only after the old one has a confirmed server abandonment. */
    async replaceAbandonedAction(previous: GuestPendingAction, next: GuestPendingAction): Promise<void> {
      const old = readGuestPendingAction(previous), fresh = readGuestPendingAction(next);
      if (old.phase !== "cancelled" || fresh.phase !== "pending_auth" || old.submissionId === fresh.submissionId ||
        old.guestContextId !== fresh.guestContextId || old.conversationId !== fresh.conversationId) throw new Error("The old message was not safely abandoned.");
      await serial(async () => {
        const rawContext = await secure.getItem(CONTEXT_KEY);
        if (rawContext === null || readGuestContext(JSON.parse(rawContext)).guestContextId !== old.guestContextId) throw new Error("Guest conversation changed before replacing its message.");
        const raw = await content.getItem(ACTION_KEY);
        if (raw === null || JSON.stringify(readGuestPendingAction(JSON.parse(raw))) !== JSON.stringify(old)) throw new Error("Saved guest action changed before replacement.");
        const archiveRaw = await content.getItem(ABANDONED_KEY);
        const archive: unknown = archiveRaw === null ? [] : JSON.parse(archiveRaw);
        if (!Array.isArray(archive) || archive.length > 32) throw new Error("Abandoned-action history is invalid.");
        const checked = archive.map(readGuestPendingAction);
        if (checked.some(item => item.phase !== "cancelled" || item.guestContextId !== old.guestContextId)) throw new Error("Abandoned-action history is invalid.");
        if (!checked.some(item => item.submissionId === old.submissionId)) {
          if (checked.length === 32) throw new Error("Abandoned-action history is full. Research is held.");
          await content.setItem(ABANDONED_KEY, JSON.stringify([...checked, old]));
        }
        await content.setItem(ACTION_KEY, JSON.stringify(fresh));
      });
    },
    async saveFirstRequest(request: GuestFirstRequest): Promise<void> {
      const checked = readFirstRequest(request);
      await serial(async () => {
        const rawContext = await secure.getItem(CONTEXT_KEY);
        if (rawContext === null || readGuestContext(JSON.parse(rawContext)).guestContextId !== checked.guestContextId) throw new Error("Guest conversation changed before first research.");
        const raw = await content.getItem(FIRST_REQUEST_KEY);
        if (raw !== null) {
          const old = readFirstRequest(JSON.parse(raw));
          if (old.id !== checked.id || old.digest !== checked.digest || old.guestContextId !== checked.guestContextId || old.phase === "accepted" && checked.phase !== "accepted") throw new Error("A different first research request is already saved.");
        }
        await content.setItem(FIRST_REQUEST_KEY, JSON.stringify(checked));
      });
    },
    async load(): Promise<GuestDevice | null> {
      return serial(async () => {
        // Ordinary install marker is lost on reinstall while iOS keychain can
        // survive. Check it before ever reading a retained guest bearer.
        if (await content.getItem("deep.install.v2") !== "1") {
          await secure.removeItem(PROOF_KEY);
          await secure.removeItem(CONTEXT_KEY);
          return null;
        }
        const raw = await secure.getItem(CONTEXT_KEY);
        if (raw === null) return null;
        const context = readGuestContext(JSON.parse(raw));
        const proof = await secure.getItem(PROOF_KEY);
        if (proof === null || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new Error("Guest proof is unavailable. Research is held on this device.");
        const saved = await content.getItem(SNAPSHOT_KEY);
        const envelope: unknown = saved === null ? null : JSON.parse(saved);
        const draftRevision = envelope === null ? 0 : object(envelope) && Number.isSafeInteger(envelope.draftRevision) && (envelope.draftRevision as number) >= 0 ? envelope.draftRevision as number : NaN;
        if (!Number.isSafeInteger(draftRevision)) throw new Error("Saved guest draft revision is invalid. Research is held on this device.");
        const state = saved === null ? emptyState() : parseState(saved, context.guestContextId);
        if (!state) throw new Error("Saved guest research is invalid. Research is held on this device.");
        const rawAction = await content.getItem(ACTION_KEY);
        const pendingAction = rawAction === null ? null : readGuestPendingAction(JSON.parse(rawAction));
        const archiveRaw = await content.getItem(ABANDONED_KEY);
        if (archiveRaw !== null) {
          const archive: unknown = JSON.parse(archiveRaw);
          if (!Array.isArray(archive) || archive.length > 32) throw new Error("Abandoned-action history is invalid. Research is held.");
          const seen = new Set<string>();
          for (const item of archive) {
            const old = readGuestPendingAction(item);
            if (old.phase !== "cancelled" || old.guestContextId !== context.guestContextId || old.conversationId !== context.conversationId || seen.has(old.submissionId)) throw new Error("Abandoned-action history is invalid. Research is held.");
            seen.add(old.submissionId);
          }
        }
        const rawFirst = await content.getItem(FIRST_REQUEST_KEY);
        const firstRequest = rawFirst === null ? null : readFirstRequest(JSON.parse(rawFirst));
        if (firstRequest && firstRequest.guestContextId !== context.guestContextId) throw new Error("Saved first request belongs to another guest.");
        if (pendingAction && (pendingAction.guestContextId !== context.guestContextId || pendingAction.conversationId !== context.conversationId)) throw new Error("Saved guest message belongs to another conversation.");
        return { context, proof, state: { ...state, signedIn: false }, draftRevision, pendingAction, firstRequest };
      });
    },
    async clear(): Promise<void> {
      await serial(async () => {
        // Protected-content denial markers are committed before native deletion.
        await content.removeItem(ACTION_KEY);
        await content.removeItem(ABANDONED_KEY);
        await content.removeItem(FIRST_REQUEST_KEY);
        await content.removeItem(SNAPSHOT_KEY);
        await secure.removeItem(PROOF_KEY);
        await secure.removeItem(CONTEXT_KEY);
      });
    },
  };
}
