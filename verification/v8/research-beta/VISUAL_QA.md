# Native visual QA — freeze SHA 95432e9 / EAS a7e10417 built, adb dropped

Product SHA `95432e9`. EAS `a7e10417` APK sha256 `af2bba0e8c41a431b45e593edd20ca0b284c0cfe1d2dca3d3dbbc110002caaa8` **built**. `adb install` failed: wireless debugging on `10.0.0.167:43417` dropped (host pingable, TCP refused). Last on-device recapture is **ae395ef** TOC (`v8-phase-b-ae395ef/01-completed-report.png`) plus **45ccf87** IME/library/sheet.

## APK 45ccf87 / EAS e84cccbb (prior successful install)

# Native visual QA — APK 45ccf87 / EAS e84cccbb

Device: `10.0.0.167:43417` (kunzite_global / 25098RA98G), package `app.deepresearch.mobile`.
EAS: `e84cccbb-02e0-4386-b125-733c303a04c1` profile `device` git `45ccf874e280532a592898d9db9fa1066ffe8a67`.
APK sha256: `baf4f06ad0a3328b1ae7190db2a4b39e038c5e6c1778fcd057ff8020036c9cb5`
Install: `adb install -r` Success. Shots: `verification/v8/research-beta/visual-qa/v8-phase-b-45ccf87/`.
font_scale restored to `1.0`. adb reverse `tcp:8787` → `8788`.

HEAD `ae395ef` (TOC 1800/12) is **not** this APK. Historical `435d1bf` / `1021057` / `b3e3a82` are not this SHA.

## Matrix

| Shot | File | Verdict |
|---|---|---|
| empty light | v8-phase-b-45ccf87/07-empty-light.png | Compact composer, “Ask anything.”, examples. Not giant display type. |
| keyboard | v8-phase-b-45ccf87/08-keyboard-ime.png | Composer above Gboard suggestion strip; send fully visible. |
| Library | v8-phase-b-45ccf87/02-library-dark.png | Paper field; sentence-case meta; newline titles collapsed. |
| Settings | v8-phase-b-45ccf87/06-settings-light.png | Grouped Appearance/Privacy; native-feeling. |
| clarification | v8-phase-b-45ccf87/01-clarification-dark.png | Composer hidden; no stale elapsed. Generic prompt (not jurisdiction). |
| expanded activity | v8-phase-b-45ccf87/04-expanded-activity-dark.png | Real phases; duplicate understood-the-question collapsed. |
| completed report | v8-phase-b-45ccf87/03-completed-report-dark.png | Answer-first; `[1]`; chevron-only collapse. TOC still present on this 8-block fixture report. |
| source sheet | v8-phase-b-45ccf87/05-source-sheet-dark.png | Quote first; unknown date not current; Technical details collapsed. |
| offline | v8-phase-b-b3e3a82/17-offline-dark.png | “You're offline. Retry”; draft kept (same copy on 45ccf87). |

## Ruthless review

Does **not** look like a default React Native prototype. Remaining: short-report TOC (fixed in `ae395ef`, not this APK), generic clarification prompt, fixture Sample labels, iOS.

Research Beta is not declared. No competitor-superiority claim.

## Prior APK 1021057 / EAS 5f4cd0e7 (not HEAD)

# Native visual QA — APK 1021057 / EAS 5f4cd0e7

Device: `10.0.0.167:43417` (kunzite_global / 25098RA98G), package `app.deepresearch.mobile`.
EAS: `5f4cd0e7-6f12-4461-80a7-968946f28690` profile `device` git `1021057e049e913ab2b1b084a2ac6eccad573607`.
APK sha256: `a3adc4deb7f0d29999f895404b08b7ae04230b5569f72779a6711501604ed1b2`
Install: `adb install -r` 2026-09-19 11:46:18 (no unrelated data wipe).
Shots: `verification/v8/research-beta/visual-qa/v8k/`.
font_scale restored to `1.0`. adb reverse `tcp:8787` → `8788` restored.

## Matrix

| Shot | File | Verdict |
|---|---|---|
| empty light | v8k/empty-light.png | Compact composer, “Ask anything.”, example chips, + / send icons. Not giant display type. |
| empty dark | v8k/empty-dark.png | Near-black field, raised composer, readable header icons. |
| keyboard | v8k/keyboard.png | Layout resizes; IME suggestion bar still covers the send control. |
| Library | v8k/library.png | Hairline rows, search, quiet Share. Search field is still a plain TextInput. |
| Settings | v8k/settings.png | Segmented appearance; processor dump collapsed; system Switch remains. |
| clarification | v8k/clarification.png | Composer hidden. Jurisdiction field + Continue research. Compact card. |
| expanded activity | v8k/expanded-activity.png | Real events: Updating from your correction / Searching / Reading / Checking a conflicting claim / Writing. |
| completed report | v8k/completed-report.png | Editorial sections, TOC, table, citation chips. Fixture copy still says Sample / geography=texas. |
| source sheet | v8k/source-sheet.png | Quote first; freshness unknown not treated as current; Challenge/Verify; Technical details collapsed. |
| correction | v8k/correction.png | Same 2026-figures correction timeline as expanded activity. |
| active research | v8k/active-research.png | Stop square in composer; assumptions card still shown during fixture progress. |
| large text | v8k/large-text.png | font_scale 1.5; Library rows wrap; composer stays compact. Restored to 1.0. |
| offline/error | v8k/offline-error.png | “You're offline. Retry”; draft `offline_retry` kept. |

## Ruthless review

Does **not** look like a default 44px-circle React Native prototype. Empty home, composer, report, source sheet, and activity timeline are first-party enough for this APK.

Remaining nits (not a reason to discard this capture):

- IME suggestion bar covers the send control while the keyboard is up.
- Library search is still an unadorned TextInput.
- Settings uses a system Switch.
- Fixture reports still say “Sample” and can leak `geography=texas`.
- Active-research still shows an assumptions card.

Visual identity is **device-reviewed on APK 1021057**. Research Beta is not declared (`main` not merged).
