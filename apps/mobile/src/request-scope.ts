export class SupersededRequest extends Error {
  constructor() { super("Request superseded."); this.name = "SupersededRequest"; }
}

/** Account, selected-run and source-sheet lifetimes are independent of whether native fetch honors abort. */
export function createRequestScope() {
  let accountEpoch = 0, viewEpoch = 0, sourceEpoch = 0;
  let token: string | null = null, runId: string | null = null;
  let principal: string | null = null;
  let credentialGeneration = 0;
  const pending = new Map<AbortController, "account" | "view" | "source">();
  function abort(kind: "account" | "view" | "source") {
    for (const [controller, requestKind] of pending) {
      if (kind === "account" || requestKind === kind || (kind === "view" && requestKind === "source")) controller.abort();
    }
  }
  return {
    setSession(next: string | null, nextPrincipal?: string | null) {
      accountEpoch++; viewEpoch++; sourceEpoch++; token = next; principal = nextPrincipal ?? null;
      credentialGeneration++;
      runId = null; abort("account");
    },
    /** A verified renewal for the same internal member is credential churn, not a new principal or view. */
    rotateCredential(next: string, samePrincipal: string) {
      if (!next || !samePrincipal || principal !== samePrincipal || token === null) throw new SupersededRequest();
      token = next; credentialGeneration++;
    },
    epochs() {
      return { principalEpoch: accountEpoch, viewEpoch, credentialGeneration };
    },
    selectRun(next: string | null) {
      if (next === runId) return;
      runId = next; viewEpoch++; sourceEpoch++; abort("view");
    },
    invalidateView(session: string) {
      if (session !== token) throw new SupersededRequest();
      viewEpoch++; sourceEpoch++; abort("view");
    },
    closeSource() { sourceEpoch++; abort("source"); },
    currentRun(session: string, id: string) { return session === token && runId === id; },
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
