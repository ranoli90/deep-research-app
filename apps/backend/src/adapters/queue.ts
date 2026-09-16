import PgBoss from "pg-boss";

export const RESEARCH_QUEUE = "research-run";

export async function createQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    application_name: "deep-research-queue",
    retryLimit: 3,
    retryBackoff: true,
    expireInSeconds: 3600,
  });
  boss.on("error", (err) => {
    process.stderr.write(JSON.stringify({ level: "error", event: "pgboss", err: String(err) }) + "\n");
  });
  await boss.start();
  await boss.createQueue(RESEARCH_QUEUE);
  return boss;
}

export async function enqueueRun(boss: PgBoss, runId: string): Promise<string | null> {
  const id = await boss.send(RESEARCH_QUEUE, { runId }, { singletonKey: runId });
  return id;
}
