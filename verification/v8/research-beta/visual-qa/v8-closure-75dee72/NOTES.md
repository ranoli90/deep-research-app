# Native APK install — 2026-09-20

Product SHA `75dee72a1ba77717262a0ca683a6b5a52c965d97` (implementation). Docs HEAD at build time `9ae92feb379d1b28ef9715b6a8e8b95e0f97f17e`. Diff 75dee72..9ae92fe is STATUS/HANDOFF/CLOSURE_LEDGER only.

- EAS `16412bce-2bb5-4ca1-8f0f-1dd771779757` profile `device` FINISHED
- git `9ae92fe`
- package `app.deepresearch.mobile` versionName `0.1.0` versionCode `1`
- APK sha256 `c888095a21e838ef8c4596b9b7b2533b2b797f34e2f8f87b95a6144933fbad6b`
- `adb -s 10.0.0.167:41299 install -r` Success (kunzite / 25098RA98G)
- Wireless debugging port is `41299`; historical `43417` still refused
- Screen was off/locked after install. Unlock is required for empty→research→report captures. Lockscreen was not bypassed and is not stored.

Backend for device journeys: `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787` plus `adb reverse`. Not exercised in this receipt.
