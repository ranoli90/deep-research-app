process.env.LIVE_ROUTE_ENABLED = "true";
process.env.LIVE_RETRIEVAL_ENABLED = process.env.LIVE_RETRIEVAL_ENABLED ?? "true";
if (!process.env.OPENROUTER_API_KEY || (Number(process.env.LIVE_SPEND_CAP_MICRO ?? 0) <= 0 || Number(process.env.LIVE_KEY_SPEND_CAP_MICRO ?? 0) <= 0)) {
  process.stderr.write("LIVE_ROUTE_ENABLED requires OPENROUTER_API_KEY and positive LIVE_SPEND_CAP_MICRO/LIVE_KEY_SPEND_CAP_MICRO. Refusing to start.\n");
  process.exit(2);
}
process.env.DEV_ALLOW_FIXTURE_ROUTE = "false";
process.env.STRUCTURED_MODEL_ENABLED = "true";
const { spawn } = await import("node:child_process");
const { loadConfig } = await import("./platform/config.js");
loadConfig();
const api=spawn("pnpm",["exec","tsx","src/api/server.ts"],{stdio:"inherit",cwd:process.cwd(),env:process.env});
const worker=spawn("pnpm",["exec","tsx","src/worker/main.ts"],{stdio:"inherit",cwd:process.cwd(),env:process.env});
const stop=()=>{api.kill("SIGTERM");worker.kill("SIGTERM");};
process.on("SIGINT",stop);process.on("SIGTERM",stop);
