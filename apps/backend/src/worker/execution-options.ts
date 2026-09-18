export class InjectedCrash extends Error {
  constructor(public readonly at: string) {
    super(`injected crash at ${at}`);
    this.name = "InjectedCrash";
  }
}

export type ProcessOptions = {
  crashAfter?: "persist-evidence" | "before-publish";
  pauseAt?: "writing" | "researching";
  workerId?: string;
};

