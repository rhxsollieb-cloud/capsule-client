import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: ".local/playwright/results",
  reporter: [["list"], ["html", { outputFolder: ".local/playwright/report", open: "never" }]],
  use: {
    actionTimeout: 8000,
    navigationTimeout: 15000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
