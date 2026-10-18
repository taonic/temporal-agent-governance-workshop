// One Daytona sandbox per learner, found by label (so the runner keeps no state that matters:
// a restart, or a second machine, finds the same sandboxes). A sandbox is created from the
// snapshot, gets the current workshop files and its .env, switches to the starter, and runs
// `travel-stack up`. It stops when idle; the next visit starts it and runs the stack again.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Daytona } from "@daytonaio/sdk";

import { llmKey } from "./auth.mjs";
import { repoRoot, sandboxRepo, workshopFiles } from "./repo-files.mjs";

export const APP_LABEL = "governance-course";
export const CONSOLE_PORT = 8000;
export const TEMPORAL_UI_PORT = 8233;
export const LSP_PORT = 2087;
const RUNNING = new Set(["started", "starting", "creating", "restoring", "pulling_snapshot", "resuming"]);
const GONE = new Set(["destroyed", "destroying", "error", "build_failed"]);
const BOOTSTRAPPED = ".course/bootstrapped";
// Left by the runner when it gave a running sandbox a new .env (see #writeEnv and poll).
const ENV_CHANGED = ".course/env-changed";
// The environment settings a worker command can start the worker with (FLAKY=1 uv run hello-worker).
const WORKER_ENV = ["FLAKY"];
const SAFE_PATH = /^(?!.*\.\.)[\w.@-]+(?:\/[\w.@-]+)*$/;

// The SDK's HTTP client waits up to a day; don't let one stalled call hang a learner.
// Listing sandboxes is the first thing every start does: a Daytona that doesn't answer must
// fail it, not leave the learner looking at "Looking for your sandbox…".
const LIST_TIMEOUT_MS = 30_000;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function isSafePath(rel) {
  return typeof rel === "string" && SAFE_PATH.test(rel);
}

// Starts the editor's language server bridge (course/snapshot/lsp_bridge.py) unless its port
// answers. setsid -f puts it in a session of its own and returns at once: Daytona ends the
// command's process group when it returns, which would take a plain `&` job with it. (Not
// pgrep: this very command line names the script.)
const START_LSP =
  `(: </dev/tcp/127.0.0.1/${LSP_PORT}) 2>/dev/null || ` +
  `setsid -f /opt/lsp/bin/python /opt/lsp/lsp_bridge.py --port ${LSP_PORT} >/tmp/lsp-bridge.log 2>&1 </dev/null`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// The sandbox's .env: the model goes through this runner, and links point at the course's
// panes. LLM_MODE is the learner's (the scripted-model toggle), so it carries over.
export function sandboxEnv({ llmBaseUrl, llmModel, llmApiKey, temporalUiUrl, llmMode = "openai" }) {
  return [
    "# Written by the course runner when the sandbox starts. Real environment variables win.",
    "TEMPORAL_ADDRESS=localhost:7233",
    "TASK_QUEUE=travel-agent",
    "",
    "# The model: Gemini, through the course's passthrough (this key only works there).",
    "# LLM_MODE=scripted plays a fixed travel agent instead; the course's model toggle sets it.",
    `LLM_MODE=${llmMode}`,
    `LLM_BASE_URL=${llmBaseUrl}`,
    `LLM_MODEL=${llmModel}`,
    `LLM_API_KEY=${llmApiKey}`,
    "",
    "TOOL_LATENCY_S=1.5",
    "",
    "# Where your browser reaches this sandbox's Temporal UI and console",
    `TEMPORAL_UI_URL=${temporalUiUrl}`,
    "CONSOLE_URL=(the Console tab)",
    "# So the course's preview proxy can reach the Temporal UI",
    "TRAVEL_STACK_BIND=0.0.0.0",
    "",
  ].join("\n");
}

// Whether a sandbox's .env names another model, key, or Temporal UI than the runner's.
const RUNNER_KEYS = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "TEMPORAL_UI_URL"];
export function envDiffers(current, wanted) {
  const value = (text, key) => String(text ?? "").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim() ?? null;
  return RUNNER_KEYS.some((key) => value(current, key) !== value(wanted, key));
}

export function parseLlmMode(envText) {
  const match = String(envText ?? "").match(/^LLM_MODE=(\S+)/m);
  return match?.[1] === "scripted" ? "scripted" : "openai";
}

// A line of `temporal workflow list -o jsonl`, as the page needs it.
export function parseTrip(line) {
  try {
    const row = JSON.parse(line);
    const id = row.execution?.workflowId;
    if (typeof id !== "string") return null;
    const status = String(row.status ?? "").replace(/^WORKFLOW_EXECUTION_STATUS_/, "").toLowerCase() || "unknown";
    return { id, status, startTime: row.startTime ?? null };
  } catch {
    return null;
  }
}

export class SandboxManager {
  constructor(config) {
    this.config = config;
    this.daytona = config.daytonaApiKey ? new Daytona({ apiKey: config.daytonaApiKey }) : null;
    this.cache = new Map(); // learner -> { sandbox, at }
    this.progress = new Map(); // learner -> { state, message, error? }
    this.inflight = new Map(); // learner -> { run, promise }: the start in progress
    this.ready = new Map(); // sandbox id -> verified at
    this.envChecked = new Set(); // sandbox ids whose .env this runner has written or checked
    this.previews = new Map(); // `${id}:${port}` -> { url, expiresAt }
    this.lastSeen = new Map(); // learner -> { at, exercise }
    this.creating = 0;
  }

  touch(learner, exercise) {
    this.lastSeen.set(learner, { at: Date.now(), exercise: exercise ?? this.lastSeen.get(learner)?.exercise });
  }

  async find(learner, { fresh = false } = {}) {
    const cached = this.cache.get(learner);
    if (cached && !fresh && Date.now() - cached.at < 5 * 60_000) return cached.sandbox;
    const found = (await this.#list({ labels: { app: APP_LABEL, learner } })).find((sandbox) => !GONE.has(sandbox.state)) ?? null;
    if (found) this.cache.set(learner, { sandbox: found, at: Date.now() });
    else this.cache.delete(learner);
    return found;
  }

  async #list(query) {
    const rows = [];
    const read = async () => {
      for await (const sandbox of this.daytona.list(query)) rows.push(sandbox);
    };
    await withTimeout(read(), this.config.listTimeoutMs ?? LIST_TIMEOUT_MS, "Looking for sandboxes in Daytona");
    return rows;
  }

  // A fresh read of the sandbox's state (find() may hand back a cached object).
  async refreshed(learner) {
    const sandbox = await this.find(learner);
    if (!sandbox) return null;
    try {
      await withTimeout(sandbox.refreshData(), 10_000, "Reading the sandbox");
      if (GONE.has(sandbox.state)) throw new Error("gone");
      return sandbox;
    } catch {
      return this.find(learner, { fresh: true });
    }
  }

  async describe(learner) {
    if (this.inflight.has(learner)) return this.progress.get(learner);
    const failed = this.progress.get(learner);
    if (failed?.state === "error" || failed?.state === "full") return failed;
    const sandbox = await this.refreshed(learner);
    if (!sandbox) return { state: "none" };
    if (sandbox.state === "started" && this.ready.has(sandbox.id)) return { state: "ready", sandboxId: sandbox.id };
    return { state: sandbox.state === "started" ? "waking" : sandbox.state, sandboxId: sandbox.id };
  }

  // Gets the learner's sandbox to "ready", creating or starting it as needed. Concurrent
  // calls share one run; reset() cancels it, so a run that's stuck can be left behind.
  ensure(learner, origins) {
    if (!this.inflight.has(learner)) {
      const run = { learner, cancelled: false };
      const promise = this.#ensure(run, origins)
        .catch((err) => {
          if (!run.cancelled && this.progress.get(learner)?.state !== "full") this.#step(run, "error", err.message);
        })
        .finally(() => {
          if (this.inflight.get(learner)?.run === run) this.inflight.delete(learner);
        });
      this.inflight.set(learner, { run, promise });
    }
    return this.progress.get(learner) ?? { state: "finding", message: "Looking for your sandbox…" };
  }

  // Only the learner's current run reports progress.
  #step(run, state, message, extra = {}) {
    if (!run.cancelled) this.progress.set(run.learner, { state, message, ...extra });
  }

  #stillWanted(run) {
    if (run.cancelled) throw new Error("cancelled");
  }

  async #ensure(run, origins) {
    const { learner } = run;
    this.#step(run, "finding", "Looking for your sandbox…");
    let sandbox = await this.refreshed(learner);
    this.#stillWanted(run);
    let fresh = false;

    if (!sandbox) {
      sandbox = await this.#create(run);
      fresh = true;
    } else if (sandbox.state !== "started") {
      if (sandbox.state === "stopping" || sandbox.state === "archiving") {
        this.#step(run, "waking", "Your sandbox is stopping; waiting to start it again…");
        for (let i = 0; i < 60 && ["stopping", "archiving"].includes(sandbox.state); i++) {
          await sleep(2000);
          await withTimeout(sandbox.refreshData(), 10_000, "Reading the sandbox");
        }
      }
      this.#stillWanted(run);
      if (sandbox.state !== "started") {
        this.#step(run, "waking", "Waking your sandbox…");
        await withTimeout(sandbox.start(180), 200_000, "Starting the sandbox");
      }
      this.ready.delete(sandbox.id);
    }

    this.#stillWanted(run);
    this.#step(run, "bootstrapping", "Checking the workshop services…", { sandboxId: sandbox.id });
    const health = fresh ? { bootstrapped: false, up: false } : await this.#health(sandbox);
    this.#stillWanted(run);
    if (!health.bootstrapped) await this.#bootstrap(run, sandbox, origins, { fresh: true });
    else if (!health.up) await this.#bootstrap(run, sandbox, origins, { fresh: false });
    // Up already, from before this runner started: its .env may name another model address (a
    // new tunnel's PUBLIC_URL, say). The page restarts a worker that's older than it (poll).
    else await this.#writeEnv(sandbox, learner, origins, { onlyIfStale: true });

    this.#stillWanted(run);
    this.ready.set(sandbox.id, Date.now());
    this.#step(run, "ready", "Your sandbox is ready.", { sandboxId: sandbox.id });
  }

  async #countRunning() {
    const running = (await this.#list({ labels: { app: APP_LABEL } })).filter((sandbox) => RUNNING.has(sandbox.state));
    return running.length + this.creating;
  }

  async #create(run) {
    const { learner } = run;
    if ((await this.#countRunning()) >= this.config.maxSandboxes) {
      this.#step(run, "full", `All ${this.config.maxSandboxes} sandboxes are in use. Try again in a few minutes, or run the workshop locally.`);
      throw new Error("full");
    }
    this.#stillWanted(run);
    this.#step(run, "creating", "Creating your sandbox (about a minute)…");
    this.creating += 1;
    try {
      const sandbox = await withTimeout(
        this.daytona.create(
          {
            snapshot: this.config.snapshot,
            labels: { app: APP_LABEL, learner },
            autoStopInterval: this.config.autoStopMinutes,
            ttlMinutes: this.config.ttlMinutes,
          },
          { timeout: 240 },
        ),
        260_000,
        "Creating the sandbox",
      );
      // Started over while this was being made: it's not the one they want.
      if (run.cancelled) {
        await withTimeout(sandbox.delete(60), 90_000, "Deleting the sandbox").catch(() => {});
        throw new Error("cancelled");
      }
      this.cache.set(learner, { sandbox, at: Date.now() });
      return sandbox;
    } catch (err) {
      if (/snapshot/i.test(err.message) && /not found|does not exist/i.test(err.message)) {
        throw new Error(`The sandbox snapshot ${this.config.snapshot} doesn't exist yet: run node course/snapshot/build.mjs.`);
      }
      throw err;
    } finally {
      this.creating -= 1;
    }
  }

  async exec(sandbox, command, timeoutSeconds = 60) {
    return withTimeout(
      sandbox.process.executeCommand(command, sandboxRepo, undefined, timeoutSeconds),
      (timeoutSeconds + 15) * 1000,
      "A sandbox command",
    );
  }

  async #health(sandbox) {
    try {
      const result = await this.exec(
        sandbox,
        `test -f ${BOOTSTRAPPED} || { echo none; exit 0; }; ` +
          `curl -sf -o /dev/null http://localhost:${CONSOLE_PORT}/api/agents && ` +
          `curl -sf -o /dev/null http://localhost:${TEMPORAL_UI_PORT}/ && echo up || echo down`,
        20,
      );
      const out = (result.result ?? "").trim();
      return { bootstrapped: out !== "none", up: out === "up" };
    } catch {
      return { bootstrapped: true, up: false };
    }
  }

  publicOrigins(origins) {
    const site = this.config.publicUrl || origins.site;
    const ui = this.config.uiProxyPublicBase || origins.ui;
    return { site, ui };
  }

  // The sandbox's .env, for this runner: the model through its passthrough, links to its panes.
  // LLM_MODE is the learner's (the model toggle), so it carries over unless the sandbox is new.
  // onlyIfStale leaves it alone unless what this runner would write is different (a new tunnel).
  async #writeEnv(sandbox, learner, origins, { keepMode = true, onlyIfStale = false } = {}) {
    const { site, ui } = this.publicOrigins(origins);
    let current = "";
    try {
      current = (await sandbox.fs.downloadFile(`${sandboxRepo}/.env`, 20)).toString("utf8");
    } catch {
      /* no .env yet */
    }
    const envText = sandboxEnv({
      llmBaseUrl: `${site}/llm/v1/`,
      llmModel: this.config.llmModel,
      llmApiKey: llmKey(this.config.sessionSecret, learner),
      temporalUiUrl: ui,
      llmMode: keepMode ? parseLlmMode(current) : "openai",
    });
    this.envChecked.add(sandbox.id);
    if (onlyIfStale && !envDiffers(current, envText)) return;
    await sandbox.fs.uploadFile(Buffer.from(envText), `${sandboxRepo}/.env`, 30);
    // A worker that's running has the old settings: the poll tells the page, which restarts it.
    if (onlyIfStale) await this.exec(sandbox, `mkdir -p .course && touch ${ENV_CHANGED}`, 15);
  }

  async #bootstrap(run, sandbox, origins, { fresh }) {
    if (fresh) {
      this.#step(run, "bootstrapping", "Copying the workshop in…", { sandboxId: sandbox.id });
      const files = workshopFiles().map((rel) => ({
        source: fs.readFileSync(path.join(repoRoot, rel)),
        destination: `${sandboxRepo}/${rel}`,
      }));
      await withTimeout(sandbox.fs.uploadFiles(files, 180), 200_000, "Copying the workshop in");
    }
    await this.#writeEnv(sandbox, run.learner, origins, { keepMode: !fresh });

    this.#stillWanted(run);
    this.#step(run, "bootstrapping", "Starting Temporal, the Dogwood verifier and the console…", { sandboxId: sandbox.id });
    const steps = [
      // Process ids from before a stop point at nothing (or at something else).
      "rm -f .stack/*.pid",
      ...(fresh ? ["uv run --frozen python scripts/switch.py starter"] : []),
      "uv run --frozen travel-stack up",
      `{ ${START_LSP}; }`,
      `mkdir -p .course && touch ${BOOTSTRAPPED}`,
    ];
    const result = await this.exec(sandbox, `bash -c ${shellQuote(steps.join(" && "))} 2>&1`, 240);
    if (result.exitCode !== 0) {
      const tail = (result.result ?? "").trim().split("\n").slice(-15).join("\n");
      throw new Error(`Starting the workshop services failed:\n${tail}`);
    }
  }

  // The relay calls this when it can't reach the bridge: it may have exited on its own.
  async startLsp(learner) {
    await this.exec(await this.sandboxFor(learner), `bash -c ${shellQuote(START_LSP)}`, 15);
  }

  async sandboxFor(learner) {
    const sandbox = await this.find(learner);
    if (!sandbox) throw Object.assign(new Error("No sandbox yet."), { status: 409 });
    return sandbox;
  }

  // A signed preview URL for a port, valid for an hour, reused for 50 minutes.
  async previewUrl(sandbox, port) {
    const key = `${sandbox.id}:${port}`;
    const cached = this.previews.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const signed = await withTimeout(sandbox.getSignedPreviewUrl(port, 3600), 15_000, "Getting a preview URL");
    const url = signed.url.replace(/\/$/, "");
    this.previews.set(key, { url, expiresAt: Date.now() + 50 * 60_000 });
    return url;
  }

  async previewFor(learner, port) {
    return this.previewUrl(await this.sandboxFor(learner), port);
  }

  async readFile(learner, rel) {
    if (!isSafePath(rel)) throw Object.assign(new Error("Bad path."), { status: 400 });
    const sandbox = await this.sandboxFor(learner);
    const buffer = await withTimeout(sandbox.fs.downloadFile(`${sandboxRepo}/${rel}`, 20), 30_000, "Reading a file");
    return buffer.toString("utf8");
  }

  async writeFile(learner, rel, content) {
    if (!isSafePath(rel)) throw Object.assign(new Error("Bad path."), { status: 400 });
    const sandbox = await this.sandboxFor(learner);
    await withTimeout(sandbox.fs.uploadFile(Buffer.from(content, "utf8"), `${sandboxRepo}/${rel}`, 20), 30_000, "Saving a file");
  }

  // What the page polls for: each open file's mtime and size (to notice edits made by
  // solve.sh, switch.py or the terminal), the exercises whose check passed, the model mode, the
  // worker, and with trips, exercise 1's workflows (trips and boardings, the latest first) and
  // whether a hello-start is still waiting for one in the commands terminal.
  async poll(learner, files, { trips = false, origins = null, exercise = null } = {}) {
    const safe = files.filter(isSafePath).slice(0, 20);
    // The exercise on the page, for the console to name new sessions after (ex3-human-approval-…).
    // When it changes, or the sandbox started over from its snapshot with every TODO open, the
    // earlier exercises' TODOs get their solutions: an exercise never depends on the earlier ones.
    const mark = /^\d\d-[a-z0-9-]+$/.test(exercise ?? "")
      ? `mkdir -p .course; [ "$(cat .course/exercise 2>/dev/null)" = ${exercise} ] || ` +
        `{ echo ${exercise} > .course/exercise; CAUGHT_UP=$(uv run --frozen python scripts/switch.py catch-up ${Number.parseInt(exercise, 10)} 2>/dev/null); }; `
      : "";
    const sandbox = await this.sandboxFor(learner);
    // A page left open across a runner restart polls without starting the sandbox again: its
    // .env gets this runner's model address here instead, once.
    if (origins && sandbox.state === "started" && !this.envChecked.has(sandbox.id)) {
      await this.#writeEnv(sandbox, learner, origins, { onlyIfStale: true });
      this.envChecked.add(sandbox.id);
    }
    const stat = safe.length ? `stat -c '%n|%Y|%s' -- ${safe.map(shellQuote).join(" ")} 2>/dev/null; ` : "";
    const result = await this.exec(
      sandbox,
      `${mark}${stat}echo '--passed'; ls .course/passed 2>/dev/null; echo '--mode'; grep -m1 '^LLM_MODE=' .env 2>/dev/null; ` +
        // Bracketed so pgrep doesn't match this command's own line.
        `echo '--worker'; pgrep -af '[h]ello-worker|[t]ravel-worker' 2>/dev/null | head -5; ` +
        // The settings a worker command can start it with (FLAKY=1 uv run hello-worker), from
        // the running worker's environment, so the page knows which of its ▶s is running.
        `echo '--workerenv'; p=$(pgrep -f '[h]ello-worker|[t]ravel-worker' 2>/dev/null | head -1); ` +
        `[ -n "$p" ] && tr '\\0' '\\n' < /proc/$p/environ 2>/dev/null | grep -E '^(${WORKER_ENV.join("|")})='; ` +
        // The runner rewrote .env since: a travel worker running now has the old model address.
        // Reported once (ps's process ages aren't to be trusted in these sandboxes).
        `echo '--stale'; if [ -f ${ENV_CHANGED} ]; then rm -f ${ENV_CHANGED}; pgrep -f '[t]ravel-worker' >/dev/null && echo stale; fi; ` +
        // The exercises switch.py just solved (see mark), one number a line.
        `echo '--caughtup'; echo "\${CAUGHT_UP:-}"` +
        (trips
          ? `; echo '--trips'; timeout 5 temporal workflow list --query "WorkflowType IN ('HelloTripWorkflow', 'BoardingWorkflow')" --limit 20 -o jsonl 2>/dev/null` +
            `; echo '--starter'; pgrep -af '[h]ello-start' 2>/dev/null | head -3`
          : ""),
      15,
    );
    const out = { files: {}, passed: [], caughtUp: [], llmMode: "openai", worker: { running: false, name: null, env: {} } };
    if (trips) Object.assign(out, { trips: [], starter: false });
    let section = "files";
    for (const line of (result.result ?? "").split("\n")) {
      if (line === "--passed") section = "passed";
      else if (line === "--mode") section = "mode";
      else if (line === "--worker") section = "worker";
      else if (line === "--workerenv") section = "workerenv";
      else if (line === "--stale") section = "stale";
      else if (line === "--caughtup") section = "caughtup";
      else if (line === "--trips") section = "trips";
      else if (line === "--starter") section = "starter";
      else if (!line.trim()) continue;
      else if (section === "files") {
        const [name, mtime, size] = line.split("|");
        out.files[name] = { mtime: Number(mtime), size: Number(size) };
      } else if (section === "passed") out.passed.push(line.trim());
      else if (section === "worker") {
        const name = line.match(/\b(hello|travel)-worker\b/)?.[1];
        if (name) out.worker = { ...out.worker, running: true, name: `${name}-worker` };
      } else if (section === "workerenv") {
        const [, key, value] = line.match(/^(\w+)=(.*)$/) ?? [];
        if (key) out.worker.env[key] = value;
      } else if (section === "stale") {
        out.worker = { ...out.worker, stale: true };
      } else if (section === "caughtup") {
        if (/^\d+$/.test(line.trim())) out.caughtUp.push(Number(line.trim()));
      } else if (section === "trips") {
        const trip = parseTrip(line);
        if (trip) out.trips.push(trip);
      } else if (section === "starter") out.starter = true;
      else out.llmMode = parseLlmMode(line);
    }
    return out;
  }

  async setLlmMode(learner, mode) {
    const value = mode === "scripted" ? "scripted" : "openai";
    const sandbox = await this.sandboxFor(learner);
    await this.exec(sandbox, `sed -i 's/^LLM_MODE=.*/LLM_MODE=${value}/' .env`, 15);
    return value;
  }

  // Deletes the learner's sandbox, giving up on a start that's in progress (or stuck).
  async reset(learner) {
    const inflight = this.inflight.get(learner);
    if (inflight) inflight.run.cancelled = true;
    this.inflight.delete(learner);
    this.progress.delete(learner);
    const sandbox = await this.find(learner, { fresh: true });
    this.progress.delete(learner);
    this.cache.delete(learner);
    if (!sandbox) return null;
    this.ready.delete(sandbox.id);
    for (const key of this.previews.keys()) if (key.startsWith(`${sandbox.id}:`)) this.previews.delete(key);
    await withTimeout(sandbox.delete(60), 90_000, "Deleting the sandbox");
    return sandbox;
  }

  clearError(learner) {
    const progress = this.progress.get(learner);
    if (progress && (progress.state === "error" || progress.state === "full")) this.progress.delete(learner);
  }

  async listAll() {
    const rows = [];
    for (const sandbox of await this.#list({ labels: { app: APP_LABEL } })) {
      const learner = sandbox.labels?.learner;
      const seen = this.lastSeen.get(learner);
      rows.push({
        id: sandbox.id,
        learner,
        state: sandbox.state,
        createdAt: sandbox.createdAt,
        updatedAt: sandbox.updatedAt,
        lastSeenAt: seen ? new Date(seen.at).toISOString() : null,
        exercise: seen?.exercise ?? null,
      });
    }
    return rows;
  }
}
