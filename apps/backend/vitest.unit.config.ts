import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@deep/research-core": resolve(root, "../../packages/research-core/src/index.ts"),
      "@deep/contracts": resolve(root, "../../packages/contracts/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.unit.test.ts", "test/governance.test.ts"],
    testTimeout: 15_000,
  },
});
