# Native APK install — 2026-09-20

Product SHA `75dee72a1ba77717262a0ca683a6b5a52c965d97` (implementation). Docs HEAD at build time `9ae92feb379d1b28ef9715b6a8e8b95e0f97f17e`. Diff 75dee72..9ae92fe is STATUS/HANDOFF/CLOSURE_LEDGER only.

- EAS `16412bce-2bb5-4ca1-8f0f-1dd771779757` profile `device` FINISHED
- git `9ae92fe`
- package `app.deepresearch.mobile` versionName `0.1.0` versionCode `1`
- APK sha256 `c888095a21e838ef8c4596b9b7b2533b2b797f34e2f8f87b95a6144933fbad6b`
- `adb -s 10.0.0.167:41299 install -r` Success (kunzite / 25098RA98G)
- Wireless debugging port is `41299`; historical `43417` still refused
- Recapture after owner confirmed there is no lock password: `wm dismiss-keyguard` succeeded (`mDreamingLockscreen=false`). Deep home focused.

Captures on this installed APK (not later uncommitted product code):

| File | What it shows |
|---|---|
| `01-empty-dark.png` | Empty home, dark, “Ask anything.” |
| `02-typing-gboard.png` | Composer + Gboard, send arrow visible |
| `03-in-progress.png` | Fixture run in progress, Stop control |
| `04-library.png` | Library list with queued/failed/ready rows |
| `05-settings.png` | Settings Account / Appearance / Research |
| `06-settings-privacy.png` | Privacy deletion, Help, About 0.1.0 |

This APK cannot validate later constraint-delta, mixed-field continue, section-purpose, or journal repairs. No new EAS build was authorized. Fixture worker on `127.0.0.1:8788` left the employment-tax run queued; that is not a product-SHA proof of Continue→report.
