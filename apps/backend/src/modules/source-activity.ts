import type { Queryable } from "../platform/db.js";

export const SOURCE_ACTIVITY_VERSION = "source-activity.v1";

/** Stable, owner-scoped source identity. A source is a document, never a passage or a read event. */
export type SourceActivityHandle = {
  sourceId: string;
  originCluster: string | null;
};

/**
 * Distinct source counters for one owned run. A count is null when the owned data
 * cannot establish it (for example, no report exists yet), never inferred.
 */
export type SourceActivityCounts = {
  version: typeof SOURCE_ACTIVITY_VERSION;
  /** Distinct discovered documents. */
  discoveredSources: number;
  /** Distinct documents with at least one readable version; retries and blocked reads never inflate it. */
  readSources: number;
  /** Distinct documents backing cited passages; null when no owned report exists. */
  citedSources: number | null;
  /** Distinct source versions backing cited passages; null when no owned report exists. */
  citedVersions: number | null;
  /** Distinct cited passages; null when no owned report exists. */
  citedPassages: number | null;
  /** Distinct independent-origin groups among cited sources; null when any cited origin is unknown. */
  independentOrigins: number | null;
  /** Stable owner-scoped handles for cited sources; null when no owned report exists. */
  citedSourceHandles: SourceActivityHandle[] | null;
};

export type SourceActivityInput = {
  discovered: readonly SourceActivityHandle[];
  read: readonly SourceActivityHandle[];
  cited: readonly (SourceActivityHandle & { versionId: string; passageId: string })[];
  reportPresent: boolean;
};

const normalizedOrigin = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleLowerCase("en-US") : null;
};

/** Pure aggregation of already owner-scoped rows. Several passages from one document stay one source. */
export function summarizeSourceActivity(input: SourceActivityInput): SourceActivityCounts {
  const discoveredSources = new Set(input.discovered.map((row) => row.sourceId));
  const readSources = new Set(input.read.map((row) => row.sourceId));
  const citedSources = new Set(input.cited.map((row) => row.sourceId));
  const citedVersions = new Set(input.cited.map((row) => row.versionId));
  const citedPassages = new Set(input.cited.map((row) => row.passageId));
  const origins = input.cited.map((row) => normalizedOrigin(row.originCluster));
  const independentOrigins = !input.reportPresent
    ? null
    : origins.every((origin) => origin !== null)
      ? new Set(origins).size
      : null;
  const handles = new Map<string, SourceActivityHandle>();
  for (const row of input.cited) {
    if (!handles.has(row.sourceId)) handles.set(row.sourceId, { sourceId: row.sourceId, originCluster: row.originCluster });
  }
  return {
    version: SOURCE_ACTIVITY_VERSION,
    discoveredSources: discoveredSources.size,
    readSources: readSources.size,
    citedSources: input.reportPresent ? citedSources.size : null,
    citedVersions: input.reportPresent ? citedVersions.size : null,
    citedPassages: input.reportPresent ? citedPassages.size : null,
    independentOrigins,
    citedSourceHandles: input.reportPresent ? [...handles.values()] : null,
  };
}

/** First-appearance distinct cited passage ids from owned report blocks. */
export function citedPassageIds(blocks: readonly { citationIds: readonly string[] }[]): string[] {
  return [...new Set(blocks.flatMap((block) => block.citationIds))];
}

/**
 * Owner-scoped distinct source activity for one run. `citedPassageIds` is null for
 * callers that have no report; cited fields then stay null instead of being inferred.
 */
export async function loadSourceActivity(
  db: Queryable,
  args: { runId: string; accountId: string; citedPassageIds: readonly string[] | null },
): Promise<SourceActivityCounts> {
  const notTombstoned = `NOT EXISTS(SELECT 1 FROM tombstones t
    WHERE t.account_id=$1 AND t.object_kind='source' AND t.object_id=s.id AND t.reason='source_deletion')`;
  const discovered = await db.query<{ id: string; origin_cluster: string | null }>(
    `SELECT s.id, s.origin_cluster FROM sources s
     WHERE s.account_id=$1 AND s.run_id=$2 AND ${notTombstoned}`,
    [args.accountId, args.runId],
  );
  const read = await db.query<{ id: string; origin_cluster: string | null }>(
    `SELECT DISTINCT s.id, s.origin_cluster FROM sources s
     JOIN source_versions v ON v.source_id=s.id AND v.account_id=s.account_id
     WHERE s.account_id=$1 AND s.run_id=$2 AND v.access_level IN ('partial-text','full-text') AND ${notTombstoned}`,
    [args.accountId, args.runId],
  );
  const cited = args.citedPassageIds === null
    ? []
    : (await db.query<{ source_id: string; version_id: string; passage_id: string; origin_cluster: string | null }>(
        `SELECT DISTINCT s.id AS source_id, v.id AS version_id, p.id AS passage_id, s.origin_cluster
         FROM authorized_run_passages p
         JOIN source_versions v ON v.id=p.source_version_id AND v.account_id=p.account_id
         JOIN sources s ON s.id=v.source_id AND s.account_id=p.account_id
         WHERE p.run_id=$1 AND p.account_id=$2 AND p.id::text=ANY($3::text[])`,
        [args.runId, args.accountId, [...args.citedPassageIds]],
      )).rows;
  return summarizeSourceActivity({
    discovered: discovered.rows.map((row) => ({ sourceId: row.id, originCluster: row.origin_cluster })),
    read: read.rows.map((row) => ({ sourceId: row.id, originCluster: row.origin_cluster })),
    cited: cited.map((row) => ({ sourceId: row.source_id, versionId: row.version_id, passageId: row.passage_id, originCluster: row.origin_cluster })),
    reportPresent: args.citedPassageIds !== null,
  });
}
