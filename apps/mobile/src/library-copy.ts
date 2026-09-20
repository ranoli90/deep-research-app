const STATUS_LABELS: Record<string, string> = {
  completed: "Ready",
  completed_with_limitations: "Ready, with limits",
  cancelled: "Cancelled",
  failed: "Failed",
  queued: "Queued",
  running: "Researching",
  awaiting_input: "Needs a detail",
  cancelling: "Stopping",
  terminal: "Ended",
};

export type LibraryRecord = {
  id: string;
  title: string;
  status: string;
  report_id?: string | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  version?: number | null;
  preview?: string | null;
  source_count?: number | null;
  changed?: boolean | null;
};

export function libraryStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function libraryUpdatedLabel(item: LibraryRecord): string | null {
  const raw = item.updated_at ?? item.created_at;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function libraryVersionLabel(item: LibraryRecord): string | null {
  return typeof item.version === "number" && Number.isSafeInteger(item.version) && item.version > 0
    ? `Version ${item.version}`
    : null;
}

/** Honest preview only. Never invent an answer excerpt. */
export function libraryPreview(item: LibraryRecord): string | null {
  const owned = item.preview?.trim();
  if (owned) return owned;
  if (!item.report_id) {
    if (item.status === "running" || item.status === "queued") return "Still researching.";
    if (item.status === "awaiting_input") return "Needs a detail to continue.";
    if (item.status === "failed") return "Research failed.";
    if (item.status === "cancelled") return "Research cancelled.";
    return "Resume when you are ready.";
  }
  if (item.status === "completed_with_limitations") return "Answer ready, with limits.";
  if (item.status === "completed") return "Answer ready.";
  return null;
}

export function librarySourceCount(item: LibraryRecord): string | null {
  return typeof item.source_count === "number" && Number.isSafeInteger(item.source_count) && item.source_count > 0
    ? `${item.source_count} source${item.source_count === 1 ? "" : "s"}`
    : null;
}

export function libraryChanged(item: LibraryRecord): boolean {
  if (item.changed === true) return true;
  return typeof item.version === "number" && item.version > 1;
}

export function libraryItemCopy(item: LibraryRecord): {
  title: string;
  status: string;
  updated: string | null;
  version: string | null;
  preview: string | null;
  sources: string | null;
  changed: boolean;
  canResume: boolean;
} {
  return {
    title: item.title.trim().replace(/\s+/g, " ") || "Untitled research",
    status: libraryStatusLabel(item.status),
    updated: libraryUpdatedLabel(item),
    version: libraryVersionLabel(item),
    preview: libraryPreview(item),
    sources: librarySourceCount(item),
    changed: libraryChanged(item),
    canResume: Boolean(item.id),
  };
}
