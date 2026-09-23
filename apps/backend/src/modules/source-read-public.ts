import { z } from "zod";
import { publicSourceHost, publicSourceUrl } from "@deep/contracts";

/**
 * Versioned consumer-safe projection of a source read. The payload is derived only from
 * authorized stored source metadata (never model output) and is safe to sanitize into the
 * public-activity.v1 DTO. Private supplied documents stay generic: no filename, no text,
 * no query terms and no locator ever appear.
 */
export const SOURCE_READ_PUBLIC_VERSION = "source-read-public.v1" as const;

export const SOURCE_READ_PUBLIC_STATES = ["discovered", "read", "unavailable"] as const;
export type SourceReadPublicState = (typeof SOURCE_READ_PUBLIC_STATES)[number];

export const SourceReadPublicSchema = z
  .object({
    version: z.literal(SOURCE_READ_PUBLIC_VERSION),
    state: z.enum(SOURCE_READ_PUBLIC_STATES),
    sourceTitle: z.string().min(1).max(200).nullable(),
    sourceDomain: z.string().min(1).max(253).nullable(),
  })
  .strict();
export type SourceReadPublic = z.infer<typeof SourceReadPublicSchema>;

const PRIVATE = /attachment:\/\/|BEGIN [A-Z ]+PRIVATE|sk-|api[_-]?key|password|prompt:|system message/i;

/** Authorized stored metadata for one owned source row. */
export type StoredSourceIdentity = {
  canonicalLocator: string;
  title: string | null;
  sourceType?: string | null;
};

function consumerSafeTitle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 200) return null;
  if (PRIVATE.test(trimmed) || /https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** A source is public-web only when its stored locator is a public http(s) URL, never an upload. */
export function isPublicWebSource(source: StoredSourceIdentity): boolean {
  if (source.sourceType === "supplied-document") return false;
  if (source.canonicalLocator.startsWith("attachment://")) return false;
  return publicSourceUrl(source.canonicalLocator) !== null;
}

/** Build the versioned public payload from stored metadata and the honest read state. */
export function sourceReadPublicPayload(
  source: StoredSourceIdentity,
  state: SourceReadPublicState,
): SourceReadPublic {
  const publicWeb = isPublicWebSource(source);
  return {
    version: SOURCE_READ_PUBLIC_VERSION,
    state,
    sourceTitle: publicWeb ? consumerSafeTitle(source.title) : null,
    sourceDomain: publicWeb ? publicSourceHost(source.canonicalLocator) : null,
  };
}

/**
 * Read a persisted versioned payload back. Historic events (no versioned object) return null
 * so callers never invent a source identity for them.
 */
export function readSourceReadPublic(payload: unknown): SourceReadPublic | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const candidate = (payload as Record<string, unknown>).sourceRead;
  const parsed = SourceReadPublicSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
