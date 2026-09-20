# Native visual capture — SHA b3e3a82

- Device: `10.0.0.167:43417` kunzite_global 25098RA98G
- EAS: `87798886-8bae-403a-afac-e604de0a5050` profile `device` FINISHED
- APK sha256: `d73a6800e56f38c8e79dcd3d05587265364833e709a4ff035c432c3ec1e4cc30`
- Install: `adb -s 10.0.0.167:43417 install -r` Success 2026-09-19 21:21:52
- Fixture API: `adb reverse tcp:8787 tcp:8788` → `127.0.0.1:8788` (`deep_v8_device`, diagnostic worker)
- Run: `bf7eec36-6e5e-48fb-bc7e-1f96f7714e7b` fixture `completed_with_limitations`

Historical APKs `435d1bf` / `487e08f` / `8266c91` are not this SHA.

## Compared to Grok / Perplexity / DeepSeek (no logos/colors copied)

| Shot | File | Verdict |
|---|---|---|
| keyboard/IME | 01-keyboard-ime.png | Composer sits above Gboard suggestion strip; 36px send fully visible. Compact dock. |
| active research | 02-active-research.png | Pulse + stop morph + assumptions card. Card dumped several assumption paragraphs (planner-heavy). |
| completed report | 03-completed-report.png | Answer-first, compact `[1]`, follow-up composer. TOC of 5 short labels looks like a settings list on a short fixture report. Dual `›` + chevron. |
| expanded activity | 04-expanded-activity.png | Real phase groups. Duplicate “Understood the question”. No source pills on this fixture. |
| evidence sheet | 05-source-sheet.png | Quote-first; freshness unknown is not current; Technical details collapsed. Consumer-first. |
| Library | 07-library.png | Paper search field. Meta line ALL CAPS (`READY, WITH LIMITS`) because it used `kicker`. Titles keep newlines. |
| Library search | 08-library-search.png | Filter `laptop` works. |
| Settings | 09-settings.png | Grouped Appearance / Privacy / Library. Native-feeling, not a card stack. |
| empty dark | 15-empty-dark.png | Warm dark paper; compact composer; examples. |
| completed dark | 12-completed-dark.png | Dark parity of report + composer. |
| plus sheet | 13-plus-sheet-dark.png | Files / URL / source preferences behind +. |
| follow-up | 14-follow-up-dark.png | “Ask a follow-up…” typing; send activates; IME-safe. |
| large text 1.5 | 16-large-text-empty-dark.png | Composer stays compact; hero scales. Restored font_scale 1.0. |

## Defects fixed after this capture (not in this APK)

- Library meta sentence case (`libraryMeta`)
- Collapse title whitespace
- Display collapsed trace without a text `›` when the chevron icon is present
- Collapse consecutive identical activity labels
- TOC only on actually long reports
- Compact early assumptions (2-line ellipsis)
- Delete-source as quiet link

## Not on this APK

Clarification/query-permission live screens (no awaiting_input run in this fixture DB). iOS not available. Reduce Motion uses system AccessibilityInfo (no in-app toggle).

`21_UI_DEFINITION_OF_DONE.md` is **not** closed on this SHA.
