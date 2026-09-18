import { completeSourceDeletion, readPendingSourceDeletion, readSourceDeletionReceipt, type SourceDeletionState } from "./source-deletion";
import { SupersededRequest } from "./request-scope";

/** A server deletion is issued only after the protected cache records its privacy obligation. */
export async function submitSourceDeletion(state: SourceDeletionState, io: {
  current(): boolean;
  save(state: SourceDeletionState): Promise<void>;
  hide(state: SourceDeletionState): void;
  remove(sourceId: string): Promise<unknown>;
}): Promise<SourceDeletionState> {
  const check = () => { if (!io.current()) throw new SupersededRequest(); };
  check();
  const sourceId = readPendingSourceDeletion(state.pendingSourceDeletion);
  if (!sourceId || !state.signedIn || state.report || state.previousReport || state.run || state.source || state.readingAnchor || state.correctionDraft || state.events.length || state.attachments.length)
    throw new Error("Source deletion requires a cleared, owned cache snapshot.");
  await io.save(state); check();
  io.hide(state); check();
  const receipt = readSourceDeletionReceipt(await io.remove(sourceId), sourceId); check();
  const confirmed = completeSourceDeletion(state, receipt);
  await io.save(confirmed); check();
  return confirmed;
}
