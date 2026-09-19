# Native visual QA — APK 435d1bf / EAS ea81c118

Captured 2026-09-19 on physical Android `10.0.0.167:43417` (kunzite_global / 25098RA98G).
Package `app.deepresearch.mobile`. Install `adb install -r` 2026-09-19 16:47:32, no data wipe.
EAS: `ea81c118-f9d3-4eee-adb0-15b7b40b0136` profile `device`.
Product git: `435d1bf588847f1c6b887e1b43d3eb29a8c8ccc3` (**not** later `487e08f`).
APK sha256: `42801ff6c63a74f3f7e900246e1bf7b6e61aaad4d9e7312a1c16677c488c4896`
Fixture API via `adb reverse tcp:8787 tcp:8788` to host `127.0.0.1:8788`.
font_scale restored to 1.0 after large-text. Reverse restored after offline shot.

This matrix is **device evidence for 435d1bf only**. It does not prove HEAD `487e08f` (direct-URL worker change; backend-only).

## Matrix

| Shot | File | Honest verdict |
|---|---|---|
| empty light | empty-light.png | Docked hairline composer (not a pill), caption “Ask anything.”, stacked examples, plus + send square. Not giant display type. |
| empty dark | empty-dark.png | Warm dark paper; same chrome. |
| keyboard | keyboard.png | Composer sits above Gboard; send square visible. IME suggestion bar did **not** cover send in this capture (Gboard layout that day). Not a proof that FP-085 is closed on every IME. |
| Library | library.png | Hairline rows + search. Status/meta rendered **ALL CAPS** because `kicker` used `textTransform: uppercase` (uncommitted fieldLabel split was later preserved as a patch, not in this APK). |
| Library search | library-search.png | Filter `employment` works. |
| Settings | settings.png | Flattened account (no card); system Switch remains. Valid Settings shot. |
| completed report | completed-report.png | Editorial sections, vertical outline, compact `[1]` marks, docked composer. Fixture still leaks `geography=texas` and “Sample”. |
| source sheet | source-sheet.png | Labeled Source/Quote/Claim/Relationship/Freshness/Independence; quote-first; Technical details collapsed; close X. Valid. |
| expanded activity | expanded-activity.png | Event rail of real public labels (Searching / Reading / Writing). Valid. |
| active research | active-research.png | Pulse + elapsed + stop square. Assumptions card still bulky during fixture progress. |
| correction | correction.png | **Mis-shot:** same completed Texas report as expanded-activity, not a correction composer/submit. Do not treat as correction PASS. |
| clarification | clarification.png | **Mis-shot:** Library search result, not the awaiting_input jurisdiction screen. Do not treat as clarification PASS on this APK. |
| large text | large-text.png / large-text-empty.png | font_scale 1.5; composer stays compact. Restored 1.0. |
| offline/error | offline-error.png | Valid after reverse removed on both adb transports: “You're offline. Retry”; draft `offline_now_v8l` kept. |

## Ruthless review

Empty/composer/report/source sheet/activity rail are a real identity pass versus the earlier pill/card prototype **on this APK**. Remaining device defects: Library shouty uppercase meta, bulky assumptions card, fixture Sample/`geography=texas` leak, missing true clarification/correction shots, no iOS, no long-report jank measurement on this APK.

Research Beta is **not** declared from these screenshots.
