# Native visual capture — SHA 45ccf87

- Device: `10.0.0.167:43417` kunzite_global 25098RA98G
- EAS: `e84cccbb-02e0-4386-b125-733c303a04c1` profile `device` FINISHED
- gitCommitHash: `45ccf874e280532a592898d9db9fa1066ffe8a67`
- APK sha256: `baf4f06ad0a3328b1ae7190db2a4b39e038c5e6c1778fcd057ff8020036c9cb5`
- Install: `adb -s 10.0.0.167:43417 install -r` Success
- Fixture API: `adb reverse tcp:8787 tcp:8788` → `127.0.0.1:8788`

Historical APKs `435d1bf` / `487e08f` / `8266c91` / `b3e3a82` are not this SHA.

## Compared to Grok / Perplexity / DeepSeek (no logos/colors copied)

| Shot | File | Verdict |
|---|---|---|
| clarification | 01-clarification-dark.png | Composer hidden. No stale elapsed clock. Card is compact. Prompt is generic (“This detail would change…”) because App passes `clarificationSummary: undefined`; backend event is “Which jurisdiction…”. |
| Library | 02-library-dark.png | Paper search. Sentence-case meta (`Ready, with limits`). Titles collapse newlines. Not shouty caps. |
| completed report | 03-completed-report-dark.png | Answer-first, compact `[1]`, follow-up composer. Collapsed trace has chevron only (no text `›`). TOC still listed 5 short sections (8 blocks / 1070 chars passed the 8/900 gate). |
| expanded activity | 04-expanded-activity-dark.png | Phase groups; consecutive identical “Understood the question” collapsed. Two searches with a read between stay. |
| evidence sheet | 05-source-sheet-dark.png | Quote-first; unknown date not current; Technical details collapsed; Delete is quiet. |
| Settings | 06-settings-light.png | Grouped sections, appearance segment, 56pt rows. |
| empty light | 07-empty-light.png | Compact dock, “Ask anything.”, examples, no tabs. |
| keyboard/IME | 08-keyboard-ime.png | Composer above Gboard suggestion strip; send fully visible. |

## Follow-up in tree after this APK

Raise TOC gate to 1800 chars / 12 blocks so this fixture report stays answer-first.

`21_UI_DEFINITION_OF_DONE.md` is not closed on this SHA (short-report TOC, generic clarification prompt). iOS not available. No competitor-superiority claim.
