import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(process.cwd()) } },
  test: {
    setupFiles: ["./tests/support/setup.ts"],
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/integration/**/*.test.ts"],
    fileParallelism: false
    ,testTimeout: 15000
  }
});
