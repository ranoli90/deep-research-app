import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { BackIcon, MenuIcon, PencilIcon } from "./icons";
import { headerInitials } from "./product-styles";

type Styles = {
  header: StyleProp<ViewStyle>;
  headerSide: StyleProp<ViewStyle>;
  headerSideEnd: StyleProp<ViewStyle>;
  headerIconHit: StyleProp<ViewStyle>;
  wordmark: StyleProp<TextStyle>;
  headerAvatar: StyleProp<ViewStyle>;
  headerAvatarText: StyleProp<TextStyle>;
};

export function ResearchHeader({
  tab,
  title,
  ink,
  accountId,
  signedIn,
  onLibrary,
  onDone,
  onNewResearch,
  onSettings,
  styles,
}: {
  tab: "research" | "library" | "settings";
  title: string;
  ink: string;
  accountId: string | null;
  signedIn: boolean;
  onLibrary: () => void;
  onDone: () => void;
  onNewResearch: () => void;
  onSettings: () => void;
  styles: Styles;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {tab === "research" ? (
          <Pressable
            onPress={onLibrary}
            accessibilityRole="button"
            accessibilityLabel="Library"
            hitSlop={12}
            style={styles.headerIconHit}
          >
            <MenuIcon color={ink} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Done"
            hitSlop={12}
            style={styles.headerIconHit}
          >
            <BackIcon color={ink} />
          </Pressable>
        )}
      </View>
      <Text
        style={styles.wordmark}
        accessibilityRole="header"
        numberOfLines={1}
        ellipsizeMode="tail"
        allowFontScaling
        maxFontSizeMultiplier={2}
      >
        {title}
      </Text>
      <View style={[styles.headerSide, styles.headerSideEnd]}>
        {tab === "research" || tab === "library" ? (
          <Pressable onPress={onNewResearch} accessibilityRole="button" accessibilityLabel="New research" hitSlop={16} style={styles.headerIconHit}>
            <PencilIcon color={ink} />
          </Pressable>
        ) : null}
        {tab === "research" ? (
          <Pressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel="Open profile and settings"
            hitSlop={12}
            style={styles.headerIconHit}
          >
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>{headerInitials(accountId, signedIn)}</Text>
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
