import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { api, isSupersededRequest } from "./api";
import { breakLongTokens } from "./report-layout";
import { libraryItemCopy, type LibraryRecord } from "./library-copy";

type Styles = {
  body: StyleProp<ViewStyle>;
  card: StyleProp<ViewStyle>;
  title: StyleProp<TextStyle>;
  kicker: StyleProp<TextStyle>;
  link: StyleProp<TextStyle>;
  bodyText: StyleProp<TextStyle>;
};

export function LibraryList({
  token,
  styles,
  onOpen,
  onShare,
}: {
  token: string | null;
  styles: Styles;
  onOpen: (id: string) => void;
  onShare: (reportId: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ token: string | null; items: LibraryRecord[]; error: string | null }>({
    token: null, items: [], error: null,
  });
  const items = loaded.token === token ? loaded.items : [];
  useEffect(() => {
    if (!token) return;
    let current = true;
    void api.library(token).then((r) => {
      if (current) setLoaded((previous) => current ? { token, items: r.items ?? [], error: null } : previous);
    }).catch((error) => {
      if (current && !isSupersededRequest(error)) {
        setLoaded({ token, items: [], error: "Could not load saved reports. Reopen Library to retry." });
      }
    });
    return () => { current = false; };
  }, [token]);
  if (!token) {
    return (
      <Text style={styles.bodyText} accessibilityLabel="Saved reports">
        Sign in from Profile to see saved reports.
      </Text>
    );
  }
  if (items.length === 0) {
    return (
      <Text style={styles.bodyText} accessibilityLabel="Saved reports">
        {loaded.token !== token ? "Loading saved reports…" : loaded.error ?? "No reports yet."}
      </Text>
    );
  }
  return (
    <ScrollView style={styles.body} accessibilityLabel="Saved reports">
      {items.map((it) => {
        const copy = libraryItemCopy(it);
        return (
          <View key={it.id} style={styles.card}>
            <Pressable onPress={() => onOpen(it.id)} accessibilityRole="button" accessibilityLabel={`Open ${copy.title}`}>
              <Text style={styles.title}>{breakLongTokens(copy.title)}</Text>
              <Text style={styles.kicker}>{copy.status}{copy.version ? ` · ${copy.version}` : ""}</Text>
              {copy.updated ? <Text style={styles.kicker}>Updated {copy.updated}</Text> : null}
            </Pressable>
            {it.report_id ? (
              <Pressable onPress={() => onShare(it.report_id!)} accessibilityRole="button" accessibilityLabel={`Share ${copy.title}`}>
                <Text style={styles.link}>Share Markdown</Text>
              </Pressable>
            ) : (
              <Text style={styles.kicker}>Resume from Library when you are ready.</Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
