import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { accessSync, closeSync, openSync, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "52197359-d453-48a6-876f-ea00ba253528";
const owner = "jobeezyapp";
const apiUrl = "http://127.0.0.1:8787";

function stop(reason) {
  process.stderr.write(`EAS device build blocked: ${reason}\n`);
  process.exit(2);
}

function budgetIsValid(value) {
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/.test(value ?? "")) return false;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 9999;
}

if (process.argv.length !== 2) stop("arguments are not accepted; Android device profile is fixed");
if (!process.env.EXPO_TOKEN?.trim()) stop("approved passwordless EXPO_TOKEN is absent");
if (!budgetIsValid(process.env.DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD)) {
  stop("DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD must be an explicit positive USD amount with at most two decimals");
}
if (!/^[-A-Za-z0-9_]{8,120}$/.test(process.env.DEEP_EAS_DEVICE_APPROVAL_ID ?? "")) {
  stop("DEEP_EAS_DEVICE_APPROVAL_ID must identify the owner-approved build budget");
}
const receiptDir = process.env.DEEP_EAS_DEVICE_RECEIPT_DIR;
if (!receiptDir || !isAbsolute(receiptDir)) stop("DEEP_EAS_DEVICE_RECEIPT_DIR must be an existing absolute directory outside the repository");
try {
  const location = realpathSync(receiptDir);
  const repository = realpathSync(resolve(mobileRoot, "../.."));
  if (!statSync(location).isDirectory() || location === repository || location.startsWith(repository + "/")) {
    stop("DEEP_EAS_DEVICE_RECEIPT_DIR must be an existing directory outside the repository");
  }
} catch {
  stop("DEEP_EAS_DEVICE_RECEIPT_DIR cannot be read");
}

let app;
let eas;
try {
  app = JSON.parse(readFileSync(resolve(mobileRoot, "app.json"), "utf8")).expo;
  eas = JSON.parse(readFileSync(resolve(mobileRoot, "eas.json"), "utf8"));
} catch {
  stop("mobile app/EAS configuration cannot be read");
}
const preview = eas.build?.preview;
const device = eas.build?.device;
if (app?.owner !== owner || app?.extra?.eas?.projectId !== projectId || app?.android?.package !== "app.deepresearch.mobile") {
  stop("Expo project owner, ID, or Android package differs from the approved device target");
}
if (device?.extends !== "preview" || preview?.distribution !== "internal" ||
    device?.android?.buildType !== "apk" || device?.android?.credentialsSource !== "remote" ||
    device?.env?.EXPO_PUBLIC_API_URL !== apiUrl || device?.env?.EXPO_PUBLIC_ALLOW_CLEARTEXT !== "1") {
  stop("device profile must remain internal Android APK with the approved loopback API and remote signing");
}

const easBin = process.env.DEEP_EAS_CLI_BIN;
if (!easBin || !isAbsolute(easBin)) stop("DEEP_EAS_CLI_BIN must name an existing absolute EAS CLI executable");
try {
  accessSync(easBin, constants.X_OK);
} catch {
  stop("DEEP_EAS_CLI_BIN is not executable");
}

// Reserve this one-use budget identity before any CLI/network request. An
// interrupted or unknown EAS outcome keeps the receipt, so it cannot resend.
const receiptPath = join(receiptDir, `${process.env.DEEP_EAS_DEVICE_APPROVAL_ID}.json`);
try {
  const fd = openSync(receiptPath, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify({
      approvalId: process.env.DEEP_EAS_DEVICE_APPROVAL_ID,
      approvedMaxCostUsd: process.env.DEEP_EAS_DEVICE_APPROVED_MAX_COST_USD,
      projectId,
      platform: "android",
      profile: "device",
      createdAt: new Date().toISOString(),
    }) + "\n");
  } finally {
    closeSync(fd);
  }
} catch {
  stop("approval identity was already used or its one-use receipt cannot be written; do not retry an unknown build");
}

// EAS has no client-side hard billing cap. This local budget authorization is
// mandatory before the first CLI/network request; account billing must also be
// checked by the approving operator before setting it.
const childEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USER: process.env.USER,
  LOGNAME: process.env.LOGNAME,
  SHELL: process.env.SHELL,
  TMPDIR: process.env.TMPDIR,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  HTTP_PROXY: process.env.HTTP_PROXY,
  NO_PROXY: process.env.NO_PROXY,
  NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
  EXPO_TOKEN: process.env.EXPO_TOKEN,
  CI: "1",
  EXPO_NO_TELEMETRY: "1",
  EXPO_NO_DOTENV: "1",
};
const result = spawnSync(easBin, ["build", "--platform", "android", "--profile", "device", "--non-interactive", "--wait"], {
  cwd: mobileRoot,
  env: childEnv,
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (result.error) stop("EAS CLI could not start");
const redact = (value) => value?.replaceAll(process.env.EXPO_TOKEN, "[redacted]") ?? "";
process.stdout.write(redact(result.stdout));
process.stderr.write(redact(result.stderr));
process.exit(result.status ?? 1);
