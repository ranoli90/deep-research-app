import PgBoss from "pg-boss";

export const RESEARCH_QUEUE = "research-run";

export async function createQueue(connectionString: string, options: { schemaSetup?: boolean } = {}): Promise<PgBoss> {
  const schemaSetup = options.schemaSetup ?? true;
  const boss = new PgBoss({
    connectionString,
    application_name: "deep-research-queue",
    migrate: schemaSetup,
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 3600,
  });
  boss.on("error", (err) => {
    process.stderr.write(JSON.stringify({ level: "error", event: "pgboss", err: String(err) }) + "\n");
  });
  try {
    await boss.start();
    if (schemaSetup) await boss.createQueue(RESEARCH_QUEUE);
    else if (!await boss.getQueue(RESEARCH_QUEUE)) throw new Error("research_queue_missing");
    return boss;
  } catch (error) {
    await boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
    throw error;
  }
}

export async function enqueueRun(boss: PgBoss, runId: string): Promise<string | null> {
  const id = await boss.send(RESEARCH_QUEUE, { runId }, { singletonKey: runId });
  return id;
}
