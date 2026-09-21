import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const script = resolve(__dirname, "../scripts/build-eas-device.mjs");
const providerKey = ["OPEN", "ROUTER", "API", "KEY"].join("_");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

type AppConfig = { expo: { owner: string; android: { package: string } } };
type EasConfig = { build: { device: { env: { EXPO_PUBLIC_API_URL: string }; android: { buildType: string } } } };

type ReceiptFault = "write-zero" | "partial-write" | "file-fsync" | "directory-fsync";
function probe(overrides: Record<string, string | undefined>, args: string[] = [], mutate?: (app: AppConfig, eas: EasConfig) => void, fakeExit = 0, fault?: ReceiptFault) {
  const dir = mkdtempSync(join(tmpdir(), "deep-eas-device-"));
  dirs.push(dir);
  let scriptPath = script;
  if (mutate) {
    const mobile = join(dir, "repo", "apps", "mobile");
    mkdirSync(join(mobile, "scripts"), { recursive: true });
    copyFileSync(script, join(mobile, "scripts", "build-eas-device.mjs"));
    const app = JSON.parse(readFileSync(resolve(__dirname, "../app.json"), "utf8")) as AppConfig;
    const eas = JSON.parse(readFileSync(resolve(__dirname, "../eas.json"), "utf8")) as EasConfig;
    mutate(app, eas);
    writeFileSync(join(mobile, "app.json"), JSON.stringify(app));
    writeFileSync(join(mobile, "eas.json"), JSON.stringify(eas));
    scriptPath = join(mobile, "scripts", "build-eas-device.mjs");
  }
  const marker = join(dir, "invoked.json");
  const receiptDir = join(dir, "receipts");
  mkdirSync(receiptDir);
  const cli = join(dir, "eas");
  writeFileSync(cli, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),api:process.env.EXPO_PUBLIC_API_URL??null,provider:process.env[${JSON.stringify(providerKey)}]??null}));process.stdout.write(process.env.EXPO_TOKEN);process.exit(${fakeExit});\n`);
  chmodSync(cli, 0o700);
  const env: NodeJS.ProcessEnv = { ...process.env,
    EXPO_TOKEN: "test-only-token",
    DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD: "10.00",
    DEEP_EAS_DEVICE_APPROVAL_ID: "owner-build-20260921",
    DEEP_EAS_DEVICE_RECEIPT_DIR: receiptDir,
    DEEP_EAS_CLI_BIN: cli,
    EXPO_PUBLIC_API_URL: "https://example.invalid",
  };
  env[providerKey] = "test-only-provider-secret";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]; else env[key] = value;
  }
  if (fault) {
    const hook = join(dir, "receipt-fault.cjs");
    writeFileSync(hook, `const fs=require("node:fs");const {syncBuiltinESMExports}=require("node:module");const originalWrite=fs.writeSync;const originalSync=fs.fsyncSync;let syncCount=0;if(${JSON.stringify(fault)}==="write-zero")fs.writeSync=()=>0;if(${JSON.stringify(fault)}==="partial-write")fs.writeSync=(fd,buffer,offset,length,position)=>originalWrite(fd,buffer,offset,Math.min(length,1),position);if(${JSON.stringify(fault)}.endsWith("fsync"))fs.fsyncSync=(fd)=>{syncCount++;if(syncCount===(${JSON.stringify(fault)}==="file-fsync"?1:2))throw Error("injected fsync failure");return originalSync(fd)};syncBuiltinESMExports();\n`);
    env.NODE_OPTIONS = `--require=${hook}`;
  }
  const run = spawnSync(process.execPath, [scriptPath, ...args], { env, encoding: "utf8" });
  const invoked = run.status === 0 ? JSON.parse(readFileSync(marker, "utf8")) : null;
  return { run, invoked, marker, receiptDir, env };
}

it.each([
  [{ EXPO_TOKEN: undefined }, "EXPO_TOKEN"],
  [{ DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD: undefined }, "APPROVED_MAX_COST"],
  [{ DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD: "1e9" }, "APPROVED_MAX_COST"],
  [{ DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD: "0.00" }, "APPROVED_MAX_COST"],
  [{ DEEP_EAS_DEVICE_APPROVAL_ID: undefined }, "APPROVAL_ID"],
  [{ DEEP_EAS_DEVICE_RECEIPT_DIR: undefined }, "RECEIPT_DIR"],
  [{ DEEP_EAS_CLI_BIN: "/missing/eas" }, "not executable"],
] as const)("W10 blocks missing or malformed EAS authority before CLI invocation: %s", (env, reason) => {
  const { run, marker } = probe(env);
  expect(run.status).toBe(2);
  expect(run.stderr).toContain(reason);
  expect(() => readFileSync(marker)).toThrow();
});

it("W10 rejects profile/platform/submit argument injection before CLI invocation", () => {
  const { run, marker } = probe({}, ["--profile", "production", "--auto-submit"]);
  expect(run.status).toBe(2);
  expect(run.stderr).toContain("arguments are not accepted");
  expect(() => readFileSync(marker)).toThrow();
});

it.each([
  [(app: AppConfig) => { app.expo.android.package = "other.app"; }, "Expo project"],
  [(_app: AppConfig, eas: EasConfig) => { eas.build.device.env.EXPO_PUBLIC_API_URL = "https://example.invalid"; }, "device profile"],
  [(_app: AppConfig, eas: EasConfig) => { eas.build.device.android.buildType = "app-bundle"; }, "device profile"],
  [(_app: AppConfig, eas: EasConfig) => { Object.assign(eas.build.device, { distribution: "store" }); }, "device profile"],
  [(_app: AppConfig, eas: EasConfig) => { Object.assign(eas.build.device.android, { gradleCommand: ":app:assembleRelease" }); }, "device profile"],
  [(_app: AppConfig, eas: EasConfig) => { Object.assign(eas.build.device.android, { credentialsSource: "local" }); }, "device profile"],
  [(_app: AppConfig, eas: EasConfig) => { Object.assign(eas.build.device.env, { EXPO_PUBLIC_API_URL_ALT: "https://example.invalid" }); }, "device profile"],
  [(_app: AppConfig, eas: EasConfig) => { Object.assign(eas.build, { preview: { distribution: "internal", android: { buildType: "app-bundle", credentialsSource: "remote" }, env: { EXPO_PUBLIC_API_URL: "https://example.invalid" } } }); }, "device profile"],
] as const)("W10 blocks config drift before CLI invocation", (mutate, reason) => {
  const { run, marker, receiptDir } = probe({}, [], mutate);
  expect(run.status).toBe(2);
  expect(run.stderr).toContain(reason);
  expect(() => readFileSync(marker)).toThrow();
  expect(existsSync(join(receiptDir, "owner-build-20260921.json"))).toBe(false);
});

it("W10 invokes only Android device APK build and strips shell API override", () => {
  const { run, invoked, receiptDir } = probe({});
  expect(run.status).toBe(0);
  expect(invoked.args).toEqual(["build", "--platform", "android", "--profile", "device", "--non-interactive", "--wait"]);
  expect(invoked.cwd).toBe(resolve(__dirname, ".."));
  expect(invoked.api).toBeNull();
  expect(invoked.provider).toBeNull();
  expect(run.stdout).toContain("[redacted]");
  expect(run.stdout).not.toContain("test-only-token");
  const receipt = JSON.parse(readFileSync(join(receiptDir, "owner-build-20260921.json"), "utf8"));
  expect(receipt).toMatchObject({ approvalId: "owner-build-20260921", approvedMaxCostUsd: "10.00", profile: "device" });
  expect(receipt).not.toHaveProperty("EXPO_TOKEN");
});

it("W10 consumes an approval identity once, including an unknown result", () => {
  const first = probe({}, [], undefined, 37);
  expect(first.run.status).toBe(37);
  const second = spawnSync(process.execPath, [script], { env: first.env, encoding: "utf8" });
  expect(second.status).toBe(2);
  expect(second.stderr).toContain("already used");
  expect(readFileSync(first.marker, "utf8")).toContain("--profile");
});

it("W10 retries short positive receipt writes until the complete JSON is durable", () => {
  const { run, marker, receiptDir } = probe({}, [], undefined, 0, "partial-write");
  expect(run.status).toBe(0);
  expect(existsSync(marker)).toBe(true);
  expect(JSON.parse(readFileSync(join(receiptDir, "owner-build-20260921.json"), "utf8")).profile).toBe("device");
});

it.each(["write-zero", "file-fsync", "directory-fsync"] as const)("W10 holds approval on %s failure before CLI and blocks second dispatch", fault => {
  const first = probe({}, [], undefined, 0, fault);
  expect(first.run.status).toBe(2);
  expect(existsSync(first.marker)).toBe(false);
  expect(existsSync(join(first.receiptDir, "owner-build-20260921.json"))).toBe(true);
  const second = spawnSync(process.execPath, [script], { env: { ...first.env, NODE_OPTIONS: "" }, encoding: "utf8" });
  expect(second.status).toBe(2);
  expect(second.stderr).toContain("already used");
  expect(existsSync(first.marker)).toBe(false);
});
