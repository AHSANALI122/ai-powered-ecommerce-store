import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      // Database-backed. They skip themselves unless INTEGRATION_DATABASE_URL
      // is set, so `npm test` stays runnable without Postgres.
      "tests/integration/**/*.test.ts",
    ],
    // The capture concurrency test fires parallel transactions against real
    // Postgres and needs more than the 5s default.
    testTimeout: 30_000,
    exclude: ["node_modules/**", ".next/**", "src/generated/**", "tests/e2e/**"],
  },
});
