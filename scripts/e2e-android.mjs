#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const adb = process.env.ANDROID_HOME
  ? `${process.env.ANDROID_HOME}/platform-tools/adb`
  : "adb";
const devices = spawnSync(adb, ["devices"], { encoding: "utf8" });
const lines = (devices.stdout ?? "").split("\n").filter((l) => /\tdevice$/.test(l));
if (lines.length === 0) {
  process.stderr.write(
    "P0-N Android launcher unavailable: Android SDK is present but no emulator/device is online. Structural native source + unit lifecycle tests remain.\n",
  );
  process.exit(2);
}
process.stdout.write(`android devices:\n${devices.stdout}\n`);
process.stdout.write("Install/run the Expo app with pnpm --filter @deep/mobile android when a device is online.\n");
