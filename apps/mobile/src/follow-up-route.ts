export const FOLLOW_UP_ROUTER_VERSION = "follow-up-router.v1";

export type FollowUpKind =
  | "explain"
  | "change_constraint"
  | "deepen"
  | "verify_challenge"
  | "add_source"
  | "steer"
  | "new_research";

export type FollowUpRoute = {
  version: typeof FOLLOW_UP_ROUTER_VERSION;
  kind: FollowUpKind;
  mutatesBrief: boolean;
  reason: string;
};

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

/** Classify a composer message. Ordinary explanations never become replace_question. */
export function routeFollowUp(message: string, opts: { reportReady: boolean; runActive: boolean }): FollowUpRoute {
  const text = message.trim();
  if (!text) return { version: FOLLOW_UP_ROUTER_VERSION, kind: "explain", mutatesBrief: false, reason: "empty" };
  if (URL_RE.test(text) && /\b(check|add|also|include|consider|use this)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "add_source", mutatesBrief: false, reason: "user_supplied_url" };
  }
  if (opts.runActive && /\b(only use|focus on|official sources|exclude|prefer)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "steer", mutatesBrief: false, reason: "active_steering" };
  }
  if (/\b(why (not|didn't|did you)|explain|what does that mean|how did you)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "explain", mutatesBrief: false, reason: "explanation_question" };
  }
  if (/\b(instead|actually|change|raise|lower|budget is|under \$?\d|must be|required)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "change_constraint", mutatesBrief: true, reason: "constraint_change" };
  }
  if (/\b(verify|challenge|double[- ]check|is that true|recheck)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "verify_challenge", mutatesBrief: false, reason: "verification" };
  }
  if (/\b(go deeper|more detail|dig into|expand on|also research)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "deepen", mutatesBrief: false, reason: "deepen_existing" };
  }
  if (!opts.reportReady && !opts.runActive) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "new_research", mutatesBrief: true, reason: "fresh_question" };
  }
  if (/\b(new question|different topic|unrelated|start over)\b/i.test(text)) {
    return { version: FOLLOW_UP_ROUTER_VERSION, kind: "new_research", mutatesBrief: true, reason: "new_topic" };
  }
  return { version: FOLLOW_UP_ROUTER_VERSION, kind: "explain", mutatesBrief: false, reason: "default_explain_existing" };
}
