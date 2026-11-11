// End-to-end tests against a deployed course site: the live Fly app unless E2E_BASE_URL says
// otherwise. Three tiers, by tag:
//
//   @public   no secrets: the map, the sign-in, and the /api's answers to a signed-out visitor
//   @auth     E2E_SIGNIN_KEY (and E2E_ADMIN_EMAIL in the app's ADMIN_EMAILS): signed-in
//             learners, the module pages, access requests and the admin, without a sandbox
//   @sandbox  E2E_SIGNIN_KEY: a real learner's run, a Daytona sandbox from start to delete
//
// A tier whose secret is missing skips. See README.md.
import { defineConfig, devices } from "@playwright/test";

import { BASE_URL } from "./env.mjs";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.mjs",
  globalTeardown: "./global-teardown.mjs",
  // The sandbox tier waits minutes for Daytona; each of its steps sets its own, longer, timeout.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // One retry for the network's sake. The sandbox tier opts out: a retry would build a second sandbox.
  retries: process.env.CI ? 1 : 0,
  // Enough for the walkthroughs to run side by side (walkthroughs.spec.mjs), each in its own
  // sandbox, beside the sandbox tier and the quick tests. They mostly wait on their sandboxes.
  workers: process.env.CI ? 10 : undefined,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "reports/html" }],
    ["json", { outputFile: "reports/results.json" }],
    ...(process.env.CI ? [["github"]] : []),
  ],
  use: {
    baseURL: BASE_URL,
    // A click on something that never settles fails instead of waiting out the test.
    actionTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The site's dark mode follows the system; pin it so screenshots compare day to day.
    colorScheme: "light",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
