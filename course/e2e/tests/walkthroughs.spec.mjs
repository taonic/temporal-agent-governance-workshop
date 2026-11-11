// @sandbox, all at once: every exercise the way its instructions say (walkthroughs.mjs), each by
// a learner of its own (WALK_EMAIL) in a sandbox of its own, in parallel, each ending with its
// ✓ Check. One after another in one sandbox they took most of a full run; side by side, the run
// takes about as long as the longest. Each walkthrough starts with the guide's Start over, so it
// has its exercise as it starts.
//
// Each learner is put on the allowlist by the tests' admin and deleted after, with its sandbox,
// pass or fail (and by the global setup, should a run die before then). Skips without
// E2E_SIGNIN_KEY, or with E2E_SKIP_SANDBOX=1.
import { SIGNIN_KEY, SKIP_SANDBOX, WALK_EMAIL } from "../env.mjs";
import { allow, deleteLearner, signInApi } from "./accounts.mjs";
import { expect, showCode, storageKey, test } from "./fixtures.mjs";
import { Learner, MINUTE } from "./learner.mjs";
import { WALKTHROUGHS } from "./walkthroughs.mjs";

test.describe("every exercise, as its instructions say", { tag: "@sandbox" }, () => {
  test.skip(!SIGNIN_KEY, "needs E2E_SIGNIN_KEY");
  test.skip(SKIP_SANDBOX, "E2E_SKIP_SANDBOX is set");
  // Side by side. No retries: a retry would walk an exercise twice, in a second sandbox.
  test.describe.configure({ mode: "parallel", retries: 0 });

  for (const [id, walk] of Object.entries(WALKTHROUGHS)) {
    test(`${id}, as its instructions say`, async ({ browser }, testInfo) => {
      test.setTimeout(30 * MINUTE);
      const email = WALK_EMAIL(id);
      await deleteLearner(email); // one a run that died left behind, and its sandbox
      await allow(email);
      const { api } = await signInApi(email, { profile: { name: `E2E ${id}`, role: "Developer" } });
      const storageState = await api.storageState();
      await api.dispose();

      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", storageState });
      await context.addInitScript((key) => localStorage.setItem(key, "true"), storageKey("onboarded"));
      const page = await context.newPage();
      const problems = [];
      // What an uncaught error was, when its message says little ("Object": a promise rejected
      // with a plain object): the console's report, with its value and the script it came from.
      const details = [];
      page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
      page.on("console", async (msg) => {
        if (msg.type() !== "error" || !msg.text().startsWith("Uncaught")) return;
        const values = await Promise.all(msg.args().map((arg) => arg.jsonValue().catch(() => "?")));
        details.push(`${msg.text()} ${JSON.stringify(values).slice(0, 400)} (${msg.location().url}:${msg.location().lineNumber})`);
      });
      page.on("dialog", (dialog) => dialog.accept()); // the page's confirm()s, as a learner says yes
      const terminal = (name) => page.locator(`.terminal-pane[aria-label="The ${name} terminal"]`);
      try {
        // Signed in, the module page starts the sandbox on its own: from the snapshot, then
        // `travel-stack up`, about a minute (more with others starting at once).
        await page.goto(`/#/exercise/${id}`);
        await showCode(page);
        await expect(page.locator(".sandbox-pill"), "the sandbox never got ready").toHaveText(/Sandbox ready/, { timeout: 8 * MINUTE });
        const learner = new Learner(page, testInfo);
        await learner.openExercise(id);
        await walk(learner);
        expect(problems, `the page threw${details.length ? `: ${details.join(" | ")}` : ""}`).toEqual([]);
      } catch (err) {
        await testInfo.attach("screenshot", { body: await page.screenshot().catch(() => Buffer.from("")), contentType: "image/png" });
        for (const name of ["worker", "commands"]) {
          const text = await terminal(name).locator(".xterm-rows").innerText().catch(() => "");
          await testInfo.attach(`${name}-terminal`, { body: text, contentType: "text/plain" });
        }
        const chat = await page.frameLocator("iframe[title='The Agent UI']").locator(".message-list").innerText({ timeout: 2000 }).catch(() => "");
        if (chat) await testInfo.attach("agent-chat", { body: chat, contentType: "text/plain" });
        throw err;
      } finally {
        await context.close();
        await deleteLearner(email).catch((err) => console.log(`deleting ${email}: ${err.message}`));
      }
    });
  }
});
