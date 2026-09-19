# Native visual QA — APK 1021057 / EAS 5f4cd0e7

Device: `10.0.0.167:43417` (kunzite_global / 25098RA98G), package `app.deepresearch.mobile`.
EAS: `5f4cd0e7-6f12-4461-80a7-968946f28690` profile `device`.
APK sha256: `a3adc4deb7f0d29999f895404b08b7ae04230b5569f72779a6711501604ed1b2`
Install: `adb install -r` 2026-09-19 11:46:18 (no data wipe).
Product git: `1021057e049e913ab2b1b084a2ac6eccad573607`.
font_scale restored to `1.0`. adb reverse `tcp:8787` → host `8788` restored after offline capture.
Fixture API `127.0.0.1:8788` was stopped for the offline shot and restarted.

Keyboard: window resizes (composer bounds move from ~2228 to ~1466), but the IME suggestion bar still covers the send control. Same class of overlap as the prior 2eb385b keyboard capture.
