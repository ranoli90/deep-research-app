import { mergeConfig } from "vitest/config";
import base from "../../../apps/backend/vitest.integration.config.js";
export default mergeConfig(base, { test: { setupFiles: ["../../verification/v6/correction-query-profile/query-timing.mjs"] } });
