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

export function libraryItemCopy(item: LibraryRecord): {
  title: string;
  status: string;
  updated: string | null;
  version: string | null;
  canResume: boolean;
} {
  return {
    title: item.title.trim() || "Untitled research",
    status: libraryStatusLabel(item.status),
    updated: libraryUpdatedLabel(item),
    version: libraryVersionLabel(item),
    canResume: Boolean(item.id),
  };
}
