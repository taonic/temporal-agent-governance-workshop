// @sandbox: a learner's whole run, in one real Daytona sandbox: sign in with the access code,
// start the sandbox, use both terminals, open the Temporal UI and the Agent UI, then solve and
// check every exercise that has a check. The sandbox is deleted at the end, pass or fail.
//
// What it runs comes from the deployed site, not from this file: the exercises are the picker's,
// and each one's check is the script its ✓ Check button runs (its solve.sh sits beside it). A new
// exercise, or a changed solution, is covered the day it ships. Skips without E2E_ACCESS_CODE,
// or with E2E_SKIP_SANDBOX=1.
import { ACCESS_CODE, SKIP_SANDBOX } from "../env.mjs";
import { coursePages, expect, storageKey, test } from "./fixtures.mjs";

const MINUTE = 60_000;

test.describe("a learner's sandbox, start to finish", { tag: "@sandbox" }, () => {
  test.skip(!ACCESS_CODE, "needs E2E_ACCESS_CODE");
  test.skip(SKIP_SANDBOX, "E2E_SKIP_SANDBOX is set");
  // One sandbox for every step, in order. No retries: a retry would build a second sandbox.
  test.describe.configure({ mode: "serial", retries: 0 });

  let context;
  let page;
  const problems = [];

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    await context.addInitScript((key) => localStorage.setItem(key, "true"), storageKey("onboarded"));
    page = await context.newPage();
    page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
  });

  test.afterAll(async () => {
    // Delete the sandbox and sign out, whatever happened: Daytona bills for it, and it counts
    // against MAX_SANDBOXES for real learners.
    if (!page) return;
    const reset = await page.request.post("/api/sandbox/reset").catch((err) => err);
    console.log(`sandbox reset: ${reset.status?.() ?? reset.message}`);
    await page.request.delete("/api/session").catch(() => {});
    await context.close();
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("screenshot", { body: await page.screenshot(), contentType: "image/png" });
      for (const name of ["worker", "commands"]) {
        const text = await terminal(name).locator(".xterm-rows").innerText().catch(() => "");
        await testInfo.attach(`${name}-terminal`, { body: text, contentType: "text/plain" });
      }
    }
    expect(problems.splice(0), "the page threw").toEqual([]);
  });

  const terminal = (name) => page.locator(`.terminal-pane[aria-label="The ${name} terminal"]`);

  // Types a command into a terminal, in the workshop's folder, and waits for it to exit 0. The
  // marker it waits for is built by the shell ($((…)), $?), so the typed line never matches it.
  async function run(name, command, { timeout = MINUTE } = {}) {
    const id = Math.floor(Math.random() * 1e6);
    await terminal(name).locator(".terminal-host").click();
    await page.keyboard.type(`cd /workshop && ${command}; echo e2e-$((${id}+1))-exit-$?`);
    await page.keyboard.press("Enter");
    const rows = terminal(name).locator(".xterm-rows");
    await expect(rows).toContainText(new RegExp(`e2e-${id + 1}-exit-\\d+`), { timeout });
    await expect(rows, `\`${command}\` failed`).toContainText(`e2e-${id + 1}-exit-0`, { timeout: 1000 });
  }

  test("signs in with the access code and starts a sandbox", async () => {
    test.setTimeout(10 * MINUTE);
    await page.goto("/#/exercise/01-hello-temporal");
    const form = page.locator(".dock-status .access-form");
    await form.locator("#access-code").fill(ACCESS_CODE);
    await form.getByRole("button", { name: "Start my sandbox" }).click();
    await expect(form.locator(".form-error")).toHaveCount(0);
    // Creating one from the snapshot, then `travel-stack up`: about a minute, more on a cold day.
    await expect(page.locator(".sandbox-pill"), "the sandbox never got ready").toHaveText(/Sandbox ready/, { timeout: 8 * MINUTE });
    await expect(page.locator(".sandbox-status .status-error")).toHaveCount(0);
  });

  test("both terminals connect and run commands", async () => {
    test.setTimeout(3 * MINUTE);
    for (const name of ["worker", "commands"]) {
      await expect(terminal(name).locator(".term-dot.connected"), `the ${name} terminal didn't connect`).toBeVisible({ timeout: MINUTE });
    }
    await run("commands", "test -f pyproject.toml && uv --version");
  });

  test("the Temporal UI opens in its pane", async () => {
    test.setTimeout(3 * MINUTE);
    await page.getByRole("tab", { name: "Temporal UI" }).click();
    const ui = page.frameLocator("iframe[title='The Temporal UI']");
    await expect(ui.getByText("Workflows").first()).toBeVisible({ timeout: 2 * MINUTE });
    await page.getByRole("tab", { name: "Code" }).click();
  });

  test("the Agent UI opens in its pane", async () => {
    test.setTimeout(3 * MINUTE);
    const first = (await coursePages(page)).find((p) => p.hash.startsWith("#/exercise/") && !p.hash.endsWith("/01-hello-temporal"));
    await page.goto(`/${first.hash}`);
    await expect(page.locator(".sandbox-pill")).toHaveText(/Sandbox ready/, { timeout: 2 * MINUTE });
    await page.getByRole("tab", { name: "Agent UI" }).click();
    const ui = page.frameLocator("iframe[title='The Agent UI']");
    await expect(ui.locator("button.session-drawer-trigger")).toBeVisible({ timeout: 2 * MINUTE });
    await page.getByRole("tab", { name: "Code" }).click();
  });

  test("every exercise's solution passes its check", async () => {
    const exercises = (await coursePages(page)).filter((p) => p.hash.startsWith("#/exercise/"));
    test.setTimeout(exercises.length * 6 * MINUTE);
    let checked = 0;
    for (const { hash, label } of exercises) {
      await test.step(label, async () => {
        await page.goto(`/${hash}`);
        await expect(page.locator(".sandbox-pill")).toHaveText(/Sandbox ready/, { timeout: 2 * MINUTE });
        const checkButton = page.locator(".dock-bar").getByRole("button", { name: "✓ Check" });
        if (!(await checkButton.count())) return; // the capstone has no check
        const check = (await checkButton.getAttribute("title")).replace(/^Run the check:\s*/, "");
        const solve = check.replace(/check\.sh$/, "solve.sh");
        await run("commands", solve, { timeout: 2 * MINUTE });
        await checkButton.click();
        await expect(page.locator(".guide-heading-title .passed-badge"), `${check} didn't pass with the official solution`).toBeVisible({
          timeout: 5 * MINUTE,
        });
        checked++;
      });
    }
    expect(checked, "no exercise had a check").toBeGreaterThan(0);
  });
});
