import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
process.env.ACTFLOW_E2E_DIR ??= resolve(`data/runtime/e2e-${Date.now()}`);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000, expect: { timeout: 15_000 }, workers: 1, retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --hostname 127.0.0.1 --port 3100", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 120_000,
    env: { ACTFLOW_DATA_DIR: process.env.ACTFLOW_E2E_DIR, ACTFLOW_DB_PATH: resolve(process.env.ACTFLOW_E2E_DIR, "actflow.sqlite"), ACTFLOW_DEMO_AUTH: "true", ACTFLOW_TEST_MODE: "true", ACTFLOW_TEST_FAULT_SECRET: "actflow-e2e-only", NEXT_TELEMETRY_DISABLED: "1" } }
});
