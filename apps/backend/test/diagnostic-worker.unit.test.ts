import { expect,it,vi } from "vitest";
import type pg from "pg";
import { loadConfig } from "../src/platform/config.js";
import { processRun } from "../src/worker/diagnostic-executor.js";
it.each(["environment","identity"] as const)("W05 diagnostic worker rejects production %s before database or provider work",async boundary=>{
 const query=vi.fn(()=>{throw new Error("database must not be accessed");});
 const pool={query} as unknown as pg.Pool;
 const config=loadConfig({DATABASE_URL:"postgres://unused.invalid/not-used"});
 if(boundary==="environment")config.nodeEnv="production";else config.authMode="production";
 await expect(processRun(pool,config,crypto.randomUUID())).rejects.toThrow("diagnostic_worker_forbidden");
 expect(query).not.toHaveBeenCalled();
});
