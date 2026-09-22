import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { activateStagingTrial, stagingTrialActivationAuthorized } from "./staging-trial.js";

/**
 * Explicitly-gated operator entry point. It refuses unless
 * `ENABLE_STAGING_TRIAL=1` is set in the process environment, so a production
 * or local run never enables the trial by accident. Point DATABASE_URL at the
 * intended STAGING database. No secrets are printed.
 */
if (!stagingTrialActivationAuthorized()) {
  process.stderr.write(
    "Refusing: set ENABLE_STAGING_TRIAL=1 to enable the staging-only new-member trial. Production stays default-deny.\n",
  );
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL missing. Point it at the intended STAGING database.\n");
  process.exit(1);
}
const config = loadConfig();
if (!config.databaseUrl) {
  process.stderr.write("DATABASE_URL missing.\n");
  process.exit(1);
}
const pool = createPool(config.databaseUrl);
try {
  const result = await activateStagingTrial(pool);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.stdout.write("Staging new-member trial active for 48h. Production default-deny is unchanged.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
