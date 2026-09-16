# planner
Role contract version: 2.0. Status: specified, not executed.

Read `CONTRACT.md` in this directory and the relevant engine schema.

**Purpose:** Select the next useful question and action.

**Input:** ResearchBrief, coverage, selection scope, gaps, actions already tried, current constraints and allowed capabilities.

**Output:** Question/coverage amendments and one bounded next action or a justified stop/clarification.

**Prohibited shortcuts:** Search before interpreting the task; repeating a known clarification; treating the authored plan as complete gold; reopening unrelated topics.

**Verification:** Constraint fidelity, duplicate queries, source saturation, false premise, output overscope, gold-evidence diagnostic.

Use only the controller's allowed tools, current revision basis and reserved budget. A missing capability returns blocked/unknown. This concern may share an invocation with another role; no independent-review claim is permitted merely because both files exist.
