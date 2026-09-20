# Deep visual identity (original)

Not a Grok / ChatGPT / Perplexity / DeepSeek clone. With the wordmark hidden, the screens should still read as this product: warm paper, editorial type, a docked composer, a research rail, and compact numeric evidence marks.

## Competitor reference (principles, not copies)

Captured from current public product surfaces (empty/composer, active research, report, sources, history). We did not restyle Deep to match any of them.

| Surface | Grok | ChatGPT | Perplexity | DeepSeek | Ours |
|---|---|---|---|---|---|
| Empty | Vast black canvas, tiny prompt | Centered display type + suggestion chips | Search-bar-as-hero | Black pill, huge greeting | Restrained 18px prompt, stacked example lines, composer is the only chrome |
| Composer | Floating black pill, circular send | Large white pill, green circle send | Rounded search field | Black capsule | Hairline **dock** (not a floating pill), 24px radius field, 52pt visual height, 36px rounded-square send inside a 44px invisible hit |
| Activity | Collapsible “thinking” prose | Step list / tool theater | Favicon source strip | Auto-collapsing CoT | Left **event rail** of real public events; pulse on the current tick only |
| Report | Chat bubbles | Markdown article + TOC | Numbered citation pills | Clean tables, sparse chrome | Uncarded editorial hierarchy; answer first; tappable outline; compact `[n]` marks |
| Evidence | Inline sources | Footnote popover | Side citations | Light footnotes | Quote-first sheet with labeled Source / Quote / Claim / Freshness / Independence |
| History | Conversation list | Chat list | Thread library | Chat list | Title + status/date row; share is a quiet control, not a third heading |

Density: competitors sit around 15–17px body with 44–48px circular controls. Ours is 16/24 body, 18/24 titles, caption 13/18, **no circular product controls**.

## Type
- `display` 20/26/600, tracking −0.4 — **answer peak only**, never empty-state hero
- `title` 18/24/600, tracking −0.25 — section heads, library titles
- `body` 16/24/400, tracking −0.1 — reading
- `caption` 13/18/500 — metadata, outline, examples
- `meta` 12/16/500, tracking 0.2 — elapsed, kicker labels
- Android: `includeFontPadding: false` on product text
- Dynamic Type: `allowFontScaling` + `maxFontSizeMultiplier={2}`
- Quotes: italic body, 2px accent rule
- Tables: caption heads, hairline rows, horizontal scroll
- Citations: tabular `[n]`, not UUID chips

## Iconography
One optical-weight family in `apps/mobile/src/icons.tsx` (1.5px stroke, 2px on 18px+).
- Outline at rest; fill only for the active send square and the current activity tick
- No Unicode `+` / `↑` / `■` / `☰` as product chrome
- No `@expo/vector-icons`
- Compose (new research): rounded square + inner plus — not a rotated rectangle
- Send: up-chevron in a 36×36 rounded square (44px invisible hit)
- Stop: 12px rounded square inside the same 36 send morph
- Close / back / menu / share: same stroke

## Surfaces
- Canvas: `#F6F3EE` / `#161412` (paper / ink)
- Composer: docked field, hairline, **no elevation**, radius 24, resting height 52, max 4 lines
- Activity: transparent; rail is the structure
- Report: uncarded
- Evidence sheet: paper panel, 16 radius, grab handle, labeled fields
- Settings/Library: hairline sections, not rounded account cards
- Avoid carding every block; clarification is the only contained card

## Motion grammar
| Name | Use | Reduced motion |
|---|---|---|
| `researchPulse` | Current-tick opacity 0.28↔1, 900ms | Solid tick |
| `sendMorph` | Send square spring-scales to stop | Instant swap |
| `activityRail` | Ticks appear with events (180ms) | Static rail |
| `traceCollapse` | Expand/collapse 250ms | Instant |
| `sheetRise` | Evidence sheet 24→0 translateY + fade, 340ms | Instant |
| `reportSettle` | Answer opacity 0→1 on first publish, 200ms | Instant |
| `correctionFlash` | Caveat ink only (no theater) | Instant |

Durations: `motion.press` 110, `fast` 140, `row` 180, `appear` 200, `base` 220, `collapse` 250, `sheet` 340, `slow` 360, `pulse` 900.

## Haptics (enhancement only)
Android/iOS `Vibration` via `productHaptic`:
- send: 8ms
- stop: 16ms
- complete: 18ms
- warn (delete confirm): 32ms
Never required to understand state.

## Evidence signature
Compact numeric mark `[n]` (11px, hairline, no pill fill). 44px **invisible** hit. Opens the quote-first sheet. Not a Perplexity favicon chip and not a 32px teal pill.

## Research signature
A vertical **event rail** of real public activity ticks. The live tick pulses. Expansion is the same rail, not a debug log of hairline cards. Source domains during search are caption text from `source_reading` only — never invented favicons.
