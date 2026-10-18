// Shared state for the whole site: the route, the theme, the learner's session and sandbox,
// progress, and the hooks components register so others can drive them (type into a
// terminal, open a pane, open a file).
import { reactive, watch } from "vue";

import course from "./generated/course-data.json";

export { course };

export const storagePrefix = "governed-agents-course";
export const storageKey = (...parts) => [storagePrefix, ...parts].join(":");

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(storageKey(key));
    else localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    /* storage unavailable: the page still works, it just forgets */
  }
}

function initialTheme() {
  const saved = load("theme", null);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [page, id] = hash.split("/");
  if (page === "setup") return { page: "setup" };
  if (page === "exercise" && course.exercises.some((e) => e.id === id)) return { page: "exercise", id };
  return { page: "home" };
}

export const store = reactive({
  route: parseRoute(),
  theme: initialTheme(),
  toast: "",

  // The browser runtime, as the runner reports it.
  runtime: { checked: false, enabled: false, reason: "", codeRequired: true },
  authenticated: false,
  uiProxy: { base: null, port: null },
  gateOpen: false,

  // The learner's sandbox: none | finding | creating | waking | bootstrapping | ready | error | full
  sandbox: { state: "unknown", message: "", sandboxId: null },
  llmMode: "openai",

  // What the workspace (the left column, over the terminals) shows: "code" (the editor),
  // "console" (the Agent UI) or "temporal" (the Temporal UI).
  workspaceView: "code",

  // The editor's files as they are now (path -> text), so a snippet's button can say whether
  // it's in its file.
  fileTexts: {},
  // The editor's tab on show ("path|view"), so other parts of the page can follow it.
  editorPath: "",

  // The sandbox's worker, from the poll; `pending` while a toggle waits to be confirmed.
  worker: { running: null, name: null, env: {}, pending: null },

  // Exercise 1's trip workflows (latest first), whether a hello-start waits in the commands
  // terminal, and the trips started from a button and not seen yet ("SFO JFK" -> the ids known
  // when it was clicked).
  trips: { list: null, starter: false, pending: {} },

  // The page tour is showing (App.vue): the code tour waits for it.
  pageTourOpen: false,
  // The guide's getting-started steps: only the guide shows (ExercisePage), and the guide asks
  // for the page tour (App) by bumping pageTourRequest.
  guideOnly: false,
  pageTourRequest: 0,


  // Exercise ids whose check passed (from the sandbox), and the ones already celebrated.
  passed: load("passed", []),
  celebrated: load("celebrated", []),
});

// There was a Browser | Local switch; a choice saved then would now be stuck.
save("mode", null);
watch(() => store.passed, (passed) => save("passed", passed), { deep: true });
watch(() => store.celebrated, (ids) => save("celebrated", ids), { deep: true });

window.addEventListener("hashchange", () => {
  store.route = parseRoute();
});

export function navigate(hash) {
  if (window.location.hash !== hash) window.location.hash = hash;
  else store.route = parseRoute();
}

let toastTimer = 0;
export function toast(message, ms = 2200) {
  store.toast = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    store.toast = "";
  }, ms);
}

// The browser sandbox wherever it's available; otherwise the instructions for running locally.
export const effectiveMode = () => (store.runtime.enabled ? "browser" : "local");

// --- Hooks components register ------------------------------------------------------------

const hooks = { terminal: null, pane: null, send: null, session: null, sessionTab: null, file: null, insert: null, revert: null, poll: null, editor: null, terminalSelection: null };

export function registerHook(name, fn) {
  hooks[name] = fn;
  return () => {
    if (hooks[name] === fn) hooks[name] = null;
  };
}

// Types commands into a terminal. The worker terminal is interrupted first (Ctrl-C), so a
// command there always replaces whatever worker was running. The terminals are under Code, so
// it goes back to Code to show them (the worker toggle, a trip, a ▶), unless `reveal` is false:
// for what the page does on its own, which shouldn't move the learner off what they're reading.
export function runInTerminal(target, commands, { interrupt = target === "worker", reveal = true } = {}) {
  if (!hooks.terminal) return toast("Start your sandbox first.");
  if (reveal) store.workspaceView = "code";
  hooks.terminal(target, commands, { interrupt });
}

// --- The worker toggle ------------------------------------------------------------------------

let pendingTimer = 0;

// From each poll. A pending toggle clears once the worker is in the state it asked for. `env`:
// the settings the running worker was started with (FLAKY…), as the runner reports them.
export function setWorkerState({ running, name, env = {} }) {
  const pending = store.worker.pending;
  const settled = (pending === "stopping" && !running) || (pending === "starting" && running);
  store.worker = { running, name, env, pending: settled ? null : pending };
  if (settled) clearTimeout(pendingTimer);
}

// Asks for a worker state and polls a few times to confirm it; a pending state gives up after
// a while, in case it never comes.
function pend(state, giveUpMs) {
  store.worker = { ...store.worker, pending: state };
  for (const ms of [1200, 3000, 6000, 10000]) setTimeout(() => hooks.poll?.(), ms);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    store.worker = { ...store.worker, pending: null };
  }, giveUpMs);
}

// Stops the running worker (Ctrl-C in the worker terminal), or starts the exercise's, in the
// worker terminal so you see it happen.
export function toggleWorker(exercise) {
  if (store.worker.pending || store.worker.running === null) return;
  if (store.worker.running) return stopWorker();
  pend("starting", 20000);
  runInTerminal("worker", [exercise.worker]);
}

export function stopWorker() {
  if (store.worker.pending || !store.worker.running) return;
  pend("stopping", 20000);
  runInTerminal("worker", [], { interrupt: true });
}

// A worker command's ▶ (`uv run hello-worker`, `FLAKY=1 uv run hello-worker`): runs it in the
// worker terminal, in place of a worker that's running.
export function runWorkerCommand(command) {
  if (store.worker.pending) return;
  const restarting = Boolean(store.worker.running);
  pend(restarting ? "restarting" : "starting", restarting ? 5000 : 20000);
  runInTerminal("worker", [command]);
}

// Whether the running worker is the one a worker command starts: the same worker, started with
// the same settings (the runner reports those named in its WORKER_ENV).
export function isRunningCommand(command) {
  const match = command.match(/^((?:\w+=\S+\s+)*)uv run ((?:hello|travel)-worker)\b/);
  const { running, name, env = {} } = store.worker;
  if (!match || !running || name !== match[2]) return false;
  const wanted = Object.fromEntries(match[1].split(/\s+/).filter(Boolean).map((a) => a.split("=")));
  return [...new Set([...Object.keys(wanted), ...Object.keys(env)])].every((key) => (wanted[key] ?? "") === (env[key] ?? ""));
}

// How a worker command's ▶ shows: Stop when the worker it starts is the one running.
export function workerRunView(command, live) {
  const { pending } = store.worker;
  if (live && pending) return { state: "pending", title: "Waiting for the worker", disabled: true };
  if (live && isRunningCommand(command)) return { state: "running", title: "It's running: stop it (Ctrl-C in the worker terminal)", disabled: false };
  const replaces = live && store.worker.running ? ", in place of the worker that's running" : "";
  return { state: "idle", title: `Run it in the worker terminal${replaces}`, disabled: false };
}

// Restarts the running worker in one go: Ctrl-C, then the exercise's worker command, in the
// worker terminal. One that isn't running just starts. A restart can't be told apart from the
// polls (it's running before and after), so it shows as pending for a few seconds.
export function restartWorker(exercise) {
  if (store.worker.pending || store.worker.running === null) return;
  if (!store.worker.running) return toggleWorker(exercise);
  pend("restarting", 5000);
  runInTerminal("worker", [exercise.worker], { interrupt: true });
}

// --- Trips (exercise 1's hello-start) -----------------------------------------------------------

const tripPrefix = (key) => `hello-${key.toLowerCase().replace(" ", "-")}-`;
const latestTrip = (key) => store.trips.list?.find((t) => t.id.startsWith(tripPrefix(key))) ?? null;
const pendingTimers = {};

// From each poll. A started trip stops pending once its new workflow shows up.
export function setTrips({ trips, starter }) {
  const pending = { ...store.trips.pending };
  for (const [key, known] of Object.entries(pending)) {
    const latest = trips.find((t) => t.id.startsWith(tripPrefix(key)));
    if (latest && !known.includes(latest.id)) {
      delete pending[key];
      clearTimeout(pendingTimers[key]);
    }
  }
  store.trips = { list: trips, starter, pending };
}

// Starts the trip in the commands terminal, so you see it happen. A hello-start still waiting
// for an earlier trip there gets a Ctrl-C first: its workflow carries on without it.
export function startTrip(key) {
  if (store.trips.pending[key]) return;
  const known = (store.trips.list ?? []).map((t) => t.id);
  store.trips = { ...store.trips, pending: { ...store.trips.pending, [key]: known } };
  runInTerminal("commands", [`uv run hello-start ${key}`], { interrupt: store.trips.starter });
  for (const ms of [1500, 3000, 6000, 10000]) setTimeout(() => hooks.poll?.(), ms);
  clearTimeout(pendingTimers[key]);
  pendingTimers[key] = setTimeout(() => {
    const { [key]: _gone, ...rest } = store.trips.pending;
    store.trips = { ...store.trips, pending: rest };
  }, 20000);
}

// The trip's latest workflow, in the Temporal UI pane.
export function openTrip(key) {
  openWorkflow(tripPrefix(key));
}

// The latest of exercise 1's workflows whose id starts with prefix ("hello-sfo-jfk-",
// "board-sfo-jfk-"), in the Temporal UI pane, on one of its tabs ("history"…) with tab.
export function openWorkflow(prefix, tab = null) {
  const workflow = store.trips.list?.find((t) => t.id.startsWith(prefix));
  if (!workflow) return toast("Start it first: it isn't in Temporal yet");
  openPane("temporal", tab ? { workflow: workflow.id, tab } : `/namespaces/default/workflows/${encodeURIComponent(workflow.id)}`);
}

const TRIP_ENDED = { completed: "completed", failed: "failed", terminated: "terminated", canceled: "cancelled", timed_out: "timed out" };

// How a trip button shows its trip: its latest workflow, and what you can do with it.
export function tripView(key, live) {
  const route = key.replace(" ", " → ");
  const start = { act: "start", label: "Start", title: `Start it: uv run hello-start ${key}, in the commands terminal` };
  if (!live || store.trips.list === null) return { state: "unknown", label: `Trip ${route}`, actions: [], title: "Start your sandbox first" };
  if (store.trips.pending[key]) return { state: "pending", label: `Starting ${route}…`, actions: [], title: "Waiting for Temporal to record it" };
  const trip = latestTrip(key);
  const open = { act: "open", label: "Open", title: `Open ${trip?.id} in the Temporal UI` };
  if (!trip) return { state: "idle", label: `Trip ${route}`, actions: [start], title: start.title };
  if (trip.status === "running") {
    return { state: "running", label: `${route} running`, actions: [open], title: "Recorded, and running whenever a worker is there to run it" };
  }
  const ended = TRIP_ENDED[trip.status] ?? trip.status;
  return {
    state: trip.status === "completed" ? "completed" : "ended",
    label: `${route} ${ended}`,
    actions: [open, { ...start, label: "Again" }],
    title: `${trip.id} ${ended}`,
  };
}

// How the guide's Start my sandbox button shows the sandbox.
const SANDBOX_BUSY = { finding: "Finding your sandbox…", creating: "Creating your sandbox…", waking: "Waking your sandbox…", bootstrapping: "Starting its services…", stopped: "Waking your sandbox…", starting: "Waking your sandbox…" };
export function sandboxStartView() {
  const { state } = store.sandbox;
  if (store.authenticated && state === "ready") return { state: "ready", label: "✓ Your sandbox is ready", disabled: true };
  if (store.authenticated && SANDBOX_BUSY[state]) return { state: "busy", label: SANDBOX_BUSY[state], disabled: true };
  if (store.authenticated && (state === "error" || state === "full")) return { state: "error", label: "Try again", disabled: false };
  return { state: "idle", label: "Start my sandbox", disabled: false };
}

// How a toggle shows the worker, wherever it appears.
export function workerToggleView(live) {
  const { running, name, pending } = store.worker;
  const who = name === "hello-worker" ? "Hello worker" : name === "travel-worker" ? "Travel worker" : "Worker";
  if (!live || running === null) return { state: "unknown", label: "Worker", action: "", title: "Start your sandbox first", disabled: true };
  if (pending === "stopping") return { state: "pending", label: `${who} stopping…`, action: "", title: "Waiting for it to stop", disabled: true };
  if (pending === "starting") return { state: "pending", label: "Worker starting…", action: "", title: "Waiting for it to start", disabled: true };
  if (pending === "restarting") return { state: "pending", label: `${who} restarting…`, action: "", title: "Ctrl-C, then starting it again", disabled: true };
  if (running) return { state: "running", label: `${who} running`, action: "Stop", title: "Stop it: Ctrl-C in the worker terminal", disabled: false };
  return { state: "stopped", label: "Worker stopped", action: "Start", title: "Start it in the worker terminal", disabled: false };
}

// The restart button: Restart while the worker runs, otherwise just like the toggle.
export function workerRestartView(live) {
  const view = workerToggleView(live);
  if (view.state !== "running") return view;
  return { ...view, action: "↻ Restart", title: "Restart it: Ctrl-C, then start it again, in the worker terminal" };
}

export function openPane(pane, path) {
  hooks.pane?.(pane, path);
}

// Sends a message to the agent in the Agent UI's open session (see SandboxPanes' send).
export function sendToAgent(text) {
  if (!hooks.send) return toast("Start your sandbox first.");
  hooks.send(text);
}

// Opens the Agent UI's current session in the Temporal UI, on a tab (see SandboxPanes).
export function openSessionTab(tab) {
  if (!hooks.sessionTab) return toast("Start your sandbox first.");
  hooks.sessionTab(tab);
}

// Opens an agent's start form in the Agent UI, with the posture chosen (see SandboxPanes).
export function startAgentSession(agent, posture) {
  if (!hooks.session) return toast("Start your sandbox first.");
  hooks.session(agent, posture);
}

// Puts a snippet from the instructions into the editor (see CodeEditor's insertSnippet).
export async function insertIntoEditor(path, code, mode) {
  if (!hooks.insert) return toast("Open the exercise's editor first.");
  store.workspaceView = "code";
  toast(await hooks.insert(path, code, mode), 3600);
}

export async function revertFromEditor(path, code, mode) {
  if (!hooks.revert) return toast("Open the exercise's editor first.");
  store.workspaceView = "code";
  toast(await hooks.revert(path, code, mode), 3600);
}

// Shows a file in the editor; with lines ("321-335"), selected and flashed. A file outside the
// exercise (the harness's code) opens read-only, from the sandbox. False when it can't.
export function openFile(file, lines) {
  const opened = hooks.file?.(file, lines) ?? false;
  if (opened) store.workspaceView = "code";
  return opened;
}

// What the editor shows: { path, text, view, selection, editable }, or null without one.
export function editorContext() {
  return hooks.editor?.() ?? null;
}

// The text selected in the terminal on show, or "".
export function terminalSelection() {
  return hooks.terminalSelection?.() ?? "";
}

// --- The runner's API ---------------------------------------------------------------------

export async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* not JSON */
  }
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
  return data;
}

export async function refreshSession() {
  try {
    const data = await api("/api/session");
    store.runtime = { checked: true, enabled: data.runtime.enabled, reason: data.runtime.reason ?? "", codeRequired: data.runtime.codeRequired };
    store.authenticated = data.authenticated;
    store.uiProxy = { base: data.uiProxyBase, port: data.uiProxyPort };
  } catch {
    store.runtime = { checked: true, enabled: false, reason: "The course runner isn't reachable.", codeRequired: true };
    store.authenticated = false;
  }
}

export function uiProxyOrigin() {
  if (store.uiProxy.base) return store.uiProxy.base.replace(/\/$/, "");
  if (store.uiProxy.port) return `${window.location.protocol}//${window.location.hostname}:${store.uiProxy.port}`;
  return "";
}

const SETTLED = new Set(["ready", "error", "full", "none"]);
let sandboxPoll = 0;

function applySandbox(data) {
  store.sandbox = { state: data.state, message: data.message ?? "", sandboxId: data.sandboxId ?? null };
}

async function pollSandbox() {
  clearTimeout(sandboxPoll);
  try {
    const exercise = store.route.page === "exercise" ? store.route.id : "";
    applySandbox(await api(`/api/sandbox?exercise=${encodeURIComponent(exercise)}`));
  } catch (err) {
    if (err.status === 401) store.authenticated = false;
    store.sandbox = { state: "error", message: err.message, sandboxId: null };
    return;
  }
  if (!SETTLED.has(store.sandbox.state)) sandboxPoll = setTimeout(pollSandbox, 1500);
}

// Asks the runner to get the sandbox ready (creating or waking it), then follows progress.
export async function startSandbox() {
  if (!store.authenticated) {
    store.gateOpen = true;
    return;
  }
  try {
    applySandbox(await api("/api/sandbox/start", { method: "POST" }));
  } catch (err) {
    store.sandbox = { state: "error", message: err.message, sandboxId: null };
    return;
  }
  pollSandbox();
}

// On load: if there's a sandbox, wake it (it may have stopped while idle); if not, wait for
// the learner to ask for one.
export async function resumeSandbox() {
  if (!store.authenticated) return;
  await pollSandbox();
  // One that exists but isn't known to be ready (stopped while idle, or the runner restarted).
  if (!["none", "ready", "error", "full"].includes(store.sandbox.state)) startSandbox();
}

// Deletes the sandbox (the runner also gives up on a start that's in progress or stuck), and
// with restart, starts a new one.
export async function resetSandbox({ restart = false } = {}) {
  clearTimeout(sandboxPoll);
  store.sandbox = { state: "finding", message: "Deleting your sandbox…", sandboxId: null };
  try {
    applySandbox(await api("/api/sandbox/reset", { method: "POST" }));
  } catch (err) {
    store.sandbox = { state: "error", message: err.message, sandboxId: null };
    return;
  }
  if (restart) startSandbox();
  else toast("Sandbox deleted. Start a new one when you're ready.");
}

export async function signIn(code) {
  await api("/api/session", { method: "POST", body: { code } });
  store.authenticated = true;
  store.gateOpen = false;
}

export async function signOut() {
  await api("/api/session", { method: "DELETE" }).catch(() => {});
  store.authenticated = false;
  store.sandbox = { state: "unknown", message: "", sandboxId: null };
}

export async function setLlmMode(mode) {
  const { llmMode } = await api("/api/sandbox/llm-mode", { method: "POST", body: { mode } });
  store.llmMode = llmMode;
  return llmMode;
}

export function markPassed(ids) {
  const fresh = ids.filter((id) => !store.passed.includes(id));
  if (fresh.length) store.passed = [...store.passed, ...fresh];
  return ids.filter((id) => !store.celebrated.includes(id));
}
