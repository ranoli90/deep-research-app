export const FOLLOW_UP_ROUTER_VERSION = "follow-up-router.v1";

export const FOLLOW_UP_KINDS = [
  "explain",
  "change_constraint",
  "deepen",
  "verify_challenge",
  "add_source",
  "steer",
  "new_research",
] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];

export type FollowUpRoute = {
  version: typeof FOLLOW_UP_ROUTER_VERSION;
  kind: FollowUpKind;
  mutatesBrief: boolean;
  reason: string;
};

const URL_RE = /\bhttps?:\/\/[^\s]+/i;

/** One classifier for mobile and API. A new kind must be handled explicitly on both sides. */
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

/** Subtopic taken from a deepen message. The original question stays on the brief. */
export function deepenFocus(message: string): string {
  const text = message.trim();
  const matched = text.match(/^(?:go deeper|more detail|dig into|expand on|also research)\s+(?:on\s+)?(.+)$/i);
  const focus = (matched?.[1] ?? text).trim().replace(/[.?!]+$/u, "");
  return focus || text;
}
