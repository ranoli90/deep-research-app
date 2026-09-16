process.env.LIVE_ROUTE_ENABLED = "true";
process.env.LIVE_RETRIEVAL_ENABLED = process.env.LIVE_RETRIEVAL_ENABLED ?? "true";
if (!process.env.OPENROUTER_API_KEY || Number(process.env.LIVE_SPEND_CAP_MICRO ?? 0) <= 0) {
  process.stderr.write("LIVE_ROUTE_ENABLED requires OPENROUTER_API_KEY and LIVE_SPEND_CAP_MICRO>0. Refusing to start.\n");
  process.exit(2);
}
await import("./dev-demo.js");
