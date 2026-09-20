# Phase B UI dependency decisions

Evaluated against kit `19_UI_TECHNOLOGY_RADAR.md` at first Phase B SHA `7deed7a`. **No new package added** in the map/composer/trace copy commit.

| Candidate | Decision | Why |
|---|---|---|
| Reanimated 4 | Defer | Existing `Animated` + `@deep/design` motion tokens already pulse/morph send. Adding Reanimated needs Expo 54 / RN 0.81 native validation on device before it can be a Phase B requirement. |
| Gesture Handler | Defer | Current sheets are in-tree `View` overlays. Gorhom/RNGH needs New Architecture proof. |
| FlashList v2 | Defer | Library and reports are not multi-thousand-row at this SHA. `ScrollView` / existing list is enough until a long live report is measured. |
| keyboard-controller | Defer | `use-keyboard-inset.ts` already exists; native IME overlap is an APK proof item, not a new library by itself. |
| Lucide RN | Defer | `apps/mobile/src/icons.tsx` already ships plus/send/stop without `@expo/vector-icons`. |
| Expo Haptics | Defer until native loop | `productHaptic` exists; swapping to `expo-haptics` requires Android install proof. |
| Expo Blur | Reject for now | Android fallback would still look like a kit blur; keep paper/ink surfaces. |
| Skia / charts / Rive / Lottie / huge UI kits | Reject | No verified structured chart surface; no custom authored animation; would look generic. |

Existing stack to keep: Expo 54, RN 0.81.4, React 19.1, `react-native-safe-area-context`, `expo-document-picker`, `expo-file-system`, `expo-secure-store`, `expo-crypto`, AsyncStorage, workspace `@deep/design` + `@deep/contracts`.
