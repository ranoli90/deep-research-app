import { readGuestPendingAction, type GuestPendingAction } from "./guest-pending-action";
import { emptyState, type UiState } from "../state";
import { parseState, storedState, type KeyValueStore } from "../persist";

const CONTEXT_KEY = "norrow.guest.context.v1";
const PROOF_KEY = "norrow.guest.proof.v1";
const SNAPSHOT_KEY = "norrow.guest.snapshot.v1";
const ACTION_KEY = "norrow.guest.pending-action.v2";
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
  pendingAction: GuestPendingAction | null;
};

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
      if (typeof proof !== "string" || proof.length < 32 || proof.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(proof)) throw new Error("Invalid guest proof.");
      await serial(async () => {
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
        if (previous.guestContextId !== checked.guestContextId || previous.conversationId !== checked.conversationId || previous.conversationVersion > checked.conversationVersion || previous.controlVersion > checked.controlVersion || previous.acceptedTurnCount > checked.acceptedTurnCount || previous.expiresAt !== checked.expiresAt || previous.consentPolicyVersion !== checked.consentPolicyVersion || (previous.consentGranted && !checked.consentGranted)) throw new Error("Guest conversation changed unexpectedly.");
        await secure.setItem(CONTEXT_KEY, JSON.stringify(checked));
      });
    },
    async saveSnapshot(contextId: string, state: UiState): Promise<void> {
      await serial(async () => {
        const raw = await secure.getItem(CONTEXT_KEY);
        if (raw === null || readGuestContext(JSON.parse(raw)).guestContextId !== contextId) throw new Error("Guest conversation changed before saving its reader.");
        await content.setItem(SNAPSHOT_KEY, JSON.stringify({ accountId: contextId, state: storedState({ ...state, signedIn: false }) }));
      });
    },
    async savePendingAction(action: GuestPendingAction): Promise<void> {
      const checked = readGuestPendingAction(action);
      await serial(async () => {
        const rawContext = await secure.getItem(CONTEXT_KEY);
        if (rawContext === null || readGuestContext(JSON.parse(rawContext)).guestContextId !== checked.guestContextId) throw new Error("Guest conversation changed before saving its next message.");
        const raw = await content.getItem(ACTION_KEY);
        if (raw !== null) {
          const old = readGuestPendingAction(JSON.parse(raw));
          if (old.submissionId !== checked.submissionId || old.guestContextId !== checked.guestContextId || old.payloadDigest !== checked.payloadDigest) throw new Error("A different saved message is already awaiting sign-in.");
        }
        await content.setItem(ACTION_KEY, JSON.stringify(checked));
      });
    },
    async load(): Promise<GuestDevice | null> {
      return serial(async () => {
        const raw = await secure.getItem(CONTEXT_KEY);
        if (raw === null) return null;
        const context = readGuestContext(JSON.parse(raw));
        const proof = await secure.getItem(PROOF_KEY);
        if (proof === null || proof.length < 32 || proof.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(proof)) throw new Error("Guest proof is unavailable. Research is held on this device.");
        const saved = await content.getItem(SNAPSHOT_KEY);
        const state = saved === null ? emptyState() : parseState(saved, context.guestContextId);
        if (!state) throw new Error("Saved guest research is invalid. Research is held on this device.");
        const rawAction = await content.getItem(ACTION_KEY);
        const pendingAction = rawAction === null ? null : readGuestPendingAction(JSON.parse(rawAction));
        if (pendingAction && (pendingAction.guestContextId !== context.guestContextId || pendingAction.conversationId !== context.conversationId)) throw new Error("Saved guest message belongs to another conversation.");
        return { context, proof, state: { ...state, signedIn: false }, pendingAction };
      });
    },
    async clear(): Promise<void> {
      await serial(async () => {
        // Protected-content denial markers are committed before native deletion.
        await content.removeItem(ACTION_KEY);
        await content.removeItem(SNAPSHOT_KEY);
        await secure.removeItem(PROOF_KEY);
        await secure.removeItem(CONTEXT_KEY);
      });
    },
  };
}
