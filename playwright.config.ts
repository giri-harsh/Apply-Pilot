import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Playwright empties its output directory on every run; keep it apart from test-results/live-results.txt.
  outputDir: "test-results/playwright",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  // Extension contexts are heavy and share nothing; run serially for stability.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  forbidOnly: true,
});
