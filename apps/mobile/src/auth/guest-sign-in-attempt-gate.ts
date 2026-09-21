import type {
  GuestSignInAttempt,
  GuestSignInSessionTask,
} from "./guest-sign-in-sheet-state";
import type { GuestSignInAttemptRequest } from "./GuestSignInSheet";

export type GuestSignInAttemptGateTransport = {
  prepareAttempt(request: GuestSignInAttemptRequest): Promise<GuestSignInAttempt>;
  dismiss(context: { task: GuestSignInSessionTask | null; reason: "dismissed" }): Promise<void>;
};

type ActiveAttempt = {
  cancelled: boolean;
  request: GuestSignInAttemptRequest;
  prepared: Promise<GuestSignInAttempt>;
  task: GuestSignInSessionTask | null;
};

function taskFor(attempt: GuestSignInAttempt): GuestSignInSessionTask {
  return { attempt, kind: attempt.operation };
}

/**
 * One sheet-visible operation lease. It is deliberately client-side UX
 * serialization only: the durable journal and server idempotency remain the
 * authority. Its cancellation lease prevents a prepare result from opening an
 * auth provider after the user has already dismissed the sheet.
 */
export class GuestSignInAttemptGate {
  private active: ActiveAttempt | null = null;
  private dismissed = false;

  resetForVisibleSheet() {
    this.dismissed = false;
  }

  isDismissed(): boolean {
    return this.dismissed;
  }

  async run(
    request: GuestSignInAttemptRequest,
    onPrepared: (attempt: GuestSignInAttempt) => Promise<void>,
    invoke: (attempt: GuestSignInAttempt) => Promise<void>,
  ): Promise<GuestSignInAttempt | null> {
    if (this.dismissed || this.active !== null) return null;
    const active: ActiveAttempt = {
      cancelled: false,
      request,
      prepared: Promise.resolve().then(() => this.transport.prepareAttempt(request)),
      task: null,
    };
    this.active = active;
    try {
      const attempt = await active.prepared;
      this.assertMatchingAttempt(request, attempt);
      active.task = taskFor(attempt);
      if (active.cancelled || this.dismissed) return null;
      await onPrepared(attempt);
      if (active.cancelled || this.dismissed) return null;
      await invoke(attempt);
      return attempt;
    } finally {
      if (this.active === active) this.active = null;
    }
  }

  /** Makes dismissal durable even if a journal preparation is still resolving. */
  async dismiss(currentTask: GuestSignInSessionTask | null): Promise<GuestSignInSessionTask | null> {
    this.dismissed = true;
    const active = this.active;
    if (active) active.cancelled = true;
    // Do not await preparation here. The host dismissal is scoped to the
    // saved pending action, so it can suppress continuation before a flaky
    // durable-attempt write replies. A late attempt remains reconciliation
    // data only; `run` observes `cancelled` and cannot launch it.
    const task = active?.task ?? currentTask;
    await this.transport.dismiss({ task, reason: "dismissed" });
    return task;
  }

  private assertMatchingAttempt(request: GuestSignInAttemptRequest, attempt: GuestSignInAttempt) {
    if (!attempt?.id || attempt.operation !== request.operation || attempt.provider !== request.provider || attempt.email !== request.email) {
      throw new Error("The saved sign-in attempt could not be confirmed.");
    }
  }

  constructor(private readonly transport: GuestSignInAttemptGateTransport) {}
}
