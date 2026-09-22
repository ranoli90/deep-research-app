import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { api, isOfflineError, isSupersededRequest } from "./api";
import { breakLongTokens } from "./report-layout";
import { libraryItemCopy, type LibraryRecord } from "./library-copy";
import { ShareIcon } from "./icons";

type Styles = {
  body: StyleProp<ViewStyle>;
  card: StyleProp<ViewStyle>;
  title: StyleProp<TextStyle>;
  kicker: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  quietLink: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
  libraryRow: StyleProp<ViewStyle>;
  librarySearch: StyleProp<TextStyle>;
  libraryPreview?: StyleProp<TextStyle>;
  libraryMeta?: StyleProp<TextStyle>;
};

const PAGE_LIMIT = 30;

/** Fresh page first, then any already-loaded rows that are not in it. Keeps scroll depth on a silent refresh. */
export function mergeLibraryItems(
  fresh: readonly LibraryRecord[],
  existing: readonly LibraryRecord[],
): LibraryRecord[] {
  const seen = new Set(fresh.map((item) => item.id));
  return [...fresh, ...existing.filter((item) => !seen.has(item.id))];
}

type Loaded = {
  principal: string | null;
  items: LibraryRecord[];
  nextCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  offline: boolean;
  moreError: string | null;
};

const emptyLoaded = (principal: string | null, loading: boolean): Loaded => ({
  principal, items: [], nextCursor: null, loading, refreshing: false, error: null, offline: false, moreError: null,
});

export function LibraryList({
  token,
  principal,
  reloadKey = "",
  styles,
  onOpen,
  onShare,
  ink = "#6B645C",
}: {
  token: string | null;
  /** Stable member principal (account id), never the rotating bearer. */
  principal: string | null;
  reloadKey?: string;
  styles: Styles;
  onOpen: (id: string) => void;
  onShare: (reportId: string) => void;
  ink?: string;
}) {
  const [query, setQuery] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(() => emptyLoaded(principal, Boolean(principal && token)));
  // Cache keyed by principal + filter, never by bearer. Credential renewal is not a cache miss.
  const cache = useRef(new Map<string, { items: LibraryRecord[]; nextCursor: string | null }>());
  const principalRef = useRef<string | null>(principal);
  const lastKey = useRef<string | null>(null);
  const loadingMore = useRef(false);

  const filterKey = (owner: string, text: string) => `${owner}\u0000${text.trim().toLowerCase()}`;

  // A real account change clears the protected list and its filter. A routine
  // credential rotation keeps the same principal and never blanks the list.
  useEffect(() => {
    if (principalRef.current === principal) return;
    principalRef.current = principal;
    cache.current.clear();
    lastKey.current = null;
    loadingMore.current = false;
    setQuery("");
    setLoaded(emptyLoaded(principal, Boolean(principal && token)));
  }, [principal, token]);

  useEffect(() => {
    if (!token || !principal) return;
    const trimmed = query.trim();
    const key = filterKey(principal, trimmed);
    const isRefresh = lastKey.current === key;
    lastKey.current = key;
    let current = true;
    const cached = cache.current.get(key);
    if (cached && !isRefresh) {
      setLoaded((prev) => ({ ...prev, principal, items: cached.items, nextCursor: cached.nextCursor,
        loading: false, refreshing: true, error: null, offline: false, moreError: null }));
    } else if (!isRefresh) {
      setLoaded((prev) => ({ ...prev, principal, items: [], nextCursor: null,
        loading: true, refreshing: false, error: null, offline: false, moreError: null }));
    } else {
      setLoaded((prev) => ({ ...prev, principal, refreshing: true }));
    }
    const apply = (next: { items: LibraryRecord[]; nextCursor: string | null }) => {
      cache.current.set(key, next);
      if (!current) return;
      setLoaded((prev) => prev.principal === principal
        ? { ...prev, items: next.items, nextCursor: next.nextCursor, loading: false,
            refreshing: false, error: null, offline: false, moreError: null }
        : prev);
    };
    void api.library(token, { q: trimmed }).then((r) => {
      if (!current) return;
      const fresh = { items: r.items ?? [], nextCursor: r.nextCursor ?? null };
      if (isRefresh) {
        const previous = cache.current.get(key);
        apply({
          items: mergeLibraryItems(fresh.items, previous?.items ?? []),
          nextCursor: previous?.nextCursor ?? fresh.nextCursor,
        });
      } else {
        apply(fresh);
      }
    }).catch((error) => {
      if (!current || isSupersededRequest(error)) return;
      const offline = isOfflineError(error);
      setLoaded((prev) => prev.items.length > 0
        ? { ...prev, loading: false, refreshing: false }
        : { ...prev, loading: false, refreshing: false, offline,
            error: offline ? "You're offline." : "Could not load saved reports." });
    });
    return () => { current = false; };
  }, [principal, token, reloadKey, query, retryNonce]);

  const loadMore = () => {
    if (!token || !principal || !loaded.nextCursor || loadingMore.current) return;
    const trimmed = query.trim();
    const key = filterKey(principal, trimmed);
    if (lastKey.current !== key) return;
    const cursor = loaded.nextCursor;
    loadingMore.current = true;
    void api.library(token, { q: trimmed, cursor }).then((r) => {
      const previous = cache.current.get(key);
      const next = {
        items: mergeLibraryItems(previous?.items ?? loaded.items, r.items ?? []),
        nextCursor: r.nextCursor ?? null,
      };
      cache.current.set(key, next);
      setLoaded((prev) => prev.principal === principal && lastKey.current === key
        ? { ...prev, items: next.items, nextCursor: next.nextCursor, moreError: null, offline: false }
        : prev);
    }).catch((error) => {
      if (isSupersededRequest(error)) return;
      setLoaded((prev) => ({ ...prev, moreError: isOfflineError(error) ? "You're offline." : "Could not load more saved reports." }));
    }).finally(() => { loadingMore.current = false; });
  };

  if (!token || !principal) {
    return (
      <Text style={styles.bodyText} accessibilityLabel="Saved reports">
        Sign in from Profile to see saved reports.
      </Text>
    );
  }
  if (loaded.principal !== principal || (loaded.loading && loaded.items.length === 0)) {
    return (
      <Text style={styles.bodyText} accessibilityLabel="Saved reports">
        Loading saved reports…
      </Text>
    );
  }
  if (loaded.error && loaded.items.length === 0) {
    return (
      <View style={styles.body}>
        <Text style={styles.bodyText} accessibilityLabel="Saved reports">
          {loaded.error}
        </Text>
        <Pressable onPress={() => setRetryNonce((n) => n + 1)} accessibilityRole="button" accessibilityLabel="Retry loading saved reports" hitSlop={8}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      style={styles.body}
      accessibilityLabel="Saved reports"
      data={loaded.items}
      keyExtractor={(it) => it.id}
      initialNumToRender={12}
      windowSize={8}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search saved reports"
          placeholderTextColor={ink}
          accessibilityLabel="Search saved reports"
          allowFontScaling
          maxFontSizeMultiplier={2}
          style={styles.librarySearch}
        />
      }
      ListEmptyComponent={
        <Text style={styles.bodyText}>
          {query.trim() ? "No matching reports." : "No reports yet."}
        </Text>
      }
      ListFooterComponent={
        loaded.moreError ? (
          <View style={styles.libraryRow}>
            <Text style={styles.bodyText}>{loaded.moreError}</Text>
            <Pressable onPress={loadMore} accessibilityRole="button" accessibilityLabel="Retry loading more saved reports" hitSlop={8}>
              <Text style={styles.link}>Retry</Text>
            </Pressable>
          </View>
        ) : null
      }
      renderItem={({ item: it }) => {
        const copy = libraryItemCopy(it);
        const meta = [copy.sources, copy.updated].filter(Boolean).join(" · ");
        return (
          <View style={styles.libraryRow}>
            <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => onOpen(it.id)} accessibilityRole="button" accessibilityLabel={`Open ${copy.title}`}>
              <Text style={styles.title} numberOfLines={2}>{breakLongTokens(copy.title)}</Text>
              {copy.preview ? <Text style={styles.libraryPreview ?? styles.kicker} numberOfLines={1}>{copy.preview}</Text> : null}
              <Text style={styles.libraryMeta ?? styles.libraryPreview ?? styles.kicker}>
                {copy.status}{meta ? ` · ${meta}` : ""}
              </Text>
            </Pressable>
            {it.report_id ? (
              <Pressable onPress={() => onShare(it.report_id!)} accessibilityRole="button" accessibilityLabel={`Share ${copy.title}`} hitSlop={12} style={{ minWidth: 44, minHeight: 56, justifyContent: "center", alignItems: "center" }}>
                <ShareIcon color={ink} />
              </Pressable>
            ) : null}
          </View>
        );
      }}
    />
  );
}
