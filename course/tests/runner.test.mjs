import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codeMatches,
  codeMatchesAny,
  learnerFromRequest,
  llmKey,
  newLearnerId,
  parseCodes,
  parseCookies,
  sessionCookie,
  sessionToken,
  verifyLlmKey,
  verifySessionToken,
} from "../runner/auth.mjs";
import { RateLimiter } from "../runner/ratelimit.mjs";
import { envDiffers, isSafePath, parseLlmMode, parseTrip, SandboxManager, sandboxEnv } from "../runner/sandboxes.mjs";

const SECRET = "test-secret";

test("a session token verifies to its learner, and only with the right secret", () => {
  const id = newLearnerId();
  const token = sessionToken(SECRET, id);
  assert.equal(verifySessionToken(SECRET, token), id);
  assert.equal(verifySessionToken("other", token), null);
  assert.equal(verifySessionToken(SECRET, `${id}.forged`), null);
  assert.equal(verifySessionToken(SECRET, "garbage"), null);
});

test("model keys verify for ids and signatures containing _ and -", () => {
  for (const id of ["a_b-c_d-efgh", "aePdEQ4znJYS9FFP", "x".repeat(16), newLearnerId()]) {
    assert.equal(verifyLlmKey(SECRET, llmKey(SECRET, id)), id, id);
  }
  // Many random ids, so signatures with "_" and "-" are covered too.
  for (let i = 0; i < 200; i++) {
    const id = newLearnerId();
    assert.equal(verifyLlmKey(SECRET, llmKey(SECRET, id)), id);
  }
});

test("a model key isn't a session token, and the reverse", () => {
  const id = newLearnerId();
  assert.equal(verifySessionToken(SECRET, llmKey(SECRET, id)), null);
  assert.equal(verifyLlmKey(SECRET, sessionToken(SECRET, id)), null);
});

test("the access code compares exactly (after trimming)", () => {
  assert.equal(codeMatches("governed", "governed"), true);
  assert.equal(codeMatches("governed", "  governed "), true);
  assert.equal(codeMatches("governed", "Governed"), false);
  assert.equal(codeMatches("governed", undefined), false);
  assert.equal(codeMatches("", ""), false);
});

test("any one of several access codes lets you in", () => {
  assert.deepEqual(parseCodes(" governed, durable ,,"), ["governed", "durable"]);
  assert.deepEqual(parseCodes(undefined), []);
  const codes = parseCodes("governed,durable");
  assert.equal(codeMatchesAny(codes, "governed"), true);
  assert.equal(codeMatchesAny(codes, " durable "), true);
  assert.equal(codeMatchesAny(codes, "governed,durable"), false);
  assert.equal(codeMatchesAny(codes, ""), false);
  assert.equal(codeMatchesAny([], ""), false);
});

test("the session cookie is HttpOnly, Lax, host-only, and Secure over https", () => {
  const cookie = sessionCookie("t", { secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.doesNotMatch(sessionCookie("t", { secure: false }), /Secure/);
  const id = newLearnerId();
  const req = { headers: { cookie: `a=1; course_session=${encodeURIComponent(sessionToken(SECRET, id))}` } };
  assert.equal(learnerFromRequest(SECRET, req), id);
  assert.deepEqual(parseCookies("a=1; b=x%20y"), { a: "1", b: "x y" });
});

test("the rate limiter enforces per-key and global windows", () => {
  let now = 0;
  const limiter = new RateLimiter({ perKey: 2, global: 3, windowMs: 1000, now: () => now });
  assert.ok(limiter.take("a").ok);
  assert.ok(limiter.take("a").ok);
  const third = limiter.take("a");
  assert.equal(third.ok, false);
  assert.equal(third.scope, "sandbox");
  assert.ok(limiter.take("b").ok);
  const global = limiter.take("c");
  assert.equal(global.ok, false);
  assert.equal(global.scope, "global");
  now = 1001;
  assert.ok(limiter.take("a").ok, "the window slides");
});

test("file paths stay inside the workshop", () => {
  for (const ok of ["hello/workflow.py", "policies/travel.dw", ".env", "a/b-c/d_e.f"]) assert.ok(isSafePath(ok), ok);
  for (const bad of ["../etc/passwd", "a/../../b", "/etc/passwd", "a//b", "a b", "a;rm", "", null]) assert.ok(!isSafePath(bad), String(bad));
});

test("the sandbox .env points the model at the passthrough and keeps the mode", () => {
  const env = sandboxEnv({ llmBaseUrl: "https://c.example/llm/v1/", llmModel: "m", llmApiKey: "cl.k.s", temporalUiUrl: "https://c.example:8081", llmMode: "scripted" });
  assert.match(env, /^LLM_MODE=scripted$/m);
  assert.match(env, /^LLM_BASE_URL=https:\/\/c.example\/llm\/v1\/$/m);
  assert.match(env, /^LLM_API_KEY=cl.k.s$/m);
  assert.match(env, /^TRAVEL_STACK_BIND=0.0.0.0$/m);
  assert.equal(parseLlmMode(env), "scripted");
  assert.equal(parseLlmMode("LLM_MODE=openai"), "openai");
  assert.equal(parseLlmMode("nothing"), "openai");
});

test("a sandbox .env is stale when it names another model address, model, key or UI, not another mode", () => {
  const env = (url, mode = "openai") => sandboxEnv({ llmBaseUrl: url, llmModel: "m", llmApiKey: "k", temporalUiUrl: "https://c.example:8081", llmMode: mode });
  const tunnel = env("https://abc.ngrok-free.app/llm/v1/");
  assert.ok(envDiffers(env("http://127.0.0.1:4173/llm/v1/"), tunnel), "a new tunnel");
  assert.ok(!envDiffers(env("https://abc.ngrok-free.app/llm/v1/", "scripted"), tunnel), "the learner's model toggle isn't the runner's to undo");
  assert.ok(envDiffers("", tunnel), "no .env at all");
});

// --- The sandbox manager, against a fake Daytona -------------------------------------------

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeDaytona({ hangList = false } = {}) {
  const sandboxes = [];
  const pending = [];
  return {
    sandboxes,
    pending,
    async *list({ labels }) {
      if (hangList) await new Promise(() => {});
      for (const s of sandboxes) if (Object.entries(labels).every(([k, v]) => s.labels[k] === v)) yield s;
    },
    // Creation waits until the test lets it finish.
    create({ labels }) {
      return new Promise((resolve) => {
        pending.push(() => {
          const sandbox = {
            id: `sbx-${sandboxes.length + 1}`,
            labels,
            state: "started",
            deleted: false,
            async refreshData() {},
            async delete() {
              this.deleted = true;
              this.state = "destroyed";
            },
          };
          sandboxes.push(sandbox);
          resolve(sandbox);
        });
      });
    },
  };
}

test("a Daytona that doesn't list sandboxes fails the start instead of spinning", async () => {
  const manager = new SandboxManager({ listTimeoutMs: 30, maxSandboxes: 5 });
  manager.daytona = fakeDaytona({ hangList: true });
  assert.equal(manager.ensure("learner-1", {}).state, "finding");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const progress = await manager.describe("learner-1");
  assert.equal(progress.state, "error");
  assert.match(progress.message, /timed out/);
});

test("starting over abandons a start in progress, and its sandbox", async () => {
  const manager = new SandboxManager({ maxSandboxes: 5 });
  const daytona = fakeDaytona();
  manager.daytona = daytona;
  manager.ensure("learner-1", {});
  while (!daytona.pending.length) await settle();
  assert.equal((await manager.describe("learner-1")).state, "creating");

  assert.equal(await manager.reset("learner-1"), null);
  assert.equal((await manager.describe("learner-1")).state, "none");
  // A new start isn't held up by the old one.
  assert.equal(manager.ensure("learner-1", {}).state, "finding");

  // The abandoned creation finishes: its sandbox is deleted, and it reports nothing.
  daytona.pending.shift()();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(daytona.sandboxes[0].deleted, true);
  assert.notEqual(manager.progress.get("learner-1")?.state, "error");

  // Let the second start go too, so nothing is left waiting.
  while (!daytona.pending.length) await settle();
  await manager.reset("learner-1");
  daytona.pending.shift()();
  for (let i = 0; i < 5; i++) await settle();
});

test("a trip workflow from the Temporal CLI's JSON lines", () => {
  const line = JSON.stringify({
    execution: { workflowId: "hello-sfo-jfk-1a2b", runId: "r" },
    type: { name: "HelloTripWorkflow" },
    startTime: "2026-10-17T10:00:00Z",
    status: "WORKFLOW_EXECUTION_STATUS_COMPLETED",
  });
  assert.deepEqual(parseTrip(line), { id: "hello-sfo-jfk-1a2b", status: "completed", startTime: "2026-10-17T10:00:00Z" });
  assert.equal(parseTrip("not json"), null);
  assert.equal(parseTrip("{}"), null);
});

test("a sandbox gets every package pyproject.toml builds, or uv can't build the workshop there", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { repoRoot, workshopFiles } = await import("../runner/repo-files.mjs");
  const pyproject = fs.readFileSync(path.join(repoRoot, "pyproject.toml"), "utf8");
  const packages = JSON.parse(pyproject.match(/^packages = (\[.*\])$/m)[1]);
  const files = workshopFiles();
  for (const pkg of packages) assert.ok(files.includes(`${pkg}/__init__.py`), `${pkg}/ isn't copied into sandboxes (runner/repo-files.mjs DIRS)`);
});

test("the Temporal UI opens in dark mode with its side nav collapsed, set before the UI boots", async () => {
  const { injectUiLoader } = await import("../runner/proxy.mjs");
  const html = injectUiLoader('<html><head></head><body><div id="svelte"></div><script>boot()</script></body></html>');
  const first = html.match(/<body[^>]*>\s*<script>([\s\S]*?)<\/script>/)[1];
  const stored = {};
  new Function("localStorage", first)({ setItem: (key, value) => (stored[key] = value) });
  // The UI's persisted stores read their values as JSON.
  assert.equal(JSON.parse(stored["dark mode"]), true);
  assert.equal(JSON.parse(stored.navOpen), false);
  assert.ok(html.indexOf(first) < html.indexOf("boot()"));
});
