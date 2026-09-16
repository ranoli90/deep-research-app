if (!process.env.OPENROUTER_API_KEY || process.env.LIVE_SPEND_CAP_MICRO === "0") {
  process.stderr.write("eval:live blocked: OPENROUTER_API_KEY and LIVE_SPEND_CAP_MICRO>0 required.\n");
  process.exit(2);
}
process.stderr.write("eval:live is authorized but no held-out scored harness is registered yet.\n");
process.exit(3);
