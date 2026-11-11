// Essentials: Temporal Quest for people who want to understand why Temporal, not write the code (quests/essentials).
//
// @public: a visitor's choice of persona and the map it shows, and an Essentials module asking
// for a sign-in, as every module does.
//
// @auth, signed in with no sandbox: the Trip board plays its recorded walkthrough, a question
// challenge is solved, a module's check isn't passed by moving on, and the persona is kept on the
// server and switched without losing progress.
//
// E2 in a real sandbox (Ship the fix finishes the stuck trip; the plain twin's is lost) is in
// sandbox.spec.mjs, with the rest of the sandbox tier.
import { expect, storageKey, test } from "./fixtures.mjs";

const essentials = (hash) => `/?persona=essentials${hash}`;

// The guide's message types itself out; a click finishes it.
async function settleGuide(page) {
  await page.locator(".guide-bubble").click({ position: { x: 4, y: 4 } });
}

test.describe("Essentials, signed out", { tag: "@public" }, () => {
  test("a new visitor picks \"Why Temporal?\", and the map is Essentials alone", async ({ page }) => {
    await page.goto("/?persona-choice");
    const choice = page.getByRole("dialog", { name: "How do you want to learn Temporal?" });
    await expect(choice).toBeVisible();
    await choice.getByRole("button", { name: /Why Temporal\?/ }).click();
    // Another persona's course is another site: the page loads again, on its map.
    await expect(page.locator(".first-run")).toBeVisible();
    await expect(page.locator('.focus-node[data-module="E1"]')).toHaveClass(/is-next/);
    // Switching is there from the first visit, before any module is done.
    await expect(page.locator(".first-run-persona")).toContainText("Learning as Why Temporal?");
    await page.locator(".first-run-persona").getByRole("button", { name: "Switch" }).click();
    await expect(page.getByRole("dialog", { name: "Switch how you learn" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: /Show the whole map/ }).click();
    await expect(page.locator(".map-persona")).toContainText("Why Temporal?");
    await page.getByRole("button", { name: "Full map", exact: true }).click();
    // Fundamentals and the specializations aren't locked or coming soon: they aren't there.
    for (const id of ["E1", "E5", "E8", "EC1", "EC3"]) await expect(page.locator(`.map-node[data-module="${id}"]`)).toBeVisible();
    for (const id of ["F1", "A1", "N1", "F-boss"]) await expect(page.locator(`.map-node[data-module="${id}"]`)).toHaveCount(0);
    // And it's kept: the next visit asks nothing.
    await page.goto("/?persona-choice");
    await expect(page.locator(".map-persona")).toContainText("Why Temporal?");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("an Essentials module asks for a sign-in, as every module does", async ({ page }) => {
    await page.goto(essentials("#/module/E1"));
    await expect(page.locator(".sign-in-page h2")).toHaveText("Sign in to start this module");
    await expect(page.locator(".trip-board")).toHaveCount(0);
  });
});

test.describe("Essentials, signed in", { tag: "@auth" }, () => {
  test.use({ signedIn: true });

  test("without a sandbox, an Essentials module's board plays its recording", async ({ page }) => {
    await page.goto(essentials("#/module/E5"));
    await expect(page.locator(".sign-in-page")).toHaveCount(0);
    const recording = page.getByRole("group", { name: "A recording of this module" });
    await expect(recording).toBeVisible();
    await expect(recording.getByRole("button", { name: /Start my sandbox to run it yourself|Sign in/ })).toBeVisible();
    await recording.getByRole("button", { name: "Play" }).click();
    await expect(recording.locator(".tb-caption")).toContainText("Started a trip", { timeout: 10_000 });
    // To the end: the plain twin started over and booked twice; the Temporal trip, once.
    const scrub = recording.getByRole("slider", { name: "Where in the recording" });
    await scrub.fill((await scrub.getAttribute("max")) ?? "0");
    await expect(page.locator(".tb-double").first()).toContainText("booked twice, by the plain program");
    await expect(page.locator(".tb-run.is-temporal .tb-status")).toContainText("each one once");
    // A recording is watched, not done: it passes nothing.
    await expect(page.locator(".xp-pill")).toContainText("0 XP");
  });

  test("a question challenge plays without a sandbox: misses struck with why, a hint, then every answer", async ({ page }) => {
    await page.goto(essentials("#/module/EC1"));
    await settleGuide(page);
    const card = page.locator(".question-card");
    await expect(card.locator(".challenge-meta")).toContainText("up to 20 XP");
    const choice = (text) => card.locator(".challenge-choice", { hasText: text });
    await choice("Try three times").click();
    await expect(choice("Try three times")).toHaveClass(/is-struck/);
    await expect(card.locator(".qc-why")).toHaveCount(1);
    await expect(card.locator(".challenge-hint")).toHaveCount(0);
    await choice("straight away").click();
    await expect(card.locator(".challenge-hint")).toContainText("Hint:");
    await choice("waiting a little longer each time").click();
    await expect(choice("waiting a little longer each time")).toHaveClass(/is-right/);
    await expect(card.locator(".qc-why")).toHaveCount(3);
    await expect(card.locator(".challenge-meta")).toContainText("solved, +2 XP");
    await expect(page.locator(".xp-pill")).toContainText("2 XP");
  });

  test("a module's check waits for the board, whatever the guide's buttons say", async ({ page }) => {
    // Moving past a module doesn't pass it: its check does (the board, and its one question).
    await page.goto(essentials("#/module/E1"));
    for (let i = 0; i < 6 && !(await page.locator(".module-check").count()); i++) {
      await settleGuide(page);
      await page.locator(".guide-replies .guide-reply:not(.is-back)").last().click();
    }
    const check = page.locator(".module-check");
    await expect(check).toContainText("Run a trip from start to finish.");
    await expect(check).toContainText("Start your sandbox to run it.");
    await check.locator(".challenge-choice", { hasText: "They read the logbook" }).click();
    await expect(check.locator(".mc-part.is-done")).toHaveCount(1);
    await expect(check.locator(".mc-done")).toHaveCount(0);
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), storageKey("modules"))).not.toContain("E1");
  });

  test("the persona is kept on the server, and switching keeps the learner's progress", async ({ page, learner }) => {
    const progress = async () => (await learner.api.get("/api/progress")).json();
    await page.goto(essentials("#/module/EC1"));
    await settleGuide(page);
    await page.locator(".question-card .challenge-choice", { hasText: "waiting a little longer each time" }).click();
    await expect(page.locator(".xp-pill")).toContainText("20 XP");
    await expect.poll(async () => (await progress()).persona).toBe("essentials");
    await expect.poll(async () => (await progress()).completed).toContain("EC1");

    // To the developer track, from the account menu: another map, the same XP.
    await page.goto("/#/");
    await page.locator(".account-button").click();
    await page.getByRole("menuitem", { name: /Learning as/ }).click();
    await page.getByRole("dialog", { name: "Switch how you learn" }).getByRole("button", { name: /I build software/ }).click();
    await expect(page.locator(".xp-pill")).toContainText("20 XP");
    await expect(page.locator('[data-module="F1"]').first()).toBeVisible();
    await expect(page.locator('[data-module="E1"]')).toHaveCount(0);
    await expect.poll(async () => (await progress()).persona).toBe("developer");

    // And back: EC1 is still solved.
    await page.goto(essentials("#/module/EC1"));
    await settleGuide(page);
    await expect(page.locator(".question-card .challenge-meta")).toContainText("solved, +20 XP");
  });
});
