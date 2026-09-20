/** Consumer composer placeholders. Never mention internals, spend, or planner chrome. */
export function composerPlaceholder(state: { inProgress: boolean; continues: boolean }): string {
  if (state.inProgress) return "Ask or refine research…";
  if (state.continues) return "Ask a follow-up…";
  return "Ask anything…";
}
