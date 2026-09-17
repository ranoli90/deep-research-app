export class SupersededRequest extends Error {
  constructor() { super("Request superseded."); this.name = "SupersededRequest"; }
}

/** Account, selected-run and source-sheet lifetimes are independent of whether native fetch honors abort. */
export function createRequestScope() {
  let accountEpoch = 0, viewEpoch = 0, sourceEpoch = 0;
  let token: string | null = null, runId: string | null = null;
  const pending = new Map<AbortController, "account" | "view" | "source">();
  function abort(kind: "account" | "view" | "source") {
    for (const [controller, requestKind] of pending) {
      if (kind === "account" || requestKind === kind || (kind === "view" && requestKind === "source")) controller.abort();
    }
  }
  return {
    setSession(next: string | null) {
      accountEpoch++; viewEpoch++; sourceEpoch++; token = next; runId = null; abort("account");
    },
    selectRun(next: string | null) {
      if (next === runId) return;
      runId = next; viewEpoch++; sourceEpoch++; abort("view");
    },
    closeSource() { sourceEpoch++; abort("source"); },
    currentRun(session: string, id: string) { return token === session && runId === id; },
    capture(kind: "account" | "view" | "source", expectedToken?: string, expectedRun?: string) {
      if (expectedToken !== undefined && expectedToken !== token) throw new SupersededRequest();
      if (expectedRun !== undefined && expectedRun !== runId) throw new SupersededRequest();
      const account = accountEpoch, view = viewEpoch, source = sourceEpoch;
      const controller = new AbortController(); pending.set(controller, kind);
      return {
        signal: controller.signal,
        current() { return !controller.signal.aborted && accountEpoch === account &&
          (kind === "account" || viewEpoch === view) && (kind !== "source" || sourceEpoch === source); },
        release() { pending.delete(controller); },
      };
    },
  };
}
