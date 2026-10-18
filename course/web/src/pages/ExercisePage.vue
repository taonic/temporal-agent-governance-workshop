<script setup>
// One exercise in two columns: the workspace on the left and the guide on the right. The
// workspace is tabs (Code, Agent UI, Temporal UI: the editor, the agent's console, the Temporal
// UI) over a dock with the sandbox's terminals, so whichever you're looking at gets the whole
// width and the terminals stay in sight. The guide brings the right tab forward for each step.
// Locally: the files and the instructions only.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { closeCodeTour, codeTour } from "../codeTour.js";
import { launchConfetti } from "../confetti.js";
import CodeEditor from "../components/CodeEditor.vue";
import ExerciseInstructions from "../components/ExerciseInstructions.vue";
import MaximizeButton from "../components/MaximizeButton.vue";
import SandboxPanes from "../components/SandboxPanes.vue";
import TerminalDock from "../components/TerminalDock.vue";
import Tour from "../Tour.vue";
import {
  api,
  course,
  effectiveMode,
  load,
  markPassed,
  registerHook,
  resumeSandbox,
  runInTerminal,
  save,
  setTrips,
  setWorkerState,
  store,
  toast,
} from "../store.js";

const props = defineProps({ id: { type: String, required: true } });

const exercise = computed(() => course.exercises.find((e) => e.id === props.id));
const mode = computed(() => effectiveMode());
const live = computed(() => mode.value === "browser" && store.sandbox.state === "ready");
// Exercise 1 starts trips from buttons, which show each trip's workflow: the poll lists them.
const hasTrips = computed(() => exercise.value.modes.browser.sections.some((s) => s.html.includes("data-trip=")));
const stamps = ref({});
// The workspace (whichever tab, and the terminals) over the guide's column too.
const codeMaximized = ref(false);
// The Agent UI or the Temporal UI takes the column's whole height (the terminals step aside),
// and expanded, the whole screen.
const paneShown = computed(() => mode.value === "browser" && store.workspaceView !== "code");
const paneMaximized = computed(() => codeMaximized.value && paneShown.value);
// Back to the code (from its tab, the guide, anywhere): with the guide beside it again.
watch(
  () => store.workspaceView,
  (view) => {
    if (view === "code") codeMaximized.value = false;
  },
);
const panes = ref(null);

// A tour of the Agent UI itself, from its tab bar while it fills the screen. Its steps point
// into the Agent UI's frame; a step whose target isn't there (no session yet) is skipped.
const AGENT_UI = "iframe[title='The Agent UI']";
const agentTourOpen = ref(false);
// A step's ✦ Take a tour of the Agent UI: the Agent UI, over the whole screen, and its tour.
watch(
  () => store.agentTourRequest,
  () => {
    if (!live.value || !exercise.value.agentUi) return;
    store.workspaceView = "console";
    codeMaximized.value = true;
    agentTourOpen.value = true;
  },
);
const agentTourSteps = [
  {
    title: "The Agent UI",
    body: "Where you talk to the agent and watch what it does. Each session is a Temporal workflow, so everything here comes from its history: it survives a restarted worker or a reload.",
  },
  { frame: AGENT_UI, selector: "button.session-drawer-trigger", title: "Your sessions", body: "The Session Manager: every session, and New session to start one, where you pick the agent and its approval posture. The New session ▸ buttons in the guide open it for you." },
  { frame: AGENT_UI, selector: "button.session-anchor", title: "This session", body: "The session you're looking at, and its state. The copy button beside it copies its workflow id, to find it in the Temporal UI." },
  { frame: AGENT_UI, selector: "section.pane[aria-label^='State flow']", title: "State flow", body: "The session as a graph, live: each model call, each script the agent writes, and every tool call the script makes, as an activity." },
  { frame: AGENT_UI, selector: "section.pane[aria-label^='Agent chat']", title: "Agent chat", body: "The conversation. The agent's forms (the trip form) and approval requests appear here, for you to fill in or decide." },
  { frame: AGENT_UI, selector: "form.composer", title: "Talk to the agent", body: "Type a message here, or use a Send ▸ button in the guide. Retry and Stop sit just above." },
  { frame: AGENT_UI, selector: "button[aria-label='Open a view']", title: "More views", body: "Add panes: Approval decisions, Agent state, VFS File Mounts, Logs, Latency and Tokens. The later exercises use some of them." },
  { frame: AGENT_UI, selector: "input.scrub-input", title: "Replay", body: "Step back through the session's events, or play them back, to see how it got where it is." },
  { selector: ".workspace-actions .maximize-btn", title: "Back to the guide", body: "Restore the layout here when you're done. (Esc does it too, unless you clicked into the Agent UI.)" },
];
const VIEWS = [
  { key: "code", label: "Code" },
  { key: "console", label: "Agent UI", title: "The Agent UI: talk to the agent here" },
  { key: "temporal", label: "Temporal UI", title: "Your sandbox's Temporal UI: workflows and their histories" },
];
// No Agent UI before there's an agent (exercise 1).
const views = computed(() => VIEWS.filter((view) => view.key !== "console" || exercise.value.agentUi));
watch(
  () => props.id,
  () => {
    if (store.workspaceView === "console" && !exercise.value.agentUi) store.workspaceView = "code";
  },
  { immediate: true },
);
function showView(key) {
  if (key !== "code" && !live.value) return toast("Start your sandbox to open it.");
  store.workspaceView = key;
}
// Double-click the tab bar's empty space to expand or restore.
function onTabsDblclick(event) {
  if (event.target === event.currentTarget) codeMaximized.value = !codeMaximized.value;
}
function onMaximizedKey(event) {
  // Esc in a tour ends the tour, not the expanded view.
  if (event.key !== "Escape" || !codeMaximized.value || agentTourOpen.value || store.pageTourOpen) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, .cm-editor, .xterm, [contenteditable]")) return;
  codeMaximized.value = false;
}
const dock = ref(null);

// Resizable columns and dock, remembered per browser.
const codeWidth = ref(load("code-width", ""));
const dockHeight = ref(load("dock-height", 260));

function drag(event, onMove, done) {
  event.preventDefault();
  document.body.classList.add("is-resizing");
  const move = (e) => onMove(e);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("is-resizing");
    done();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// The splitter sets the workspace column as a share of the shell, clamped so both columns stay
// usable.
function resizeCode(event) {
  const shell = event.currentTarget.parentElement;
  drag(
    event,
    (e) => {
      const styles = getComputedStyle(shell);
      const left = parseFloat(styles.paddingLeft) || 0;
      const rect = shell.getBoundingClientRect();
      const inner = rect.width - left - (parseFloat(styles.paddingRight) || 0);
      const ratio = ((e.clientX - rect.left - left) / inner) * 100;
      codeWidth.value = `${Math.min(78, Math.max(28, ratio)).toFixed(2)}%`;
    },
    () => save("code-width", codeWidth.value),
  );
}

function resizeDock(event) {
  const startY = event.clientY;
  const start = dockHeight.value;
  drag(
    event,
    (e) => {
      dockHeight.value = Math.round(Math.min(window.innerHeight * 0.75, Math.max(120, start - (e.clientY - startY))));
    },
    () => save("dock-height", dockHeight.value),
  );
}

const shellStyle = computed(() => ({
  "--code-col": codeWidth.value || undefined,
  "--dock-height": `${dockHeight.value}px`,
}));

// --- The sandbox poll: file changes, passed checks, the model mode ------------------------

let pollTimer = 0;
// The runner gave the sandbox a new model address (it restarted behind a new tunnel, say): the
// running travel worker still has the old one, so it starts again. The poll reports it once.
// The sandbox just filled in earlier exercises' TODOs with their solutions (runner poll): say so,
// and restart a running worker so it runs them.
function caughtUp(numbers, worker) {
  const names = numbers.length > 1 ? `Exercises ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}` : `Exercise ${numbers[0]}`;
  const restart = worker?.running && !store.worker.pending;
  toast(`${names} ${numbers.length > 1 ? "are" : "is"} solved in your sandbox, so this one doesn't depend on ${numbers.length > 1 ? "them" : "it"}${restart ? ": restarting the worker" : ""}`, 5200);
  if (restart) runInTerminal("worker", [worker.name === "hello-worker" ? "uv run hello-worker" : "uv run travel-worker"], { interrupt: true, reveal: false });
}

function restartStaleWorker() {
  if (store.worker.pending) return;
  toast("Your sandbox's model address changed: restarting the worker", 4200);
  runInTerminal("worker", ["uv run travel-worker"], { reveal: false });
}

async function poll() {
  clearTimeout(pollTimer);
  if (!live.value) return;
  if (document.visibilityState === "visible") {
    try {
      const files = exercise.value.files.map((f) => f.path).join(",");
      const trips = hasTrips.value ? "&trips=1" : "";
      const data = await api(`/api/sandbox/poll?exercise=${encodeURIComponent(props.id)}&files=${encodeURIComponent(files)}${trips}`);
      stamps.value = data.files;
      store.llmMode = data.llmMode;
      if (data.worker) setWorkerState(data.worker);
      if (data.caughtUp?.length) caughtUp(data.caughtUp, data.worker);
      else if (data.worker?.stale) restartStaleWorker();
      if (data.trips) setTrips(data);
      const fresh = markPassed(data.passed);
      if (fresh.includes(props.id)) celebrate();
      else if (fresh.length) store.celebrated = [...store.celebrated, ...fresh];
    } catch (err) {
      if (err.status === 409 || err.status === 401) {
        store.sandbox = { state: "unknown", message: "", sandboxId: null };
        resumeSandbox();
        return;
      }
    }
  }
  pollTimer = setTimeout(poll, 4000);
}

function celebrate() {
  store.celebrated = [...store.celebrated, props.id];
  toast(`✓ ${exercise.value.optional ? "Capstone" : `Exercise ${exercise.value.number}`} passed`, 3500);
  try {
    launchConfetti();
  } catch {
    /* best effort */
  }
}

watch(live, (now) => (now ? poll() : clearTimeout(pollTimer)), { immediate: true });
watch(() => props.id, (id) => {
  stamps.value = {};
  codeMaximized.value = false;
  store.workspaceView = "code";
  if (live.value) poll();
});

// --- The code tour: the guide offers it at the end of the briefing ------------------------------

watch(
  () => props.id,
  () => {
    if (codeTour.open && codeTour.exercise !== props.id) closeCodeTour();
  },
);

// --- Exercise actions -----------------------------------------------------------------------

function solve() {
  // The files the solve script replaces: scratch files have no solution.
  const editable = exercise.value.files.filter((f) => f.editable && !f.scratch).map((f) => f.path).join(", ");
  if (window.confirm(`This runs ${exercise.value.scripts.solve}, replacing ${editable || "the exercise's files"} with the official solution.`)) {
    runInTerminal("commands", [exercise.value.scripts.solve], { interrupt: true });
  }
}

// After the guide confirmed it (ExerciseInstructions). In the worker terminal, so a running
// worker is stopped first and started again on the restored code once the script is done.
async function reset() {
  const script = exercise.value.scripts.reset;
  if (mode.value === "local") {
    try {
      await navigator.clipboard.writeText(script);
      toast(`Copied: run ${script} in your clone to put the code back`, 4200);
    } catch {
      toast(`Run ${script} in your clone to put the code back`, 4200);
    }
    return;
  }
  const command = store.worker.running ? `${script} && ${exercise.value.worker}` : script;
  runInTerminal("worker", [command], { interrupt: true });
}

function check() {
  store.workspaceView = "code"; // the terminals, to watch it run
  dock.value?.runCheck();
}

function onVisibility() {
  if (document.visibilityState === "visible" && live.value) poll();
}
// No sandbox, no worker to know about.
watch(live, (now) => {
  if (!now) {
    store.workspaceView = "code";
    store.worker = { running: null, name: null, env: {}, pending: null };
    store.trips = { list: null, starter: false, pending: {} };
  }
});

let unregisterPoll = null;
onMounted(() => {
  window.addEventListener("keydown", onMaximizedKey);
  document.addEventListener("visibilitychange", onVisibility);
  unregisterPoll = registerHook("poll", () => live.value && poll());
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onMaximizedKey);
  clearTimeout(pollTimer);
  closeCodeTour();
  document.removeEventListener("visibilitychange", onVisibility);
  unregisterPoll?.();
});
</script>

<template>
  <main v-if="exercise" class="exercise-shell" :class="[`mode-${mode}`, { 'guide-only': store.guideOnly, 'code-maximized': codeMaximized, 'pane-maximized': paneMaximized, 'pane-shown': paneShown }]" :style="shellStyle">
    <section class="workspace-panel code-panel" aria-label="Workspace">
      <div v-if="mode === 'browser'" class="workspace-tabs" role="tablist" aria-label="Workspace" data-tour="workspace-tabs" @dblclick="onTabsDblclick">
        <button
          v-for="view in views"
          :key="view.key"
          class="workspace-tab"
          :class="{ active: store.workspaceView === view.key }"
          type="button"
          role="tab"
          :aria-selected="store.workspaceView === view.key"
          :disabled="view.key !== 'code' && !live"
          :title="view.key !== 'code' && !live ? 'Start your sandbox first' : view.title"
          @click="showView(view.key)"
        >
          {{ view.label }}
        </button>
        <div class="workspace-actions" @dblclick.stop>
          <button v-if="paneMaximized && store.workspaceView === 'console' && live" class="icon-btn workspace-tour" type="button" title="A tour of the Agent UI" @click="agentTourOpen = true">Tour</button>
          <template v-if="store.workspaceView !== 'code' && live">
            <button class="icon-btn" type="button" title="Reload this view" @click="panes?.reload()">↻</button>
            <a class="icon-btn" :class="{ disabled: !panes?.newTabHref }" :href="panes?.newTabHref || undefined" target="_blank" rel="noopener" title="Open in a new tab">↗</a>
          </template>
          <MaximizeButton
            :maximized="codeMaximized"
            :what="store.workspaceView === 'code' ? 'the workspace' : `the ${VIEWS.find((v) => v.key === store.workspaceView).label}`"
            :to="store.workspaceView === 'code' ? 'the whole workspace' : 'the whole screen'"
            @toggle="codeMaximized = !codeMaximized"
          />
        </div>
      </div>
      <div class="workspace-views">
        <CodeEditor
          v-show="mode === 'local' || store.workspaceView === 'code'"
          v-model:maximized="codeMaximized"
          :exercise="exercise"
          :live="live"
          :local="mode === 'local'"
          :stamps="stamps"
          :shown="mode === 'local' || store.workspaceView === 'code'"
          :maximizable="mode === 'local'"
        />
        <!-- Mounted while the sandbox is up and only hidden behind Code, so its frames stay loaded. -->
        <SandboxPanes v-if="live" ref="panes" :live="live" />
      </div>
      <template v-if="mode === 'browser'">
        <div class="dock-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize the terminals" @pointerdown="resizeDock" />
        <TerminalDock ref="dock" :exercise="exercise" :live="live" />
      </template>
    </section>

    <div class="col-resizer" role="separator" aria-orientation="vertical" aria-label="Resize panels" @pointerdown="resizeCode" />
    <ExerciseInstructions :exercise="exercise" :live="live" @check="check" @solve="solve" @reset="reset" />
    <Tour v-if="agentTourOpen" :steps="agentTourSteps" @finish="agentTourOpen = false" />
  </main>
</template>
