import { defineConfig } from "@playwright/test";

// Deterministic synthetic-suite measurement (SPEC 25.5). Run through `pnpm metrics`, never as part of the e2e suite.
export default defineConfig({
  testDir: "tests/metrics",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  outputDir: "test-results/playwright-metrics",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  reporter: [["line"]],
  forbidOnly: true,
});
