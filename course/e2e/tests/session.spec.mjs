// @auth: signed-in learners and the admin, without starting a sandbox (so it costs nothing on
// Daytona). Each test's learner is new, put on the allowlist by the tests' admin and deleted
// after. Skips without E2E_SIGNIN_KEY; the admin's tests skip when E2E_ADMIN_EMAIL isn't one of
// the app's ADMIN_EMAILS.
import { ADMIN_EMAIL, SIGNIN_KEY, e2eCode, learnerEmail } from "../env.mjs";
import { E2E_COHORT, adminApi, allow, deleteLearner, e2eCohort, learnerId, newLearner, signInApi } from "./accounts.mjs";
import { expect, showCode, test } from "./fixtures.mjs";

test.describe("a signed-in learner", { tag: "@auth" }, () => {
  test.skip(!SIGNIN_KEY, "needs E2E_SIGNIN_KEY");

  let learner;
  test.beforeEach(async () => {
    learner = await newLearner("session");
  });
  test.afterEach(async () => {
    await learner?.dispose();
  });

  test("the session is signed in, for the runtime and Ask Temporal", async () => {
    const session = await (await learner.api.get("/api/session")).json();
    expect(session.authenticated).toBe(true);
    expect(session.user).toMatchObject({ email: learner.email, allowed: true, needsProfile: false, admin: false, cohort: { name: E2E_COHORT } });
    const helper = await (await learner.api.get("/api/helper")).json();
    expect(helper).toMatchObject({ enabled: true, signedIn: true });
  });

  test("a new learner has no sandbox, and can't read files without one", async () => {
    expect(await (await learner.api.get("/api/sandbox")).json()).toMatchObject({ state: "none", allowance: { limitMinutes: 480 } });
    expect((await learner.api.get("/api/files?path=hello/workflow.py")).status()).toBe(409);
  });

  test("signing out ends the session", async () => {
    await learner.api.delete("/api/session");
    expect((await (await learner.api.get("/api/session")).json()).authenticated).toBe(false);
    expect((await learner.api.get("/api/sandbox")).status()).toBe(401);
  });

  test("progress is kept on the server: this browser's is imported once, and events add to it", async () => {
    const imported = await (await learner.api.post("/api/progress/import", { data: { completed: ["F1", "F2"], attempts: { FC1: ["A", "C"] } } })).json();
    expect(imported).toMatchObject({ completed: ["F1", "F2"], attempts: { FC1: ["A", "C"] } });
    await learner.api.post("/api/events", { data: { events: [{ type: "module_passed", moduleId: "F3" }, { type: "module_passed", moduleId: "NOT-A-MODULE" }] } });
    // A second import (another browser) adds nothing.
    await learner.api.post("/api/progress/import", { data: { completed: ["F4"] } });
    expect((await (await learner.api.get("/api/progress")).json()).completed).toEqual(["F1", "F2", "F3"]);
  });

  test("the page knows the learner, and starts their sandbox without asking", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addCookies(learner.cookies);
    await context.addInitScript(() => localStorage.setItem("governed-agents-course:onboarded", "true"));
    const page = await context.newPage();
    // The runner's answers, stubbed: this tier starts no real sandbox.
    let started = 0;
    await page.route((url) => url.pathname === "/api/sandbox", (route) => route.fulfill({ json: { state: started ? "creating" : "none", message: "Creating your sandbox…" } }));
    await page.route((url) => url.pathname === "/api/sandbox/start", (route) => {
      started++;
      return route.fulfill({ json: { state: "creating", message: "Creating your sandbox…" } });
    });
    await page.goto("/#/exercise/01-hello-temporal");
    await expect.poll(() => started, { message: "a signed-in learner with no sandbox should get one started" }).toBeGreaterThan(0);
    await expect(page.locator(".sandbox-pill")).not.toHaveText(/No sandbox yet/);
    await expect(page.locator(".account-button")).toContainText("E2E Learner");
    await showCode(page);
    await expect(page.locator(".dock-status").getByRole("button", { name: "Start my sandbox" })).toHaveCount(0);
    await context.close();
  });

  test("Ask Temporal answers from the docs", async () => {
    const helper = await (await learner.api.get("/api/helper")).json();
    test.skip(!helper.sharedDocsKey, "the app has no KAPA_API_KEY: each learner signs in to Kapa in a popup, which a test can't do");
    const res = await learner.api.post("/api/helper/ask", {
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

test.describe("signing in through the page", { tag: "@auth" }, () => {
  test.skip(!SIGNIN_KEY, "needs E2E_SIGNIN_KEY");

  test("a module asks for a sign-in, then a name and role, and opens where it was", async ({ page }) => {
    const email = learnerEmail("page");
    await allow(email);
    try {
      await page.route((url) => ["/api/sandbox", "/api/sandbox/start"].includes(url.pathname), (route) => route.fulfill({ json: { state: "none", message: "" } }));
      await page.goto("/#/module/F2");
      const form = page.locator(".sign-in-page .access-form");
      await form.locator("#access-email").fill(email);
      await form.getByRole("button", { name: "Email me a code" }).click();
      await form.locator("#access-code").fill(e2eCode(email));
      await form.getByRole("button", { name: "Sign in" }).click();
      await form.locator("#access-name").fill("Page Learner");
      await form.locator("#access-role").selectOption("Architect");
      await form.getByRole("button", { name: "Sign in" }).click();
      await expect(page.locator(".module-crumb-title")).toContainText("F2");
      await expect(page.locator(".account-button")).toContainText("Page Learner");
    } finally {
      await deleteLearner(email);
    }
  });
});

test.describe("an access request", { tag: "@auth" }, () => {
  test.skip(!SIGNIN_KEY, "needs E2E_SIGNIN_KEY");

  test("an unlisted company email asks, waits, and is let in when an admin approves it", async () => {
    const admin = await adminApi();
    test.skip(!admin.ok, `${ADMIN_EMAIL} isn't one of the app's ADMIN_EMAILS`);
    const email = learnerEmail("request");
    const { api } = await signInApi(email, { profile: null });
    try {
      const session = await (await api.post("/api/auth/profile", { data: { name: "Asking Learner", role: "Architect" } })).json();
      expect(session).toMatchObject({ authenticated: false, user: { allowed: false, request: { status: "pending" } } });
      expect((await api.get("/api/progress")).status()).toBe(403);
      const { requests } = await (await admin.api.get("/api/admin/requests?internal=1")).json();
      const request = requests.find((r) => r.email === email);
      expect(request).toMatchObject({ status: "pending", name: "Asking Learner", role: "Architect", domain: "temporalquest.dev" });
      expect((await admin.api.post("/api/admin/requests/decide", { data: { id: request.id, approve: true, scope: "email" } })).status()).toBe(200);
      const after = await (await api.get("/api/session")).json();
      expect(after).toMatchObject({ authenticated: true, user: { cohort: { name: "On-demand" } } });
    } finally {
      await api.dispose();
      await deleteLearner(email);
    }
  });
});

test.describe("the admin", { tag: "@auth" }, () => {
  test.skip(!SIGNIN_KEY, "needs E2E_SIGNIN_KEY");
  let admin;
  test.beforeAll(async () => {
    admin = await adminApi();
  });
  test.beforeEach(() => test.skip(!admin.ok, `${ADMIN_EMAIL} isn't one of the app's ADMIN_EMAILS`));

  test("lists the sandboxes", async () => {
    const body = await (await admin.api.get("/api/admin/sandboxes")).json();
    expect(body.max).toBeGreaterThan(0);
    expect(Array.isArray(body.sandboxes)).toBe(true);
  });

  test("adds an email to a cohort in /admin, and that email can sign in", async ({ browser }) => {
    const email = learnerEmail("panel");
    const context = await browser.newContext();
    await context.addCookies((await admin.api.storageState()).cookies);
    const page = await context.newPage();
    try {
      await e2eCohort(admin.api);
      await page.goto("/#/admin/cohorts");
      await page.locator(".cohort-item", { hasText: E2E_COHORT }).click();
      await page.locator(".admin-form textarea").fill(email);
      await page.getByRole("button", { name: `Add to ${E2E_COHORT}` }).click();
      await expect(page.locator(".admin-table code", { hasText: email })).toBeVisible();
      const { api, user } = await signInApi(email);
      expect(user.allowed).toBe(true);
      await api.dispose();
    } finally {
      await context.close();
      await deleteLearner(email);
    }
  });

  test("sees a learner's journey: where they are, what they passed, and blocking signs them out", async () => {
    const learner = await newLearner("journey");
    try {
      await learner.api.post("/api/events", { data: { events: [{ type: "module_opened", moduleId: "F1" }, { type: "module_passed", moduleId: "F1" }, { type: "module_opened", moduleId: "F2" }] } });
      await learner.api.post("/api/heartbeat", { data: { moduleId: "F2" } });
      const id = await learnerId(learner.email);
      const { learners } = await (await admin.api.get("/api/admin/learners?internal=1")).json();
      expect(learners.find((l) => l.id === id)).toMatchObject({ completed: 1, where: { moduleId: "F2", active: true } });
      const journey = await (await admin.api.get(`/api/admin/learner?id=${id}`)).json();
      expect(journey.passed.map((m) => m.id)).toEqual(["F1"]);
      expect(journey.timeline.some((e) => e.type === "module_opened" && e.moduleId === "F2")).toBe(true);
      const csv = await (await admin.api.get("/api/admin/learners.csv?internal=1")).text();
      expect(csv).toContain(learner.email);
      await admin.api.post("/api/admin/learner", { data: { id, status: "blocked" } });
      expect((await (await learner.api.get("/api/session")).json()).authenticated).toBe(false);
    } finally {
      await learner.dispose();
    }
  });

  test("a learner isn't an admin", async () => {
    const learner = await newLearner("notadmin");
    try {
      expect((await learner.api.get("/api/admin/learners")).status()).toBe(403);
    } finally {
      await learner.dispose();
    }
  });
});
