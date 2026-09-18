/** Ephemeral native focus only: never persisted with report or account content. */
export function createSourceFocus<T>(schedule: (callback: () => void) => void, focus: (node: T) => void) {
  let owner = "", report = "", view = "", epoch = 0;
  let target: string | null = null, returning = false;
  const nodes = new Map<string, T>();
  return {
    view(nextOwner: string, nextReport: string, nextView: string) {
      if (owner !== nextOwner || report !== nextReport) { target = null; returning = false; }
      if (owner !== nextOwner || report !== nextReport || view !== nextView) { epoch++; nodes.clear(); }
      owner = nextOwner; report = nextReport; view = nextView;
      return epoch;
    },
    open(key: string) { target = key; returning = false; },
    close() { returning = target !== null; },
    clear() { epoch++; nodes.clear(); target = null; returning = false; },
    register(generation: number, key: string, node: T | null, current: () => boolean) {
      if (generation !== epoch) return;
      if (node === null) { nodes.delete(key); return; }
      nodes.set(key, node);
      if (!returning || target !== key) return;
      schedule(() => {
        if (generation !== epoch || !returning || target !== key || nodes.get(key) !== node || !current()) return;
        returning = false; target = null; focus(node);
      });
    },
  };
}
