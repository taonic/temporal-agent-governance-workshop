// @sandbox: a learner's run, in one real Daytona sandbox: sign in through the page, start the
// sandbox, use both terminals, a live challenge, the Temporal UI and the Agent UI, and Essentials'
// E2 on its Trip board. The exercises' walkthroughs run beside it, each in a sandbox of its own
// (walkthroughs.spec.mjs). The sandbox is deleted at the end, pass or fail (global-teardown.mjs).
// Skips without E2E_SIGNIN_KEY, or with E2E_SKIP_SANDBOX=1. Its learner (SANDBOX_EMAIL) is put on
// the allowlist by the tests' admin, and deleted by the teardown.
//
// The tests run in order, as one learner, but one failing doesn't stop the rest: Playwright
// starts a new worker for the next test, which signs in as the same learner (its cookies are
// kept in LEARNER_STATE) and so finds the same sandbox.
import fs from "node:fs";

import { LEARNER_STATE, SANDBOX_EMAIL, SIGNIN_KEY, SKIP_SANDBOX, e2eCode } from "../env.mjs";
import { allow } from "./accounts.mjs";
import { coursePages, expect, showCode, storageKey, test } from "./fixtures.mjs";
import { Learner, MINUTE } from "./learner.mjs";
import { WALKTHROUGHS } from "./walkthroughs.mjs";

test.describe("a learner's sandbox, start to finish", { tag: "@sandbox" }, () => {
  test.skip(!SIGNIN_KEY, "needs E2E_SIGNIN_KEY");
  test.skip(SKIP_SANDBOX, "E2E_SKIP_SANDBOX is set");
  // In order, in one worker at a time. No retries: a retry would walk an exercise twice.
  test.describe.configure({ mode: "default", retries: 0 });

  let context;
  let page;
  const problems = [];
  // What an uncaught error was, when its message says little ("Object": a promise rejected with
  // a plain object): the console's report, with its value and the script it came from.
  const details = [];

  test.beforeAll(async ({ browser }) => {
    const signedIn = fs.existsSync(LEARNER_STATE);
    if (!signedIn) await allow(SANDBOX_EMAIL);
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      ...(signedIn ? { storageState: LEARNER_STATE } : {}),
    });
    await context.addInitScript((key) => localStorage.setItem(key, "true"), storageKey("onboarded"));
    page = await context.newPage();
    page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
    page.on("console", async (msg) => {
      if (msg.type() !== "error" || !msg.text().startsWith("Uncaught")) return;
      const values = await Promise.all(msg.args().map((arg) => arg.jsonValue().catch(() => "?")));
      details.push(`${msg.text()} ${JSON.stringify(values).slice(0, 400)} (${msg.location().url}:${msg.location().lineNumber})`);
    });
    page.on("dialog", (dialog) => dialog.accept()); // the page's confirm()s, as a learner says yes
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("screenshot", { body: await page.screenshot(), contentType: "image/png" });
      for (const name of ["worker", "commands"]) {
        const text = await terminal(name).locator(".xterm-rows").innerText().catch(() => "");
        await testInfo.attach(`${name}-terminal`, { body: text, contentType: "text/plain" });
      }
      const chat = await page.frameLocator("iframe[title='The Agent UI']").locator(".message-list").innerText({ timeout: 2000 }).catch(() => "");
      if (chat) await testInfo.attach("agent-chat", { body: chat, contentType: "text/plain" });
    }
    const seen = details.splice(0);
    expect(problems.splice(0), `the page threw${seen.length ? `: ${seen.join(" | ")}` : ""}`).toEqual([]);
  });

  const terminal = (name) => page.locator(`.terminal-pane[aria-label="The ${name} terminal"]`);

  test("signs in through the page and starts a sandbox", async () => {
    test.setTimeout(10 * MINUTE);
    await page.goto("/#/exercise/01-hello-temporal");
    // Signed out, the module asks for a sign-in: an email, its code, then a name and role.
    const form = page.locator(".sign-in-page .access-form");
    await form.locator("#access-email").fill(SANDBOX_EMAIL);
    await form.getByRole("button", { name: "Email me a code" }).click();
    await form.locator("#access-code").fill(e2eCode(SANDBOX_EMAIL));
    await form.getByRole("button", { name: "Sign in" }).click();
    await expect(form.locator(".form-error")).toHaveCount(0);
    // A new learner is asked for a name and role next; one seen before goes straight in.
    const name = form.locator("#access-name");
    await expect(name.or(page.locator(".sandbox-pill"))).toBeVisible({ timeout: 30_000 });
    if (await name.isVisible()) {
      await form.locator("#access-name").fill("E2E Sandbox");
      await form.locator("#access-role").selectOption("Developer");
      await form.getByRole("button", { name: "Sign in" }).click();
    }
    // Signed in, the page starts the sandbox on its own.
    await showCode(page);
    // Creating one from the snapshot, then `travel-stack up`: about a minute, more on a cold day.
    await expect(page.locator(".sandbox-pill"), "the sandbox never got ready").toHaveText(/Sandbox ready/, { timeout: 8 * MINUTE });
    await expect(page.locator(".sandbox-status .status-error")).toHaveCount(0);
    // The learner, for the tests after this one in a new worker, and for the teardown.
    await context.storageState({ path: LEARNER_STATE });
  });

  test("both terminals connect and run commands", async () => {
    test.setTimeout(3 * MINUTE);
    await page.goto("/#/exercise/01-hello-temporal");
    await showCode(page);
    for (const name of ["worker", "commands"]) {
      await expect(terminal(name).locator(".term-dot.connected"), `the ${name} terminal didn't connect`).toBeVisible({ timeout: MINUTE });
    }
    const learner = new Learner(page);
    await learner.type("commands", "cd /workshop && test -f pyproject.toml && uv --version");
    expect(await learner.settle("commands", { timeout: MINUTE }), "uv isn't there").toBe(0);
  });

  // A challenge, live in the sandbox: the pick goes into the learner's file and runs in the
  // commands terminal. A run that breaks before its code runs says why at once, and costs no pick;
  // a wrong pick shows what happened and why, is struck out, and comes back out of the file.
  test("a challenge runs live: a broken run says why and costs nothing, a wrong pick shows what happened and why", async () => {
    test.setTimeout(6 * MINUTE);
    const learner = new Learner(page);
    const picks = async () => (await (await page.request.get("/api/progress")).json()).attempts?.FC1 ?? [];
    const copy = "quests/fundamentals/99-e2e-copy";
    await page.goto("/#/module/FC1");
    await expect(page.locator(".sandbox-pill")).toHaveText(/Sandbox ready/, { timeout: 3 * MINUTE });
    await showCode(page);

    // The sandbox has the workshop as it is now: every module once (no folder from an older
    // snapshot beside its renamed copy), so the scripts can read them.
    await learner.type("commands", "./quest status >/dev/null");
    expect(await learner.settle("commands", { timeout: MINUTE }), "./quest can't read the workshop's modules").toBe(0);
    expect(await picks()).toEqual([]);

    const challenge = page.locator(".challenge");
    const choiceA = challenge.locator(".challenge-choice", { hasText: "Give up after three attempts" });
    await choiceA.click();
    await expect(challenge.locator(".challenge-diff-file")).toContainText("Choice A is in hello/workflow.py", { timeout: 30_000 });

    // Broken on purpose: a module copied, so its id is there twice and nothing can load them.
    await learner.type("commands", `cp -r quests/fundamentals/01-run-it-and-see-it-stop ${copy}`);
    expect(await learner.settle("commands")).toBe(0);
    await challenge.getByRole("button", { name: "Lock in A and run it" }).click();
    const outcome = challenge.locator(".challenge-outcome");
    // Well before the page's minute of waiting for an answer.
    await expect(outcome.locator(".outcome-summary")).toContainText("module id F1", { timeout: 40_000 });
    await expect(outcome.locator(".is-waiting")).toHaveCount(0);
    await expect(challenge.locator(".challenge-choice.is-struck")).toHaveCount(0);
    expect(await picks(), "a run that never ran its code shouldn't use up the pick").toEqual([]);

    // Mended, the same pick runs: a wrong one, with what happened and why.
    await learner.type("commands", `rm -rf ${copy}`);
    expect(await learner.settle("commands")).toBe(0);
    await challenge.getByRole("button", { name: "Lock in A and run it" }).click();
    const wrong = challenge.locator(".challenge-outcome.is-wrong");
    await expect(wrong, "the run never came back with an answer").toBeVisible({ timeout: 90_000 });
    await expect(wrong.locator(".outcome-source")).toHaveText("Live");
    await expect(wrong.locator(".outcome-summary")).toContainText("ran out of attempts");
    await expect(wrong.locator(".outcome-why")).toContainText(/\S/);
    await expect(wrong.getByRole("button", { name: "Open its Event History" })).toBeVisible();
    await expect(challenge.locator(".challenge-choice.is-struck")).toHaveCount(1);
    await expect(choiceA).toBeDisabled();
    await expect(challenge.locator(".challenge-again")).toContainText("it's back out of your file");
    await expect.poll(picks).toEqual(["A"]);
    const ran = await learner.terminalLines("commands");
    expect(ran, "the commands terminal").toContain("ran out of attempts");
  });

  test("the Temporal UI opens in its pane", async () => {
    test.setTimeout(3 * MINUTE);
    await page.goto("/#/exercise/01-hello-temporal");
    await page.getByRole("tab", { name: "Temporal UI" }).click();
    const ui = page.frameLocator("iframe[title='The Temporal UI']");
    await expect(ui.getByText("Workflows").first()).toBeVisible({ timeout: 2 * MINUTE });
    await page.getByRole("tab", { name: "Code" }).click();
  });

  test("every exercise in the picker has a walkthrough", async () => {
    const exercises = (await coursePages(page)).filter((p) => p.hash.startsWith("#/exercise/")).map((p) => p.hash.split("/").pop());
    expect(exercises, "add a walkthrough to walkthroughs.mjs for each new exercise, and remove the ones that are gone").toEqual(Object.keys(WALKTHROUGHS));
  });

  // Opening a later exercise catches up the earlier ones (the poll runs ./quest catch-up).
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

  // Last, as the persona it switches to: Essentials' E2 on its Trip board, in the same sandbox. A
  // mistake pauses the Temporal trip while the plain twin's is lost; Ship the fix finishes the same
  // trip, booking nothing twice; and the module's check sees it.
  test("Essentials E2: Ship the fix finishes the stuck trip, and the plain twin's stays lost", async () => {
    test.setTimeout(8 * MINUTE);
    await page.goto("/?persona=essentials#/module/E2");
    await expect(page.locator(".sandbox-pill")).toHaveText(/Sandbox ready/, { timeout: 3 * MINUTE });
    const board = page.locator(".trip-board");
    await expect(board.locator(".tb-flag", { hasText: "A mistake in the hotel step" }), "the board never set E2 up").toBeVisible({ timeout: 2 * MINUTE });
    // The board's actions are the guide's buttons, a step at a time: on to the step that has one
    // (Learner.step waits for each message to finish typing, so its buttons are there).
    const guide = new Learner(page);
    await guide.step("Start a trip with a mistake in it");
    await guide.body.locator('.board-action[data-board-action="start-trip"]').first().click();
    const temporal = board.locator(".tb-run.is-temporal");
    const plain = board.locator(".tb-run.is-plain");
    await expect(plain.locator(".tb-status"), "the plain twin should crash at the hotel").toContainText("the trip is lost", { timeout: 2 * MINUTE });
    await expect(temporal.locator(".tb-step.is-retrying"), "the Temporal trip should wait at the hotel").toContainText("Booking the hotel", { timeout: MINUTE });
    await guide.step("Ship the fix");
    await guide.body.locator('.board-action[data-board-action="ship-fix"]').first().click();
    await expect(temporal.locator(".tb-status"), "the same trip should finish after the fix").toContainText("each one once", { timeout: 2 * MINUTE });
    await expect(plain.locator(".tb-status")).toContainText("the trip is lost");
    await expect(board.locator(".tb-double")).toHaveCount(0);
    // Its check: seen on the board; then its question, and the module is done.
    for (let i = 0; i < 8 && !(await page.locator(".module-check").count()); i++) await guide.advance();
    const check = page.locator(".module-check");
    await expect(check.locator(".mc-part").first()).toHaveClass(/is-done/, { timeout: 30_000 });
    await check.locator(".challenge-choice", { hasText: "carried on from the hotel step" }).click();
    await expect(check.locator(".mc-done")).toContainText("done, +10 XP");
    await expect.poll(async () => (await (await page.request.get("/api/progress")).json()).completed).toContain("E2");
  });
});
