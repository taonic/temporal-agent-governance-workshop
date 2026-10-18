// The tests' `test`: Playwright's, with a page that fails the test on an uncaught error in the
// site's code or a 5xx from the site itself, whatever the test was looking at.
import { test as base, expect } from "@playwright/test";

import { BASE_URL } from "../env.mjs";

export { expect };

// The site's own keys in local storage (web/src/store.js storageKey).
export const storageKey = (key) => `governed-agents-course:${key}`;

export const test = base.extend({
  // Off by default for a page that has done the getting-started steps: true shows them.
  firstVisit: [false, { option: true }],

  page: async ({ page, firstVisit }, use, testInfo) => {
    const problems = [];
    page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
    page.on("response", (res) => {
      if (res.status() >= 500 && res.url().startsWith(BASE_URL)) problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    });
    if (!firstVisit) {
      // Skip the guide's getting-started steps (Ask Temporal's setup, the page tour), which hide
      // the workspace until they're done.
      await page.addInitScript((key) => localStorage.setItem(key, "true"), storageKey("onboarded"));
    }
    await use(page);
    if (problems.length) {
      await testInfo.attach("page-problems", { body: problems.join("\n"), contentType: "text/plain" });
      expect(problems, "the page threw or the site answered 5xx").toEqual([]);
    }
  },
});

// The course's pages in order, as the exercise picker lists them: [{ hash, label }].
export async function coursePages(page) {
  await page.goto("/#/exercise/01-hello-temporal");
  const options = page.locator(".exercise-picker select option:not([disabled])");
  await expect(options.first()).toBeAttached();
  return options.evaluateAll((els) => els.map((el) => ({ hash: el.value, label: el.textContent.trim() })));
}

// The workspace's Code view, as a learner clicks it: an exercise's briefing opens on its
// diagram, with the editor and the terminals behind it.
export async function showCode(page) {
  const tab = page.getByRole("tab", { name: "Code", exact: true });
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
