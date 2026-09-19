import { COUNTEREVIDENCE_SUFFIX } from "@deep/contracts";
import {
  CANDIDATE_LEDGER_VERSION,
  CONCLUSION_CHALLENGE_VERSION,
  EVIDENCE_NEEDS_VERSION,
  SOURCE_CLASSES,
  buildCandidateLedger,
  type CandidateLedger,
  type EvidenceNeed,
  type LedgerEntry,
  type SourceClass,
} from "@deep/research-core";
import type { Queryable } from "../platform/db.js";

const normalize = (text: string) => text.trim().toLocaleLowerCase("en").replace(/\s+/gu, " ");

function parseSourceClass(value: unknown): SourceClass | null {
  return typeof value === "string" && (SOURCE_CLASSES as readonly string[]).includes(value) ? (value as SourceClass) : null;
}

export type DiscoveryAttemptState = {
  queries: string[];
  classesAttempted: SourceClass[];
  intentIds: string[];
};

/** Reconstruct issued discovery queries/classes from durable search_operations, excluding challenge searches. */
export async function loadDiscoveryAttempts(
  db: Queryable,
  args: { runId: string; accountId: string; briefRevision: number },
): Promise<DiscoveryAttemptState> {
  const rows = await db.query<{ query: string | null; source_class: string | null; intent_id: string }>(
    `SELECT s.query, s.source_class, s.intent_id
       FROM search_operations s
       JOIN provider_intents i ON i.id = s.intent_id
      WHERE s.run_id=$1 AND s.account_id=$2 AND s.brief_revision=$3
        AND NOT EXISTS (SELECT 1 FROM counterevidence_checks c WHERE c.search_intent_id=s.intent_id AND c.run_id=s.run_id AND c.account_id=s.account_id)
        AND NOT EXISTS (SELECT 1 FROM conclusion_challenges c WHERE c.search_intent_id=s.intent_id AND c.run_id=s.run_id AND c.account_id=s.account_id)
        AND (s.query IS NULL OR s.query NOT LIKE '%' || $4)
      ORDER BY i.created_at, s.intent_id`,
    [args.runId, args.accountId, args.briefRevision, ` ${COUNTEREVIDENCE_SUFFIX}`],
  );
  const queries: string[] = [];
  const seen = new Set<string>();
  const classesAttempted: SourceClass[] = [];
  const classSeen = new Set<string>();
  const intentIds: string[] = [];
  for (const row of rows.rows) {
    intentIds.push(row.intent_id);
    if (row.query) {
      const key = normalize(row.query);
      if (!seen.has(key)) {
        seen.add(key);
        queries.push(row.query);
      }
    }
    const sourceClass = parseSourceClass(row.source_class);
    if (sourceClass && !classSeen.has(sourceClass)) {
      classSeen.add(sourceClass);
      classesAttempted.push(sourceClass);
    }
  }
  return { queries, classesAttempted, intentIds };
}

export async function loadEvidenceNeeds(
  db: Queryable,
  args: { runId: string; accountId: string; briefRevision: number },
): Promise<EvidenceNeed[]> {
  const rows = await db.query<{
    need_id: string;
    version: string;
    criterion_key: string | null;
    question: string;
    would_establish: string;
    preferred_source_classes: unknown;
    weak_substitutes: unknown;
    freshness_required: boolean;
    disconfirming: string;
    candidate_scope: string | null;
    state: EvidenceNeed["state"];
    next_action: EvidenceNeed["nextAction"];
    stop_reason: string | null;
  }>(
    `SELECT need_id, version, criterion_key, question, would_establish, preferred_source_classes, weak_substitutes,
            freshness_required, disconfirming, candidate_scope, state, next_action, stop_reason
       FROM research_evidence_needs WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3 ORDER BY need_id`,
    [args.runId, args.accountId, args.briefRevision],
  );
  return rows.rows.filter((r) => r.version === EVIDENCE_NEEDS_VERSION).map((r) => ({
    id: r.need_id,
    version: EVIDENCE_NEEDS_VERSION,
    criterionKey: r.criterion_key,
    question: r.question,
    wouldEstablish: r.would_establish,
    preferredSourceClasses: r.preferred_source_classes as EvidenceNeed["preferredSourceClasses"],
    weakSubstitutes: r.weak_substitutes as EvidenceNeed["weakSubstitutes"],
    freshnessRequired: r.freshness_required,
    disconfirming: r.disconfirming,
    candidateScope: r.candidate_scope,
    state: r.state,
    nextAction: r.next_action,
    stopReason: r.stop_reason,
  }));
}

export async function persistEvidenceNeeds(
  db: Queryable,
  args: { runId: string; accountId: string; briefRevision: number; needs: EvidenceNeed[] },
): Promise<void> {
  await db.query("DELETE FROM research_evidence_needs WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3", [
    args.runId,
    args.accountId,
    args.briefRevision,
  ]);
  for (const need of args.needs) {
    await db.query(
      `INSERT INTO research_evidence_needs(
         run_id, need_id, account_id, brief_revision, version, criterion_key, question, would_establish,
         preferred_source_classes, weak_substitutes, freshness_required, disconfirming, candidate_scope,
         state, next_action, stop_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        args.runId,
        need.id,
        args.accountId,
        args.briefRevision,
        need.version,
        need.criterionKey,
        need.question,
        need.wouldEstablish,
        JSON.stringify(need.preferredSourceClasses),
        JSON.stringify(need.weakSubstitutes),
        need.freshnessRequired,
        need.disconfirming,
        need.candidateScope,
        need.state,
        JSON.stringify(need.nextAction),
        need.stopReason,
      ],
    );
  }
}

function parseEntry(row: {
  identity: string;
  candidate_key: string | null;
  discovered_from: string | null;
  excluded_by: string | null;
  status: string | null;
  feasibility: string | null;
  price: string | number | null;
  currency: string | null;
  region: string | null;
  exclusion_evidence: string | null;
}): LedgerEntry {
  const id = row.candidate_key || row.identity.toLowerCase().replace(/\s+/g, "-");
  const feasibility = (row.feasibility === "satisfies" || row.feasibility === "violates" || row.feasibility === "unknown" || row.feasibility === "not-applicable"
    ? row.feasibility
    : "unknown") as LedgerEntry["feasibility"];
  const status = (row.status === "discovered" || row.status === "inspected" || row.status === "eligible" || row.status === "excluded" || row.status === "unresolved"
    ? row.status
    : feasibility === "violates" ? "excluded" : "discovered") as LedgerEntry["status"];
  return {
    id,
    identity: row.identity,
    discoveredFrom: row.discovered_from ?? "",
    excludedBy: row.excluded_by ?? undefined,
    feasibility,
    price: row.price == null ? undefined : Number(row.price),
    currency: row.currency ?? undefined,
    region: row.region ?? undefined,
    status,
    exclusionReason: row.exclusion_evidence ?? row.excluded_by ?? null,
  };
}

export async function loadCandidateLedger(
  db: Queryable,
  args: { runId: string; accountId?: string },
): Promise<CandidateLedger | null> {
  const header = await db.query<{ version: string; universe_complete: boolean; completeness_note: string; searches: number }>(
    `SELECT version, universe_complete, completeness_note, searches FROM candidate_ledgers WHERE run_id=$1`,
    [args.runId],
  );
  const entries = await db.query({
    text: `SELECT identity, candidate_key, discovered_from, excluded_by, status, feasibility, price, currency, region, exclusion_evidence
             FROM candidates WHERE run_id=$1 AND candidate_key IS NOT NULL ORDER BY identity`,
    values: [args.runId],
  });
  if (!header.rowCount && !entries.rowCount) return null;
  const coverage = header.rows[0];
  return buildCandidateLedger(entries.rows.map(parseEntry), coverage
    ? { searches: coverage.searches, remainingDistinctStrategy: !coverage.universe_complete, reopened: coverage.completeness_note.includes("constraint changed") }
    : { searches: 0, remainingDistinctStrategy: true });
}

export async function persistCandidateLedger(
  db: Queryable,
  args: { runId: string; accountId: string; briefRevision: number; ledger: CandidateLedger; searches: number },
): Promise<void> {
  await db.query(
    `INSERT INTO candidate_ledgers(run_id, account_id, brief_revision, version, universe_complete, completeness_note, searches)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (run_id) DO UPDATE SET
       brief_revision=EXCLUDED.brief_revision, version=EXCLUDED.version, universe_complete=EXCLUDED.universe_complete,
       completeness_note=EXCLUDED.completeness_note, searches=EXCLUDED.searches`,
    [args.runId, args.accountId, args.briefRevision, args.ledger.version, args.ledger.universeComplete, args.ledger.completenessNote, args.searches],
  );
  await db.query("DELETE FROM candidates WHERE run_id=$1 AND candidate_key IS NOT NULL", [args.runId]);
  for (const entry of args.ledger.entries) {
    await db.query(
      `INSERT INTO candidates(
         id, run_id, account_id, brief_revision, identity, candidate_key, discovered_from, excluded_by,
         status, feasibility, price, currency, region, exclusion_evidence, ledger_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        crypto.randomUUID(),
        args.runId,
        args.accountId,
        args.briefRevision,
        entry.identity,
        entry.id,
        entry.discoveredFrom,
        entry.excludedBy ?? null,
        entry.status,
        entry.feasibility,
        entry.price ?? null,
        entry.currency ?? null,
        entry.region ?? null,
        entry.exclusionReason,
        CANDIDATE_LEDGER_VERSION,
      ],
    );
  }
}

export type StoredConclusionChallenge = {
  id: string;
  conclusionKey: string;
  conclusionText: string;
  questionKey: string;
  wouldFalsify: string;
  likelySourceClass: SourceClass;
  challenged: boolean;
  changedConclusion: boolean | null;
  state: "planned" | "challenged" | "blocked" | "unknown";
  outcome: string | null;
  reason: string | null;
  searchIntentId: string | null;
  modelIntentId: string | null;
};

export async function loadConclusionChallenges(
  db: Queryable,
  args: { runId: string; accountId: string; briefRevision: number },
): Promise<StoredConclusionChallenge[]> {
  const rows = await db.query<{
    id: string;
    conclusion_key: string;
    conclusion_text: string;
    question_key: string;
    would_falsify: string;
    likely_source_class: string;
    challenged: boolean;
    changed_conclusion: boolean | null;
    state: StoredConclusionChallenge["state"];
    outcome: string | null;
    reason: string | null;
    search_intent_id: string | null;
    model_intent_id: string | null;
    version: string;
  }>(
    `SELECT id, conclusion_key, conclusion_text, question_key, would_falsify, likely_source_class, challenged,
            changed_conclusion, state, outcome, reason, search_intent_id, model_intent_id, version
       FROM conclusion_challenges WHERE run_id=$1 AND account_id=$2 AND brief_revision=$3 ORDER BY conclusion_key`,
    [args.runId, args.accountId, args.briefRevision],
  );
  return rows.rows.filter((r) => r.version === CONCLUSION_CHALLENGE_VERSION).map((r) => ({
    id: r.id,
    conclusionKey: r.conclusion_key,
    conclusionText: r.conclusion_text,
    questionKey: r.question_key,
    wouldFalsify: r.would_falsify,
    likelySourceClass: parseSourceClass(r.likely_source_class) ?? "generic-web",
    challenged: r.challenged,
    changedConclusion: r.changed_conclusion,
    state: r.state,
    outcome: r.outcome,
    reason: r.reason,
    searchIntentId: r.search_intent_id,
    modelIntentId: r.model_intent_id,
  }));
}

export async function persistConclusionChallenge(
  db: Queryable,
  args: {
    runId: string;
    accountId: string;
    briefRevision: number;
    taskId: string;
    conclusionKey: string;
    conclusionText: string;
    questionKey: string;
    wouldFalsify: string;
    likelySourceClass: SourceClass;
    challenged?: boolean;
    changedConclusion?: boolean | null;
    state?: StoredConclusionChallenge["state"];
    outcome?: string | null;
    reason?: string | null;
    searchIntentId?: string | null;
    modelIntentId?: string | null;
  },
): Promise<StoredConclusionChallenge> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO conclusion_challenges(
       id, account_id, run_id, task_id, brief_revision, version, conclusion_key, conclusion_text, question_key,
       would_falsify, likely_source_class, challenged, changed_conclusion, state, outcome, reason, search_intent_id, model_intent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (run_id, brief_revision, conclusion_key) DO UPDATE SET
       would_falsify=EXCLUDED.would_falsify, likely_source_class=EXCLUDED.likely_source_class,
       challenged=CASE WHEN EXCLUDED.state='planned' THEN conclusion_challenges.challenged ELSE EXCLUDED.challenged END,
       changed_conclusion=COALESCE(EXCLUDED.changed_conclusion, conclusion_challenges.changed_conclusion),
       state=CASE WHEN conclusion_challenges.state IN ('challenged','blocked','unknown') AND EXCLUDED.state='planned'
         THEN conclusion_challenges.state ELSE EXCLUDED.state END,
       outcome=COALESCE(EXCLUDED.outcome, conclusion_challenges.outcome),
       reason=CASE WHEN EXCLUDED.state='planned' THEN conclusion_challenges.reason ELSE EXCLUDED.reason END,
       search_intent_id=COALESCE(EXCLUDED.search_intent_id, conclusion_challenges.search_intent_id),
       model_intent_id=COALESCE(EXCLUDED.model_intent_id, conclusion_challenges.model_intent_id)
     WHERE conclusion_challenges.version=$6`,
    [
      id,
      args.accountId,
      args.runId,
      args.taskId,
      args.briefRevision,
      CONCLUSION_CHALLENGE_VERSION,
      args.conclusionKey,
      args.conclusionText,
      args.questionKey,
      args.wouldFalsify,
      args.likelySourceClass,
      args.challenged ?? false,
      args.changedConclusion ?? null,
      args.state ?? "planned",
      args.outcome ?? null,
      args.reason ?? null,
      args.searchIntentId ?? null,
      args.modelIntentId ?? null,
    ],
  );
  const saved = (await loadConclusionChallenges(db, args)).find((c) => c.conclusionKey === args.conclusionKey);
  if (!saved) throw new Error("conclusion_challenge_missing");
  return saved;
}

export async function loadReadablePassageIds(
  db: Queryable,
  args: { runId: string; accountId: string },
): Promise<{ passages: { id: string; exactText: string }[]; readableIds: Set<string> }> {
  const rows = await db.query<{ id: string; exact_text: string; access_level: string }>(
    `SELECT p.id, p.exact_text, v.access_level
       FROM authorized_run_passages p
       JOIN source_versions v ON v.id=p.source_version_id AND v.account_id=p.account_id
      WHERE p.account_id=$1 AND p.run_id=$2
        AND v.access_level IN ('snippet','partial-text','full-text')
      ORDER BY p.id`,
    [args.accountId, args.runId],
  );
  const readableIds = new Set(rows.rows.filter((r) => r.access_level === "partial-text" || r.access_level === "full-text").map((r) => r.id));
  return { passages: rows.rows.map((r) => ({ id: r.id, exactText: r.exact_text })), readableIds };
}
