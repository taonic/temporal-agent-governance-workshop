// End-to-end tests against a deployed course site: the live Fly app unless E2E_BASE_URL says
// otherwise. Three tiers, by tag:
//
//   @public   no secrets: the site, its pages and the /api's answers to a signed-out visitor
//   @auth     E2E_ACCESS_CODE: a session, without starting a sandbox
//   @sandbox  E2E_ACCESS_CODE: a real learner's run, a Daytona sandbox from start to delete
//
// A tier whose secret is missing skips. See README.md.
import { defineConfig, devices } from "@playwright/test";

import { BASE_URL } from "./env.mjs";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.mjs",
  // The sandbox tier waits minutes for Daytona; each of its steps sets its own, longer, timeout.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // One retry for the network's sake. The sandbox tier opts out: a retry would build a second sandbox.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "reports/html" }],
    ["json", { outputFile: "reports/results.json" }],
    ...(process.env.CI ? [["github"]] : []),
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The site's dark mode follows the system; pin it so screenshots compare day to day.
    colorScheme: "light",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
