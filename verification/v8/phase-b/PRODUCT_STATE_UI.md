# Product state → UI state

Phase B map after Phase A SHA `f627b2b`. Only typed public activity, run lifecycle, and owned report/evidence fields may appear. Planner, spend, provider, and chain-of-thought stay hidden.

| Product state | Visible? | Surface | Actionable | Copy / notes |
|---|---|---|---|---|
| `queued` / `running` with no events | Yes | One status line | Retry if stalled | “Waiting for the server.” |
| `running` with activity | Yes | Research Trace (collapsed by default) | Expand/collapse; Stop in composer | Current activity label + pulse + real elapsed if timestamps exist |
| `awaiting_input` | Yes | Clarification card; composer hidden | Typed continue | Needed detail only; no interview chrome |
| `cancelling` | Yes | Trace + status | None | “Research cancelled” once terminal |
| `terminal` + `completed` | Yes | Answer-first report | Follow-up composer, sources, Library | Collapse trace to “Researched N sources · time” only if known |
| `terminal` + `completed_with_limitations` | Yes | Answer + caveats | Follow-ups from unresolved items | Limitations as caveats, not process meta |
| `terminal` + `failed` | Yes | Status line | Retry | “Research failed.” |
| `terminal` + `cancelled` | Yes | Status line | New research | “Research cancelled.” |
| `intent_ready` | Collapsible | Trace row | No | “Understood the question” |
| `clarification` | Yes | Trace + card | Yes | “Needed a detail” |
| `plan_ready` | Collapsible | Trace | No | “Research questions are ready” — not planner JSON |
| `searching` | Collapsible | Trace + optional source pills | No | “Searching public sources” |
| `sources_found` | Collapsible | Trace | No | “Found sources” |
| `source_reading` | Collapsible | Trace + domain pills | Open source when owned | “Reading a source” |
| `source_unreadable` | Collapsible | Trace | No | “Could not read a source”; run continues |
| `evidence_selected` / `evidence_checked` | Collapsible | Trace | No | Selected/checked evidence |
| `contradiction_*` | Collapsible | Trace; caveat in report | Follow-up | Disagreement, not agent theater |
| `freshness_checking` | Collapsible | Trace; caveat if unmet | No | Currentness, not raw dates unless owned |
| `plan_pivot` | Collapsible | Trace | No | “Changed the search plan” |
| `calculation` | Collapsible | Trace; numbers in report | No | “Checked the numbers” |
| `writing` / `report_ready` | Collapsible then collapse | Trace → report | Yes | Answer first |
| Snippet / partial / full / blocked source | Quote-first sheet | Source sheet | Challenge, delete own source | Access in Technical Details |
| Stale / unknown date / version | Advanced + caveat | Sheet / limitation | No | Unknown is not “fresh” |
| Evidence Needs / candidate ledger | Hidden | Advanced-only if ever shown | No | Not consumer chrome |
| Falsification / verification child | Report + trace | Scoped outcome | Request check | No fake adjudication |
| Private query permission | Banner/sheet | Approve exact query | Yes | Never show private terms in search chips |
| Consent revoked / deleted account | Error | Sign-in / grant | Yes | Fail closed |
| Source deleted / invalidated | Status + Library | Honest empty | New research | No resurrected quotes |
| Cost / provider / policy ids | Hidden | Advanced diagnostics only | No | Never on the research canvas |
| Follow-up explain | Inline answer | No new run | Optional deepen | Owned evidence only |
| Follow-up correct / replace question | Composer | Child run | Yes | Original question not silently rewritten |
| Follow-up verify | Composer/action | Child verification | Yes | Target identity required |
| Offline | Status line | Retry | Yes | “You're offline.” |
| Pending admission / unknown request | Composer Retry | Resume exact key | Yes | No second paid identity |
| Content invalidated | Hide report | Retry / Library | Yes | Do not show stale quotes |

**Visible by default:** question bubble, live trace (collapsed), answer, compact citations, follow-up composer.

**Collapsible:** full research trace, report TOC, Technical Details on sources.

**Hidden:** spend, model routes, Evidence Needs tables, candidate ledgers, injection/policy internals, private terms, planner JSON.
