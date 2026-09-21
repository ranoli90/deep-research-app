import { describe, expect, it } from "vitest";
import { GuestSignInAttemptGate } from "../src/auth/guest-sign-in-attempt-gate";
import type { GuestSignInAttempt } from "../src/auth/guest-sign-in-sheet-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

const google: GuestSignInAttempt = { id: "attempt-google", operation: "provider", provider: "google", email: null };

describe("guest sign-in attempt gate", () => {
  it("serializes duplicate provider presses while the durable prepare is unresolved", async () => {
    const prepared = deferred<GuestSignInAttempt>();
    const calls: string[] = [];
    const gate = new GuestSignInAttemptGate({
      prepareAttempt: async () => { calls.push("prepare"); return prepared.promise; },
      dismiss: async () => { calls.push("dismiss"); },
    });
    const first = gate.run({ operation: "provider", provider: "google", email: null }, async () => { calls.push("begin"); }, async () => { calls.push("provider"); });
    const second = gate.run({ operation: "provider", provider: "google", email: null }, async () => { calls.push("duplicate-begin"); }, async () => { calls.push("duplicate-provider"); });
    await Promise.resolve();
    expect(calls).toEqual(["prepare"]);
    prepared.resolve(google);
    await expect(first).resolves.toEqual(google);
    await expect(second).resolves.toBeNull();
    expect(calls).toEqual(["prepare", "begin", "provider"]);
  });

  it("suppresses a prepared provider when dismissal starts before prepare resolves", async () => {
    const prepared = deferred<GuestSignInAttempt>();
    const calls: string[] = [];
    const gate = new GuestSignInAttemptGate({
      prepareAttempt: () => prepared.promise,
      dismiss: async ({ task }) => { calls.push(`dismiss:${task?.attempt.id ?? "none"}`); },
    });
    const start = gate.run({ operation: "provider", provider: "google", email: null }, async () => { calls.push("begin"); }, async () => { calls.push("provider"); });
    const closing = gate.dismiss(null);
    prepared.resolve(google);
    await closing;
    await expect(start).resolves.toBeNull();
    expect(calls).toEqual(["dismiss:attempt-google"]);
  });

  it("rejects a prepare result that does not match its durable request", async () => {
    const gate = new GuestSignInAttemptGate({
      prepareAttempt: async () => ({ ...google, provider: "apple" }),
      dismiss: async () => undefined,
    });
    await expect(gate.run({ operation: "provider", provider: "google", email: null }, async () => undefined, async () => undefined)).rejects.toThrow("could not be confirmed");
  });
});
