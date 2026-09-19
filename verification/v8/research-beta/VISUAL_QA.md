# Native visual QA — APK 2eb385b / EAS 7e4b02c8

Device: `10.0.0.167:43417` (kunzite_global / 25098RA98G), package `app.deepresearch.mobile`.
APK sha256: `6ded85d00989a33bc89aeb186261f4d715b7f62de71aaa6781141b3d141df9cb`
Install: `adb install -r` 2026-09-19 03:48:27 (no data wipe).
Product git: `2eb385b871fc0465a0b4a3cfe7d0cd7705f9a7a5`.
font_scale restored to `1.0` after the large-text capture.
adb reverse `tcp:8787` → host `8788` restored after the offline capture.

## Matrix

| Shot | File | Verdict |
|---|---|---|
| empty light | empty-light.png | Compact composer, “Ask anything.”, example chips. Not giant display type. |
| empty dark | empty-dark.png | Warm raised composer on near-black. Header icons remain readable. |
| keyboard | keyboard.png | Composer sits on the keyboard; “Ask anything.” is not covered. |
| Library | library.png | Theme hairlines; quiet Share; search field usable. |
| Settings | settings.png | Segmented appearance; processor dump collapsed. System Switch remains. |
| clarification | clarification.png | Composer hidden. Field “Jurisdiction or place”. Compact card. |
| expanded activity | expanded-activity.png | Real events: Starting / Searching / Reading / Checking a conflicting claim / Writing. Not fabricated. |
| completed report | completed-report.png | Editorial sections + table + citation chips. Fixture copy is still fixture. |
| source sheet | source-sheet.png | Quote first, freshness/independence, Challenge/Verify, Technical details collapsed. Cited in ellipsizes. |
| correction | correction.png | “Updating from your correction” + stop; assumptions only (no planner desiredOutcome dump). |
| active research | active-research.png | Writing-the-answer trail with stop square during the 2026-figures correction. |
| large text | large-text.png | font_scale 1.5; Library rows wrap; composer stays compact. Restored to 1.0. |
| offline/error | offline-error.png | “You're offline. Retry”; draft `offline_retry` kept. |

## Ruthless review

Does **not** look like a default 44px-circle React Native prototype. Composer, empty home, activity, report, and source sheet are original enough for this APK.

Remaining product-quality nits (not a reason to rebuild this APK before the two external gates):

- Library search is still an unadorned TextInput.
- Settings uses a system Switch.
- Active/correction `ResearchBriefCard` still shows an assumptions card.
- Fixture reports still say “Sample” and can leak `geography=texas` in the body.

Visual identity is **device-reviewed on this APK**. It is **not** Research Beta. Live J1–J12 and hosted `verification.yml` remain blocked.
