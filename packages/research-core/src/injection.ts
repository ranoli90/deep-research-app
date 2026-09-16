const INJECTION_PATTERNS = [
  /ignore (all )?previous instructions/i,
  /reveal (the )?(api|secret|private)?\s*keys?/i,
  /you are now/i,
  /disable safety/i,
  /exfiltrate/i,
  /grant (yourself|me) (admin|tool)/i,
  /call the \w+ tool to/i,
];

export function sourceLooksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

export const TOOL_ALLOWLIST = [
  "clarify",
  "search",
  "fetch",
  "extract_text",
  "compare",
  "calculate",
  "verify",
  "replan",
  "synthesize",
  "stop",
] as const;

export type ToolName = (typeof TOOL_ALLOWLIST)[number];

export function isAllowedTool(type: string): type is ToolName {
  return (TOOL_ALLOWLIST as readonly string[]).includes(type);
}

const PRIVILEGED_FIELDS = ["newTools", "apiKey", "spendCapOverride", "processorOverride", "bypassConsent"];

export function rejectPrivilegedProposal(proposal: {
  type: string;
  privileged?: boolean;
  arguments?: Record<string, unknown>;
}): string | null {
  if (!isAllowedTool(proposal.type)) {
    return `action type ${proposal.type} is not on the tool allowlist`;
  }
  if (proposal.privileged) {
    return "privileged flag is not authorized by source content or model output";
  }
  const args = proposal.arguments ?? {};
  for (const field of PRIVILEGED_FIELDS) {
    if (field in args) return `privileged field ${field} rejected`;
  }
  return null;
}

/**
 * Private attachment text must not be copied into a public search query.
 */
export function queryLeaksPrivate(query: string, privateCanaries: string[]): string | null {
  const q = query.toLowerCase();
  for (const c of privateCanaries) {
    if (c && q.includes(c.toLowerCase())) return c;
  }
  return null;
}
