// @auth: a learner's session with the event's access code, without starting a sandbox (so it
// costs nothing on Daytona). Skips without E2E_ACCESS_CODE.
import { request as playwrightRequest } from "@playwright/test";

import { ACCESS_CODE, BASE_URL, INSTRUCTOR_CODE } from "../env.mjs";
import { expect, test } from "./fixtures.mjs";

test.describe("a signed-in learner", { tag: "@auth" }, () => {
  test.skip(!ACCESS_CODE, "needs E2E_ACCESS_CODE");

  // A fresh learner per test: its own cookie jar, signed in through the API.
  let api;
  test.beforeEach(async () => {
    api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const res = await api.post("/api/session", { data: { code: ACCESS_CODE } });
    expect(res.status(), "the access code was refused: is E2E_ACCESS_CODE one of the app's ACCESS_CODE?").toBe(200);
  });
  test.afterEach(async () => {
    await api?.delete("/api/session");
    await api?.dispose();
  });

  test("the session is signed in, for the runtime and Ask Temporal", async () => {
    expect((await (await api.get("/api/session")).json()).authenticated).toBe(true);
    const helper = await (await api.get("/api/helper")).json();
    expect(helper).toMatchObject({ enabled: true, signedIn: true });
  });

  test("a new learner has no sandbox, and can't read files without one", async () => {
    expect(await (await api.get("/api/sandbox")).json()).toMatchObject({ state: "none" });
    expect((await api.get("/api/files?path=hello/workflow.py")).status()).toBe(409);
  });

  test("signing out ends the session", async () => {
    await api.delete("/api/session");
    expect((await (await api.get("/api/session")).json()).authenticated).toBe(false);
    expect((await api.get("/api/sandbox")).status()).toBe(401);
  });

  test("the page knows the learner, and offers to start a sandbox", async ({ browser }) => {
    const context = await browser.newContext({ storageState: await api.storageState() });
    await context.addInitScript(() => localStorage.setItem("governed-agents-course:onboarded", "true"));
    const page = await context.newPage();
    await page.goto("/#/exercise/01-hello-temporal");
    await expect(page.locator(".sandbox-pill")).toHaveText(/No sandbox yet/);
    await expect(page.locator(".dock-status").getByRole("button", { name: "Start my sandbox" })).toBeVisible();
    await context.close();
  });

  test("Ask Temporal answers from the docs", async () => {
    const helper = await (await api.get("/api/helper")).json();
    test.skip(!helper.sharedDocsKey, "the app has no KAPA_API_KEY: each learner signs in to Kapa in a popup, which a test can't do");
    const res = await api.post("/api/helper/ask", {
      data: { messages: [{ role: "user", content: "In one sentence: what is a Temporal activity?" }], context: {} },
      timeout: 120_000,
    });
    expect(res.status()).toBe(200);
    const events = (await res.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.some((e) => e.type === "search" && e.state === "done"), "it searched the docs").toBe(true);
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toMatch(/activit/i);
    expect(events.at(-1)?.type).toBe("done");
  });
});

test.describe("an instructor", { tag: "@auth" }, () => {
  test.skip(!INSTRUCTOR_CODE, "needs E2E_INSTRUCTOR_CODE");

  test("lists the sandboxes", async ({ request }) => {
    const res = await request.get("/api/admin/sandboxes", { headers: { "x-instructor-code": INSTRUCTOR_CODE } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.max).toBeGreaterThan(0);
    expect(Array.isArray(body.sandboxes)).toBe(true);
  });
});
