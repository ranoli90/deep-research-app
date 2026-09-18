import { spawn } from "node:child_process";
import { loadConfig } from "./platform/config.js";

process.env.DEV_ALLOW_FIXTURE_ROUTE = "true";
process.env.LIVE_ROUTE_ENABLED = "false";
loadConfig();
const api = spawn("pnpm", ["exec", "tsx", "src/api/server.ts"], { stdio: "inherit", cwd: process.cwd(), env: process.env });
const worker = spawn("pnpm", ["exec", "tsx", "src/worker/diagnostic-main.ts"], { stdio: "inherit", cwd: process.cwd(), env: process.env });
const stop = () => {
  api.kill("SIGTERM");
  worker.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
