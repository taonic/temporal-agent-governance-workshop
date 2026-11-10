// The tests' `test`: Playwright's, with a page that fails the test on an uncaught error in the
// site's code or a 5xx from the site itself, whatever the test was looking at.
import { test as base, expect } from "@playwright/test";

import { BASE_URL, SIGNIN_KEY } from "../env.mjs";
import { newLearner } from "./accounts.mjs";

export { expect };

// The site's own keys in local storage (web/src/store.js storageKey).
export const storageKey = (key) => `governed-agents-course:${key}`;

export const test = base.extend({
  // Off by default for a page that has done the getting-started steps: true shows them.
  firstVisit: [false, { option: true }],
  // A page signed in as a new learner of its own (deleted after the test). Needs E2E_SIGNIN_KEY.
  signedIn: [false, { option: true }],

  // The test's learner, when signedIn: { email, api, user, cookies }.
  learner: async ({ signedIn }, use, testInfo) => {
    if (!signedIn) return use(null);
    if (!SIGNIN_KEY) testInfo.skip(true, "needs E2E_SIGNIN_KEY");
    const learner = await newLearner(testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24).replace(/-+$/, ""));
    await use(learner);
    await learner.dispose();
  },

  page: async ({ page, firstVisit, learner }, use, testInfo) => {
    if (learner) {
      await page.context().addCookies(learner.cookies);
      // A signed-in page starts the learner's sandbox on its own: not in these tests (Daytona
      // bills for it). It has none, and starting one does nothing.
      await page.route((url) => ["/api/sandbox", "/api/sandbox/start"].includes(url.pathname), (route) => route.fulfill({ json: { state: "none", message: "" } }));
    }
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

// The home page as a learner who has started sees it: a new one lands on the first-run view
// (one next step), and asks for the whole map.
export async function wholeMap(page) {
  await page.goto("/#/");
  await page.getByRole("button", { name: /Show the whole map/ }).click();
  await expect(page.locator(".map-stage")).toBeVisible();
}

// The course's exercises, as the map's playable nodes name them (each module says which
// exercise shows it), in order: [{ hash, label }].
export async function coursePages(page) {
  await wholeMap(page);
  await page.getByRole("button", { name: "Full map", exact: true }).click();
  const nodes = page.locator(".map-node[data-exercise]");
  await expect(nodes.first()).toBeAttached();
  const ids = await nodes.evaluateAll((els) => [...new Set(els.map((el) => el.dataset.exercise))].sort());
  return ids.map((id) => ({ hash: `#/exercise/${id}`, label: id }));
}

// The workspace's Code view, as a learner clicks it: an exercise's briefing opens on its
// diagram, with the editor and the terminals behind it.
export async function showCode(page) {
  const tab = page.getByRole("tab", { name: "Code", exact: true });
  await expect(tab).toBeVisible();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
