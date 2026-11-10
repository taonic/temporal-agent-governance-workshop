// @public: what anyone on the internet gets, signed out: the map, the setup page, and a module
// page asking them to sign in. No secrets, nothing created.
//
// Then, @auth: the module pages themselves, which need a sign-in, each as a new learner of its
// own (signedIn, fixtures.mjs). They skip without E2E_SIGNIN_KEY.
import { coursePages, expect, showCode, storageKey, test, wholeMap } from "./fixtures.mjs";

test.describe("the /api, signed out", { tag: "@public" }, () => {
  test("health: up, with the browser runtime on", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.runtime.enabled, "the browser runtime is off: check the app's DAYTONA_API_KEY and RESEND_API_KEY secrets").toBe(true);
  });

  test("session: signing in is on, and nobody is signed in", async ({ request }) => {
    const body = await (await request.get("/api/session")).json();
    expect(body.runtime).toMatchObject({ enabled: true });
    expect(body.signIn, "signing in is off: check RESEND_API_KEY").toMatchObject({ enabled: true, console: false });
    expect(body.helper.enabled, "Ask Temporal is off: check GEMINI_API_KEY").toBe(true);
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  test("a personal email is asked for a company one, and sent no code", async ({ request }) => {
    const res = await request.post("/api/auth/start", { data: { email: `someone.${Date.now()}@gmail.com` } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: "personal_email" });
  });

  test("a code that was never sent is refused, and signs nobody in", async ({ request }) => {
    const res = await request.post("/api/auth/verify", { data: { email: `nobody.${Date.now()}@example.com`, code: "123456" } });
    expect(res.status()).toBe(400);
    expect(res.headers()["set-cookie"]).toBeUndefined();
  });

  test("a session from the old access code is no longer one", async ({ request }) => {
    const res = await request.get("/api/session", { headers: { cookie: "course_session=aePdEQ4znJYS9FFP.c2lnbmF0dXJl" } });
    expect((await res.json()).authenticated).toBe(false);
  });

  for (const [method, path] of [
    ["GET", "/api/sandbox"],
    ["POST", "/api/sandbox/start"],
    ["GET", "/api/files?path=hello/workflow.py"],
    ["POST", "/api/helper/ask"],
    ["GET", "/api/progress"],
    ["POST", "/api/events"],
    ["POST", "/api/heartbeat"],
    ["GET", "/api/admin/learners"],
    ["GET", "/api/admin/sandboxes"],
  ]) {
    test(`${method} ${path.split("?")[0]} needs a session`, async ({ request }) => {
      const res = await request.fetch(path, { method, data: method === "POST" ? {} : undefined });
      expect(res.status()).toBe(401);
    });
  }

  test("the model passthrough refuses a request without a sandbox key", async ({ request }) => {
    const res = await request.post("/llm/v1/chat/completions", { data: { model: "x", messages: [] } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("an unknown /api route is a JSON 404", async ({ request }) => {
    const res = await request.get("/api/no-such-route");
    expect(res.status()).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});

test.describe("the site, signed out", { tag: "@public" }, () => {
  test("static files: the page revalidates, hashed assets are cached for good", async ({ request }) => {
    const index = await request.get("/");
    expect(index.status()).toBe(200);
    expect(index.headers()["cache-control"]).toBe("no-cache");
    const html = await index.text();
    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    expect(asset, "index.html links no /assets/*.js").toBeTruthy();
    const res = await request.get(asset);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("immutable");
  });

  test("home: a beginner's first-run view, F1 next, then the whole map, and Start opens it", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    // First run: one next step. Fundamentals' first tier, F1's card, and where it leads as chips.
    const firstRun = page.locator(".first-run");
    await expect(firstRun.locator("h1")).toHaveText("Your quest starts here");
    await expect(firstRun.locator('.focus-node[data-module="F1"]')).toHaveClass(/is-next/);
    await expect(firstRun.locator(".first-run-card")).toContainText("Nothing. You can start here.");
    await expect(firstRun.locator(".first-run-chip")).toHaveCount(5);
    await expect(page.locator(".map-legend, .map-toolbar")).toHaveCount(0);
    await page.getByRole("button", { name: /Show the whole map/ }).click();
    await expect(page.locator(".map-player h1")).toHaveText("Your skill tree");
    // Focused: Fundamentals' first tier, named, then the five specializations as destinations.
    await expect(page.locator(".focus-map")).toBeVisible();
    await expect(page.locator('.focus-node[data-module="F1"]')).toHaveClass(/is-next/);
    await expect(page.locator('.focus-node[data-module="F1"]')).toContainText("Run it, and see it stop");
    await expect(page.locator(".focus-branch")).toHaveCount(5);
    // The detail panel answers what, how long and what first, without a hover.
    const detail = page.locator(".map-detail-selected");
    await expect(detail).toContainText("What you'll learn");
    await expect(detail).toContainText("About 7 min");
    await expect(detail).toContainText("Nothing. You can start here.");
    // A click on the node makes its call to action glow.
    await page.locator('.focus-node[data-module="F1"]').click();
    await expect(detail.locator(".node-detail-go")).toHaveClass(/is-glowing/);
    // The full map: every branch, and its boss.
    await page.getByRole("button", { name: "Full map", exact: true }).click();
    await expect(page.locator(".map-node:has(.kind-boss)")).toHaveCount(6);
    // Signed out, a module asks for a sign-in in its place.
    await page.getByRole("link", { name: /Start F1/ }).click();
    await expect(page).toHaveURL(/#\/module\/F1$/);
    await expect(page.locator(".sign-in-page h2")).toHaveText("Sign in to start this module");
    await expect(page.locator(".guide-heading-title")).toHaveCount(0);
  });

  test("a module page asks for a work email, and a personal one is asked for a company one", async ({ page }) => {
    await page.goto("/#/exercise/01-hello-temporal");
    const form = page.locator(".sign-in-page .access-form");
    await expect(form.locator("#access-email")).toBeVisible();
    await expect(page.locator("[data-tour='editor']")).toHaveCount(0);
    await form.locator("#access-email").fill(`someone.${Date.now()}@gmail.com`);
    await form.getByRole("button", { name: "Email me a code" }).click();
    await expect(form.locator(".form-error")).toContainText("company email");
  });

  test("the admin panel asks for a sign-in", async ({ page }) => {
    await page.goto("/#/admin");
    await expect(page.locator(".sign-in-page h2")).toHaveText("Sign in");
    await expect(page.locator(".admin-page")).toHaveCount(0);
  });

  test("a specialization card expands its map in place, and shows the way there on the full map", async ({ page }) => {
    await wholeMap(page);
    await page.locator(".focus-branch", { hasText: "Architecture & Nexus" }).click();
    // In place: what comes before it, then its own modules, its boss at the end.
    const expanded = page.locator(".focus-expanded");
    await expect(expanded).toContainText("Fundamentals");
    await expect(expanded.locator(".focus-before")).toContainText("A4");
    for (const id of ["N1", "N5", "N-boss"]) await expect(expanded.locator(`[data-module="${id}"]`)).toBeVisible();
    await expect(page.locator(".map-detail-selected")).toContainText("Meet the other team");
    await showOnFullMap(page);
  });

  async function showOnFullMap(page) {
    await page.locator(".focus-expanded").getByRole("button", { name: /On the full map/ }).click();
    await expect(page.locator(".skill-map")).toBeVisible();
    await expect(page.locator(".map-toward")).toContainText("Architecture & Nexus");
    // Its modules, and what they build on (A4 back to A2, then F7 back to F1), stay lit; the rest
    // steps back, Code Mode (A1) included: Nexus doesn't build on it.
    for (const id of ["N1", "N5", "A4", "A2", "F7", "F1"]) await expect(page.locator(`.map-node[data-module="${id}"]`)).not.toHaveClass(/off-route/);
    for (const id of ["A1", "A5", "P1", "F8"]) await expect(page.locator(`.map-node[data-module="${id}"]`)).toHaveClass(/off-route/);
    await expect(page.locator(".map-detail-selected")).toContainText("Meet the other team");
    await page.getByRole("button", { name: "Show the whole tree" }).click();
    await expect(page.locator(".map-node.off-route")).toHaveCount(0);
  }

  test("the focused view follows the next step out of the first tier", async ({ page }) => {
    await page.addInitScript(([key, view]) => {
      localStorage.setItem(key, JSON.stringify(["F1", "F2", "F3", "F4", "F5", "FC1", "F6", "F7", "FC2"]));
      localStorage.setItem(view, JSON.stringify("focus"));
    }, [storageKey("modules"), storageKey("map-view")]);
    await page.goto("/");
    await expect(page.locator(".focus-head")).toContainText("Where you are");
    await expect(page.locator(".focus-head")).toContainText("Building blocks");
    await expect(page.locator('.focus-node[data-module="F8"]')).toHaveClass(/is-next/);
    // Its last tier: the trail ends with the branch's boss.
    await expect(page.locator('.focus-node[data-module="F-boss"]')).toBeVisible();
    // The first tier is a tab away, and back.
    await page.getByRole("tab", { name: /Tier I · Durable execution/ }).click();
    await expect(page.locator('.focus-node[data-module="F1"]')).toHaveClass(/is-done/);
    await expect(page.locator('.focus-node[data-module="F8"]')).toHaveCount(0);
    await page.getByRole("button", { name: /Back to where you are/ }).click();
    await expect(page.locator('.focus-node[data-module="F8"]')).toHaveClass(/is-next/);
  });

  test("a finished tier's badge shows on the map and the shelf, and the next tier's says what earns it", async ({ page }) => {
    await page.addInitScript(([key, view]) => {
      localStorage.setItem(key, JSON.stringify(["F1", "F2", "F3", "F4", "F5", "FC1", "F6", "F7", "FC2"]));
      localStorage.setItem(view, JSON.stringify("focus"));
    }, [storageKey("modules"), storageKey("map-view")]);
    await page.goto("/");
    await expect(page.locator(".focus-reward")).toContainText("Finish this tier to earn Blocksmith");
    await page.getByRole("button", { name: "Full map", exact: true }).click();
    await expect(page.locator('.map-tier-badge[data-badge="fundamentals-1"]')).toHaveAttribute("data-earned", "true");
    await expect(page.locator('.map-tier-badge[data-badge="fundamentals-2"]')).not.toHaveAttribute("data-earned");
    // The top bar's pill opens the shelf.
    await page.locator(".xp-pill").click();
    await expect(page).toHaveURL(/#\/badges$/);
    await expect(page.locator(".badges-head h1")).toContainText("of 19 earned");
    const earned = page.locator('.badge-card[data-badge="fundamentals-1"]');
    await expect(earned).toContainText("Survived the Crash");
    await expect(earned).toContainText("Earned");
    const next = page.locator('.badge-card[data-badge="fundamentals-2"]');
    await expect(next).toHaveClass(/is-locked/);
    await expect(next).toContainText("Pass F8–F13 and FC3");
    await expect(page.locator('.badge-card[data-badge="fundamentals-boss"]')).toContainText("Coming soon");
  });

  test("selecting a node says what it needs first, and one coming soon can't be entered", async ({ page }) => {
    await wholeMap(page);
    await page.getByRole("button", { name: "Full map", exact: true }).click();
    const detail = page.locator(".map-detail-selected");
    await page.locator('.map-node[data-module="A4"]').click();
    await expect(page).toHaveURL(/#\/$|\/$/);
    await expect(detail).toContainText("A broken tool pauses the session");
    await expect(detail).toContainText("Locked");
    await expect(detail).toContainText("A3");
    await expect(detail.getByRole("link", { name: /Start with F1/ })).toBeVisible();
    await expect(detail.getByRole("link", { name: "Skip ahead to A4" })).toHaveAttribute("href", "#/module/A4");
    await page.locator('.map-node[data-module="P1"]').click();
    await expect(detail).toContainText("Coming soon");
    await expect(detail.getByRole("link", { name: /Start|Skip ahead/ })).toHaveCount(0);
  });

  test("setup: the guide to running it locally", async ({ page }) => {
    await page.goto("/#/setup");
    await expect(page.locator(".reading .eyebrow")).toHaveText("Set up on your machine");
    await expect(page.locator(".reading")).toContainText("uv sync");
  });

  test("the theme toggle switches and is remembered", async ({ page }) => {
    await page.goto("/#/setup");
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");
    await page.locator(".theme-toggle").click();
    const after = before === "dark" ? "light" : "dark";
    await expect(html).toHaveAttribute("data-theme", after);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after);
  });
});

test.describe("a module, signed in", { tag: "@auth" }, () => {
  test.use({ signedIn: true });

  test.describe("a first visit", () => {
    test.use({ firstVisit: true });
    test("opens with the getting-started steps", async ({ page }) => {
      await page.goto("/#/exercise/01-hello-temporal");
      await expect(page.locator(".exercise-shell.guide-only")).toBeVisible();
      await expect(page.locator(".guide-replies")).toContainText(/Skip for now|Next/);
    });
  });


  test("every exercise on the map opens", async ({ page }) => {
    const pages = await coursePages(page);
    const exercises = pages.filter((p) => p.hash.startsWith("#/exercise/"));
    expect(exercises.length, "the map's modules make up the exercises").toBeGreaterThanOrEqual(4);
    for (const { hash, label } of exercises) {
      await test.step(label, async () => {
        await page.goto(`/${hash}`);
        await expect(page.locator(".guide-heading-title")).not.toBeEmpty();
        await expect(page.locator(".module-crumb-title")).not.toBeEmpty();
        // The guide's first message; the briefing's diagram, if it has one, where the code goes;
        // then the editor and the terminal dock.
        await expect(page.locator(".guide-msg .guide-title")).not.toBeEmpty();
        await expect(page.locator(".guide-replies button").first()).toBeVisible();
        if (await page.getByRole("tab", { name: "Diagram", exact: true }).count()) {
          await expect(page.locator("iframe.diagram-frame"), "the briefing should open on its diagram").toBeVisible();
          await expect(page.locator("[data-tour='editor']")).toBeHidden();
        }
        await showCode(page);
        await expect(page.locator("[data-tour='editor']")).toBeVisible();
        await expect(page.locator(".cm-content").first()).toContainText(/\S/);
        await expect(page.locator(".terminal-dock")).toBeVisible();
      });
    }
  });

  test("a challenge: a wrong pick is struck out with what happened, the right one earns its XP and shows every choice", async ({ page }) => {
    // Without a sandbox, each pick plays its recorded run.
    await page.goto("/#/module/FC1");
    const challenge = page.locator(".challenge");
    await expect(challenge).toBeVisible();
    await expect(challenge.locator(".challenge-meta")).toContainText("up to 20 XP");
    await challenge.locator(".challenge-choice", { hasText: "Give up after three attempts" }).click();
    await expect(challenge.locator(".challenge-diff")).toContainText("maximum_attempts=3");
    await challenge.getByRole("button", { name: "Lock in A and run it" }).click();
    const wrong = challenge.locator(".challenge-outcome.is-wrong");
    await expect(wrong).toContainText("ran out of attempts", { timeout: 15_000 });
    await expect(wrong).toContainText("attempt 3: 503");
    await expect(wrong.getByRole("button", { name: /Ask Temporal about this/ })).toBeVisible();
    await expect(challenge.locator(".challenge-choice.is-struck")).toHaveCount(1);
    await expect(challenge.locator(".challenge-choice", { hasText: "Give up after three attempts" })).toBeDisabled();

    await challenge.locator(".challenge-choice", { hasText: "Retry with a backoff" }).click();
    await challenge.getByRole("button", { name: "Lock in C and run it" }).click();
    await expect(challenge.locator(".challenge-outcome.is-right")).toContainText("got through", { timeout: 15_000 });
    // Solved on the second pick: 10 XP, and every choice side by side.
    await expect(challenge.locator(".challenge-meta")).toContainText("solved, +10 XP");
    await expect(challenge.locator(".challenge-outcome")).toHaveCount(3);
    const attempts = await page.evaluate(() => JSON.parse(localStorage.getItem("governed-agents-course:attempts")));
    expect(attempts.FC1).toEqual(["A", "C"]);
    // The server has the picks too: the learner's progress follows them to another browser.
    await expect.poll(async () => (await (await page.request.get("/api/progress")).json()).attempts.FC1).toEqual(["A", "C"]);
    // On the map, it's done: a tick, between F5 and F6.
    await page.goto("/#/");
    await expect(page.locator('[data-module="FC1"]').first()).toHaveClass(/is-done/);
  });

  test("Next walks a branch, a path's Next follows the path, and Map goes back", async ({ page }) => {
    const next = page.getByRole("link", { name: "Next", exact: true });
    await page.goto("/#/module/F5");
    // A challenge sits between F5 and F6, and Next goes through it.
    await next.click();
    await expect(page).toHaveURL(/#\/module\/FC1$/);
    await next.click();
    await expect(page).toHaveURL(/#\/module\/F6$/);
    await expect(page.locator(".module-crumb-title")).toContainText("F6");
    await next.click();
    await expect(page).toHaveURL(/#\/module\/F7$/);
    await next.click();
    await expect(page).toHaveURL(/#\/module\/FC2$/);
    // From the first tier's end into the second's: another exercise's page.
    await next.click();
    await expect(page).toHaveURL(/#\/module\/F8$/);
    await expect(page.locator(".module-crumb-title")).toContainText("F8");
    // F13 ends the trunk: no Next.
    await page.goto("/#/module/F13");
    await expect(page.locator(".module-crumb-title")).toContainText("F13");
    await expect(next).toHaveCount(0);
    // On the 4-hour path, the agent's first tier leads to Nexus, not to approval.
    await page.goto("/?path=agent-governance-4h#/module/A7");
    await next.click();
    await expect(page).toHaveURL(/#\/module\/N1$/);
    await page.getByRole("link", { name: "Map", exact: true }).click();
    // Nothing completed yet (Next doesn't complete a module): the first-run view, then the map.
    await page.getByRole("button", { name: /Show the whole map/ }).click();
    await expect(page.locator(".map-player h1")).toBeVisible();
    await expect(page.locator(".map-path-pick select")).toHaveValue("agent-governance-4h");
  });

  test("Ask Temporal opens from the top bar and closes with Esc", async ({ page }) => {
    await page.goto("/#/exercise/01-hello-temporal");
    const button = page.locator("button[data-tour='ask']");
    await button.click();
    const panel = page.getByRole("complementary", { name: "Ask Temporal" });
    await expect(panel).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.locator(".guide-heading-title").click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
