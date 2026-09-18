import { loadConfig } from "../platform/config.js";
import { processRun } from "./diagnostic-executor.js";
import { startWorker } from "./runtime.js";
const config=loadConfig();
if(config.nodeEnv==="production"||config.authMode==="production")throw new Error("diagnostic_worker_forbidden");
await startWorker(processRun,config);
