// @public: what anyone on the internet gets, signed out. No secrets, nothing created.
import { coursePages, expect, test } from "./fixtures.mjs";

test.describe("the /api, signed out", { tag: "@public" }, () => {
  test("health: up, with the browser runtime on", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.runtime.enabled, "the browser runtime is off: check the app's DAYTONA_API_KEY and ACCESS_CODE secrets").toBe(true);
  });

  test("session: an access code is required and nobody is signed in", async ({ request }) => {
    const body = await (await request.get("/api/session")).json();
    expect(body.runtime).toMatchObject({ enabled: true, codeRequired: true });
    expect(body.helper.enabled, "Ask Temporal is off: check GEMINI_API_KEY").toBe(true);
    expect(body.authenticated).toBe(false);
  });

  test("a wrong access code is refused", async ({ request }) => {
    const res = await request.post("/api/session", { data: { code: `not-the-code-${Date.now()}` } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/access code/i);
    expect(res.headers()["set-cookie"]).toBeUndefined();
  });

  for (const [method, path] of [
    ["GET", "/api/sandbox"],
    ["POST", "/api/sandbox/start"],
    ["GET", "/api/files?path=hello/workflow.py"],
    ["POST", "/api/helper/ask"],
  ]) {
    test(`${method} ${path.split("?")[0]} needs a session`, async ({ request }) => {
      const res = await request.fetch(path, { method, data: method === "POST" ? {} : undefined });
      expect(res.status()).toBe(401);
    });
  }

  test("the instructors' list needs the instructor code", async ({ request }) => {
    const res = await request.get("/api/admin/sandboxes", { headers: { "x-instructor-code": "wrong" } });
    expect(res.status()).toBe(403);
  });

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

  test("home: the title, and Start opens exercise 1", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator(".hero h1")).toHaveText(/Reliable AI Agents/);
    await expect(page.locator(".hero-note")).toContainText("your own sandbox");
    await page.getByRole("button", { name: /Start the workshop/ }).click();
    await expect(page).toHaveURL(/#\/exercise\/01-/);
    await expect(page.locator(".guide-heading-title")).toContainText("Hello Temporal");
  });

  test("a first visit opens with the getting-started steps", async ({ browser }) => {
    // A fresh context without the fixture's "onboarded" flag.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/#/exercise/01-hello-temporal");
    await expect(page.locator(".exercise-shell.guide-only")).toBeVisible();
    await expect(page.locator(".guide-replies")).toContainText(/Skip for now|Next/);
    await context.close();
  });

  test("setup: the guide to running it locally", async ({ page }) => {
    await page.goto("/#/setup");
    await expect(page.locator(".reading .eyebrow")).toHaveText("Set up on your machine");
    await expect(page.locator(".reading")).toContainText("uv sync");
  });

  test("every page in the picker opens", async ({ page }) => {
    const pages = await coursePages(page);
    const exercises = pages.filter((p) => p.hash.startsWith("#/exercise/"));
    expect(exercises.length, "the picker lists the exercises").toBeGreaterThanOrEqual(4);
    for (const { hash, label } of exercises) {
      await test.step(label, async () => {
        await page.goto(`/${hash}`);
        const title = label.split(": ").slice(1).join(": ").trim();
        await expect(page.locator(".guide-heading-title")).toContainText(title);
        // The guide's first message, the editor and the terminal dock.
        await expect(page.locator(".guide-msg .guide-title")).not.toBeEmpty();
        await expect(page.locator(".guide-replies button").first()).toBeVisible();
        await expect(page.locator("[data-tour='editor']")).toBeVisible();
        await expect(page.locator(".cm-content").first()).toContainText(/\S/);
        await expect(page.locator(".terminal-dock")).toBeVisible();
      });
    }
  });

  test("Previous and Next walk the course in order", async ({ page }) => {
    // From the setup guide: the home page (the picker's first) has no Previous or Next.
    const pages = (await coursePages(page)).filter((p) => p.hash !== "#/");
    const at = (hash) => expect(page).toHaveURL(new RegExp(`${hash.replace(/[/#]/g, "\\$&")}$`));
    await page.goto(`/${pages[0].hash}`);
    for (const next of pages.slice(1)) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await at(next.hash);
    }
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await at(pages.at(-2).hash);
  });

  test("an exercise offers the sandbox behind the access code", async ({ page }) => {
    await page.goto("/#/exercise/01-hello-temporal");
    await expect(page.locator(".sandbox-pill")).toHaveText(/Browser sandbox/);
    const status = page.locator(".dock-status .sandbox-status");
    await expect(status).toContainText("Run the workshop in your browser");
    await expect(status.locator("#access-code")).toBeVisible();
    // The Agent UI and Temporal UI tabs wait for a sandbox.
    await expect(page.getByRole("tab", { name: "Temporal UI" })).toBeDisabled();
  });

  test("a wrong access code says so in the form", async ({ page }) => {
    await page.goto("/#/exercise/01-hello-temporal");
    const form = page.locator(".dock-status .access-form");
    await form.locator("#access-code").fill(`not-the-code-${Date.now()}`);
    await form.getByRole("button", { name: "Start my sandbox" }).click();
    await expect(form.locator(".form-error")).toHaveText(/isn't this workshop's access code/);
    await expect(page.locator(".sandbox-pill")).toHaveText(/Browser sandbox/);
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
