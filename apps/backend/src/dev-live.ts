process.env.LIVE_ROUTE_ENABLED = "true";
if (!process.env.OPENROUTER_API_KEY) {
  process.stderr.write("LIVE_ROUTE_ENABLED requires OPENROUTER_API_KEY and an authorized budget. Refusing to start.\n");
  process.exit(2);
}
await import("./dev-demo.js");
