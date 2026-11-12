// Shared state for the whole site: the route, the theme, the learner's session and sandbox,
// progress, and the hooks components register so others can drive them (type into a
// terminal, open a pane, open a file).
import { reactive, watch } from "vue";

import { forgetWork, storageKey, storagePrefix } from "./forget.js";
import fullCourse from "./generated/course-data.json";
import { courseFor, readPersona } from "./persona.js";

// The course as the learner's persona sees it (persona.js): what every page lists comes from it.
// fullCourse has every persona's.
const persona = readPersona(fullCourse);
const course = courseFor(fullCourse, persona.id);

export { course, fullCourse, storageKey, storagePrefix };

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

// #/ (the map), #/setup, #/module/A4 (the exercise page that has it, at its first beat),
// #/exercise/02-durable-session, #/admin/<tab>. A boss with its stories: its fight (#/module/E-boss). A module that isn't playable yet opens the map,
// on its card.
function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [page, id] = hash.split("/");
  if (page === "setup") return { page: "setup" };
  if (page === "badges") return { page: "badges" };
  if (page === "admin") return { page: "admin", id: id || "learners" };
  if (page === "exercise" && course.exercises.some((e) => e.id === id)) return { page: "exercise", id };
  if (page === "module") {
    const exercise = course.exercises.find((e) => e.modules.includes(id));
    if (exercise) return { page: "exercise", id: exercise.id, module: id };
    const boss = course.modules.find((m) => m.id === id && m.kind === "boss" && m.status === "ready" && m.pool?.length);
    if (boss) return { page: "boss", id };
    if (course.modules.some((m) => m.id === id)) return { page: "home", focus: id };
  }
  return { page: "home" };
}

export const store = reactive({
  route: parseRoute(),
  // The learner's persona: { id, chosen, fromUrl }. Not chosen yet: the site asks (PersonaChoice).
  persona,
  // The persona choice, opened to switch (the account menu, the map).
  personaPicker: false,
  theme: initialTheme(),
  toast: "",

  // The browser runtime, as the runner reports it.
  runtime: { checked: false, enabled: false, reason: "", idleMinutes: 30 },
  // Whether anyone can sign in here, and whether codes go to the runner's console (local).
  signInInfo: { enabled: true, reason: "", console: false },
  // Signed in, and allowed to use the course (read the modules, the sandbox, the helper).
  authenticated: false,
  // The signed-in user, allowed or not: { email, name, role, company, admin, needsProfile,
  // allowed, ended, cohort, request }, or null.
  user: null,
  // A racer in the Derby (race/): their race and jockey, from the session; else null.
  race: null,
  // A racer waiting in the Derby's stalls (race/racing.js): their sandbox warms up for the gun.
  raceWarm: false,
  // Sandbox time in the last 24 hours: { usedMinutes, limitMinutes, remainingMinutes, freesAt }.
  allowance: null,
  uiProxy: { base: null, port: null },
  gateOpen: false,

  // The learner's sandbox: none | finding | creating | waking | bootstrapping | ready | error | full
  sandbox: { state: "unknown", message: "", sandboxId: null },
  // The sandbox was ready on this page, then went away (stopped while idle, deleted, the runner
  // lost track of it or can't be reached): App.vue asks the learner to start it again.
  sandboxLost: false,
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

  // The Trip board (Essentials): the state essentials/board.py reports (from the poll, or the
  // last action), the action on its way ("start-trip"…), and when the state came.
  board: { state: null, pending: null, at: 0 },

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
  // Bumped to ask the exercise page for the Agent UI's tour (a step's ✦ Take a tour button).
  agentTourRequest: 0,
  // The archify diagram for the guide's beat (its content/architecture/… page; on a beat without
  // one, the exercise's), shown as the workspace's Diagram view: on the briefing, in place of the
  // code and the terminals, and on a step behind its Diagram tab.
  guideDiagram: null,
  // The guide's beat on show (its id): the editor shows the files that beat uses.
  guideBeat: null,
  // The map's node on show in its detail panel (MapPage): what feedback sent from the map is about.
  mapFocus: null,


  // Exercise ids whose check passed (from the sandbox), and the ones already celebrated.
  passed: load("passed", []),
  celebrated: load("celebrated", []),
});

// There was a Browser | Local switch; a choice saved then would now be stuck.
save("mode", null);
watch(() => store.passed, (passed) => save("passed", passed), { deep: true });
watch(() => store.celebrated, (ids) => save("celebrated", ids), { deep: true });

// The page before this one (its hash), for a page that closes back to it (the badge shelf).
let previousHash = "";
export const cameFrom = () => previousHash;
window.addEventListener("hashchange", (event) => {
  try {
    previousHash = new URL(event.oldURL).hash;
  } catch {
    previousHash = "";
  }
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

const hooks = { terminal: null, pane: null, send: null, session: null, sessionTab: null, file: null, todo: null, insert: null, revert: null, poll: null, editor: null, terminalSelection: null };

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
// The latest workflow whose id is the prefix and one more part (hello-sfo-jfk-1a2b): not an
// itinerary's legs (itinerary-sfo-jfk-lhr-1a2b-leg-1), which start the same way.
const findWorkflow = (prefix) => store.trips.list?.find((t) => t.id.startsWith(prefix) && !t.id.slice(prefix.length).includes("-"));

// Opens the latest workflow whose id starts with `prefix`. The page's list is polled every few
// seconds, so it's asked for afresh first: one started a moment ago may not be in it yet, and
// when an older one has the same prefix (a second hold on the same seat), that one would open
// instead. Temporal's list can lag a second behind too: ask again, for a few seconds, before
// saying it isn't there.
export async function openWorkflow(prefix, tab = null) {
  if (hooks.poll) await hooks.poll();
  let workflow = findWorkflow(prefix);
  for (let i = 0; !workflow && hooks.poll && i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await hooks.poll();
    workflow = findWorkflow(prefix);
  }
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

// --- The Trip board (Essentials) ----------------------------------------------------------------

export function setBoard(state) {
  if (state) store.board = { ...store.board, state, at: Date.now() };
}

// The board's latest trip (the last it lists), in the Temporal UI pane: its workflow, on a tab
// (the Event History, unless another is asked for).
export function openBoardTrip(tab = null) {
  const id = store.board.state?.trips?.at(-1)?.workflow_id;
  if (!id) return toast("Start a trip first: there's none in Temporal yet.");
  openPane("temporal", { workflow: id, tab });
}

// One of the board's actions, for a module: the runner runs it in the sandbox and answers with
// the board as it left it. One at a time. Quiet: no toast unless it fails (setup, on arrival).
export async function boardAction(action, module, { quiet = false } = {}) {
  if (store.board.pending) return false;
  if (store.sandbox.state !== "ready") {
    if (!quiet) toast("Start your sandbox first.");
    return false;
  }
  store.board = { ...store.board, pending: action };
  try {
    const { board } = await api("/api/sandbox/action", { method: "POST", body: { action, module } });
    setBoard(board);
    for (const ms of [800, 2000]) setTimeout(() => hooks.poll?.(), ms);
    return true;
  } catch (err) {
    toast(err.message, 5200);
    return false;
  } finally {
    store.board = { ...store.board, pending: null };
  }
}

// What the page says about a lost sandbox (the popup, and the card under the terminals).
export function sandboxLostView() {
  if (store.sandbox.idle) {
    return { title: "Your sandbox stopped while you were away", pill: "Sandbox stopped", body: `Nothing happened here for ${store.runtime.idleMinutes === 1 ? "a minute" : `${store.runtime.idleMinutes} minutes`}, so it was let go. It keeps your work: start it again to carry on where you left off (about a minute).` };
  }
  if (store.sandbox.state === "error") {
    return { title: "Lost the connection to your sandbox", pill: "Sandbox disconnected", body: `${store.sandbox.message} Your sandbox keeps your work: start it again to reconnect.` };
  }
  return { title: "Your sandbox stopped", pill: "Sandbox stopped", body: "It stops when you're idle, and keeps your work. Start it again to carry on where you left off (about a minute)." };
}

// How the guide's Start my sandbox button shows the sandbox.
const SANDBOX_BUSY = { finding: "Finding your sandbox…", creating: "Creating your sandbox…", waking: "Waking your sandbox…", bootstrapping: "Starting its services…", stopped: "Waking your sandbox…", starting: "Waking your sandbox…" };
export function sandboxStartView() {
  const { state } = store.sandbox;
  if (store.sandboxLost) return { state: "idle", label: "Start my sandbox", disabled: false };
  if (store.authenticated && state === "ready") return { state: "ready", label: "✓ Your sandbox is ready", disabled: true };
  if (store.authenticated && SANDBOX_BUSY[state]) return { state: "busy", label: SANDBOX_BUSY[state], disabled: true };
  if (store.authenticated && state === "allowance") return { state: "error", label: "Out of sandbox time", disabled: true };
  if (store.authenticated && (state === "error" || state === "full")) return { state: "error", label: "Try again", disabled: false };
  return { state: "idle", label: "Start my sandbox", disabled: false };
}

// Whether the learner's sandbox is on its way (found, created, woken, its services starting):
// the page waits for it, rather than offering what needs it.
export const sandboxStarting = () => sandboxStartView().state === "busy";

// While it starts: the stage, and about how long the rest takes.
const SANDBOX_STAGES = {
  finding: { stage: "Finding your sandbox", expect: "A moment…" },
  creating: { stage: "Creating your sandbox", expect: "About a minute, the first time." },
  waking: { stage: "Waking your sandbox", expect: "Usually under half a minute." },
  stopped: { stage: "Waking your sandbox", expect: "Usually under half a minute." },
  starting: { stage: "Waking your sandbox", expect: "Usually under half a minute." },
  bootstrapping: { stage: "Starting its services", expect: "Almost there: a few seconds." },
};
export const sandboxStage = () => SANDBOX_STAGES[store.sandbox.state] ?? SANDBOX_STAGES.finding;

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

// A challenge's choice into its file, in place of whichever of `blocks` is there (CodeEditor's
// swapBlock): { ok, message, replaced }. With quiet, the view stays as it is (the Temporal UI, say),
// and a hidden editor makes the change at once.
export async function swapInEditor(path, code, blocks, { quiet = false } = {}) {
  if (!hooks.swap) return { ok: false, message: "Open the exercise's editor first." };
  if (!quiet) store.workspaceView = "code";
  return hooks.swap(path, code, blocks);
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

// A `TODO(chNN)` in the instructions: the editor opens the file with it and lights its block.
// `prefer`: the files the sentence names; `near`: the names it mentions (`run()`, `MODEL_SCRIPT`),
// to tell several TODOs in one file apart.
export async function openTodo(marker, hints) {
  const opened = (await hooks.todo?.(marker, hints)) ?? false;
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
  if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, code: data.code, freesAt: data.freesAt });
  return data;
}

// Signed in, for the page, once they've also said who they are (name and role).
function applySession({ authenticated, user, race }) {
  store.user = user ?? null;
  // A racer in the Derby: { raceName, slug, name, horse, creature, silks, pattern, pitPass }.
  store.race = race ?? null;
  store.authenticated = Boolean(authenticated) && !user?.needsProfile;
}

export async function refreshSession() {
  try {
    const data = await api("/api/session");
    store.runtime = { checked: true, enabled: data.runtime.enabled, reason: data.runtime.reason ?? "", idleMinutes: data.runtime.idleMinutes ?? 30 };
    store.signInInfo = { enabled: data.signIn?.enabled ?? false, reason: data.signIn?.reason ?? "", console: Boolean(data.signIn?.console) };
    applySession(data);
    store.uiProxy = { base: data.uiProxyBase, port: data.uiProxyPort };
  } catch {
    store.runtime = { checked: true, enabled: false, reason: "The course runner isn't reachable." };
    store.signInInfo = { enabled: false, reason: "The course runner isn't reachable.", console: false };
    applySession({});
  }
}

export function uiProxyOrigin() {
  if (store.uiProxy.base) return store.uiProxy.base.replace(/\/$/, "");
  if (store.uiProxy.port) return `${window.location.protocol}//${window.location.hostname}:${store.uiProxy.port}`;
  return "";
}

const SETTLED = new Set(["ready", "error", "full", "none", "allowance"]);
let sandboxPoll = 0;
// Whether this page has had a ready sandbox: one that isn't any more was lost, not never started.
let wasReady = false;

// "14:20", or "tomorrow at 09:05".
export function clockTime(ms) {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `tomorrow at ${time}`;
}

export function applyAllowance(allowance) {
  if (allowance) store.allowance = allowance;
}

function applySandbox(data) {
  applyAllowance(data.allowance);
  store.sandbox = { state: data.state, message: data.message ?? "", sandboxId: data.sandboxId ?? null };
  if (data.state === "ready") {
    wasReady = true;
    store.sandboxLost = false;
  }
}

async function pollSandbox() {
  clearTimeout(sandboxPoll);
  try {
    const exercise = store.route.page === "exercise" ? store.route.id : "";
    applySandbox(await api(`/api/sandbox?exercise=${encodeURIComponent(exercise)}`));
  } catch (err) {
    if (err.status === 401 || err.status === 403) refreshSession();
    // No status: the request never got an answer (the runner, or the network, is down).
    store.sandbox = { state: "error", message: err.status ? err.message : "The course runner can't be reached.", sandboxId: null };
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
  store.sandboxLost = false;
  try {
    applySandbox(await api("/api/sandbox/start", { method: "POST" }));
  } catch (err) {
    // Out of sandbox time: say when it frees up.
    const message = err.code === "allowance" && err.freesAt ? `${err.message} It frees up at ${clockTime(Date.parse(err.freesAt))}.` : err.message;
    store.sandbox = { state: err.code === "allowance" ? "allowance" : "error", message, sandboxId: null };
    return;
  }
  pollSandbox();
}

// A signed-in learner always has a sandbox on the way: on load and after signing in, the page
// starts one if it isn't ready. Not after an error, or with the pool full: those wait for the
// learner's Start. One this page was using that isn't ready any more (stopped while idle, the
// runner restarted or can't be reached) isn't started unasked: the learner gets asked.
export async function resumeSandbox() {
  if (!store.authenticated) return;
  await pollSandbox();
  if (store.sandbox.state === "ready") return;
  if (wasReady && store.authenticated) {
    clearTimeout(sandboxPoll);
    store.sandboxLost = true;
  } else if (!["error", "full", "allowance"].includes(store.sandbox.state) && (store.allowance?.remainingMinutes ?? 1) > 0) startSandbox();
}

// Whether this page uses the sandbox: a module page, or a racer waiting in the Derby's stalls (it
// warms up for the gun). Elsewhere (the map, the badges, the admin panel) the page leaves it alone:
// neither starts it nor checks on it, since a check counts as activity to Daytona, and an open
// tab would keep it from ever stopping when idle.
export const sandboxWanted = () => store.route.page === "exercise" || store.raceWarm;

// Keeps an eye on it while a page that uses it is in front of the learner: checks again when the
// tab comes back, and every couple of minutes, so a sandbox that stopped while idle is noticed
// before the learner needs it. A hidden tab checks nothing.
const WATCH_MS = 2 * 60_000;
let sandboxWatch = 0;

export function watchSandbox() {
  const check = () => {
    if (document.visibilityState === "visible" && store.authenticated && store.runtime.enabled && !store.sandboxLost && sandboxWanted()) resumeSandbox();
  };
  document.addEventListener("visibilitychange", check);
  clearInterval(sandboxWatch);
  sandboxWatch = setInterval(check, WATCH_MS);
  // Onto a page that uses it (from the map, say): get it ready now.
  if (!routeWatched) watch(() => store.route.page, check);
  routeWatched = true;
}
let routeWatched = false;

// --- Letting go when nobody's there -----------------------------------------------------------
// A module page left open polls its sandbox every few seconds, which Daytona counts as activity:
// it would never stop. So the page watches for a person: no key, click, touch, scroll or mouse
// move on any of the site's tabs (they share the time through local storage) for the runtime's
// idle time (Daytona's own, 30 minutes), and it stops polling, asks the runner to stop the
// sandbox (keeping the work), and shows the "start it again" prompt for when they're back. A
// racer waiting in the Derby's stalls is left alone: waiting is what they're there for.
const ACTIVE_KEY = storageKey("active-at");
let activeAt = Date.now();
function markActive() {
  const now = Date.now();
  if (now - activeAt < 10_000) return;
  activeAt = now;
  try {
    localStorage.setItem(ACTIVE_KEY, String(now));
  } catch {
    /* this tab still counts */
  }
}
for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(type, markActive, { capture: true, passive: true });
window.addEventListener("storage", (event) => {
  if (event.key === ACTIVE_KEY) activeAt = Math.max(activeAt, Number(event.newValue) || 0);
});

export const idleFor = () => Date.now() - activeAt;

export async function releaseIfIdle() {
  if (!store.authenticated || !store.runtime.enabled || store.sandboxLost || store.raceWarm) return;
  if (["none", "unknown", "error", "full", "allowance"].includes(store.sandbox.state)) return;
  if (idleFor() < store.runtime.idleMinutes * 60_000) return;
  clearTimeout(sandboxPoll);
  // On a page that uses it, they're told when they're back; elsewhere (the map), it goes quietly,
  // and a module page asks to start it again when they open one.
  const here = sandboxWanted();
  store.sandbox = { state: here ? "stopped" : "unknown", message: "", sandboxId: null, idle: true };
  store.sandboxLost = here;
  await api("/api/sandbox/stop", { method: "POST" }).catch(() => {});
}
setInterval(releaseIfIdle, 60_000);

// Deletes the sandbox (the runner also gives up on a start that's in progress or stuck), and
// forgets the work this browser kept from it (forget.js). With restart, starts a new one, then
// loads the page again with ?forget, so nothing from the old sandbox lingers in memory (open
// files, the editor, Ask Temporal's answers), or comes back from a write as the page unloads.
export async function resetSandbox({ restart = false } = {}) {
  clearTimeout(sandboxPoll);
  wasReady = false;
  store.sandboxLost = false;
  store.sandbox = { state: "finding", message: "Deleting your sandbox…", sandboxId: null };
  try {
    applySandbox(await api("/api/sandbox/reset", { method: "POST" }));
  } catch (err) {
    store.sandbox = { state: "error", message: err.message, sandboxId: null };
    return;
  }
  forgetWork();
  if (restart) {
    await startSandbox();
    window.location.replace(`${window.location.pathname}?forget${window.location.hash}`);
  } else {
    toast("Sandbox deleted. Start a new one when you're ready.");
  }
}

// Sign-in: a code to the email, then the code back, then (the first time) name and role.
export async function requestCode(email) {
  const data = await api("/api/auth/start", { method: "POST", body: { email } });
  // The secret admin address is signed in at once: there's no code to wait for.
  if (data.signedIn) applySession(data);
  return data;
}

export async function verifyCode(email, code) {
  applySession(await api("/api/auth/verify", { method: "POST", body: { email, code } }));
  if (store.authenticated && !store.user?.needsProfile) store.gateOpen = false;
}

export async function saveProfile(name, role) {
  applySession(await api("/api/auth/profile", { method: "POST", body: { name, role } }));
  if (store.authenticated) store.gateOpen = false;
}

export async function signOut() {
  await api("/api/session", { method: "DELETE" }).catch(() => {});
  applySession({});
  store.allowance = null;
  wasReady = false;
  store.sandboxLost = false;
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
