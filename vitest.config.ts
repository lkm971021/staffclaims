import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://claims:claims_dev@localhost:5432/claims_test?host=/tmp",
      STORAGE_DIR: "./.test-storage",
      MOCK_DRIVE_DIR: "./.test-mock-drive",
      TOKEN_ENCRYPTION_KEY: "test-only-key-0123456789abcdefghijklmnop",
      TZ: "UTC",
    },
  },
});
