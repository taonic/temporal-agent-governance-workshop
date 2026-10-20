<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import Tour from "./Tour.vue";
import AccessForm from "./components/AccessForm.vue";
import AskSelection from "./components/AskSelection.vue";
import { closeHelper, helper, refreshHelper, resumeAfterConnect, toggleHelper } from "./helper.js";
import ExercisePage from "./pages/ExercisePage.vue";
import HomePage from "./pages/HomePage.vue";
import SetupPage from "./pages/SetupPage.vue";
import {
  course,
  editorContext,
  effectiveMode,
  navigate,
  refreshSession,
  resetSandbox,
  resumeSandbox,
  runInTerminal,
  sandboxLostView,
  save,
  setLlmMode,
  signOut,
  startSandbox,
  store,
  toast,
  watchSandbox,
} from "./store.js";

// Ask Temporal's panel (and its Markdown and highlighting) loads the first time it opens.
const AskTemporal = defineAsyncComponent(() => import("./components/AskTemporal.vue"));
const helperUsed = ref(false);
watch(() => helper.open, (open) => open && (helperUsed.value = true), { immediate: true });

const menuOpen = ref(false);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const tourVisible = ref(false);
watch(tourVisible, (open) => (store.pageTourOpen = open));

const exercise = computed(() => (store.route.page === "exercise" ? course.exercises.find((e) => e.id === store.route.id) : null));
const browserMode = computed(() => effectiveMode() === "browser");

const SANDBOX_LABELS = {
  ready: "Sandbox ready",
  finding: "Finding sandbox…",
  creating: "Creating sandbox…",
  waking: "Waking sandbox…",
  bootstrapping: "Starting services…",
  stopped: "Waking sandbox…",
  starting: "Waking sandbox…",
  error: "Sandbox problem",
  full: "No sandbox free",
  none: "No sandbox yet",
  unknown: "Sandbox",
};
const sandboxLabel = computed(() => {
  if (!store.authenticated) return "Browser sandbox";
  if (store.sandboxLost) return sandboxLostView().pill;
  return SANDBOX_LABELS[store.sandbox.state] ?? store.sandbox.state;
});
const sandboxPillState = computed(() => (!store.authenticated ? "signed-out" : store.sandboxLost ? "none" : store.sandbox.state));

// The popup that asks to start a lost sandbox again. Not now leaves it to the page's own
// Start buttons; losing it again later asks again.
const lostDismissed = ref(false);
watch(() => store.sandboxLost, () => (lostDismissed.value = false));
const lostPromptOpen = computed(() => store.sandboxLost && !lostDismissed.value && !store.gateOpen);
const lostStartButton = ref(null);
watch(lostPromptOpen, (open) => open && nextTick(() => lostStartButton.value?.focus()));

function startLostSandbox() {
  startSandbox();
  toast("Starting your sandbox…");
}

watch(
  () => store.theme,
  (theme) => {
    document.documentElement.dataset.theme = theme;
    save("theme", theme);
  },
  { immediate: true },
);

watch(
  () => [store.route.page, store.route.id],
  () => {
    menuOpen.value = false;
    if (store.route.page === "home") closeHelper();
    window.scrollTo({ top: 0 });
  },
);

// The picker and Previous/Next walk the course in order: the overview, then the exercises.
// (The setup guide isn't one of them: its links lead there.)
const pages = [
  { value: "#/", label: "Overview" },
  ...course.exercises.map((e) => ({ value: `#/exercise/${e.id}`, label: `Exercise ${e.number}${e.bonus ? " (bonus)" : ""}: ${e.title}`, id: e.id })),
];
const current = computed(() =>
  store.route.page === "exercise" ? `#/exercise/${store.route.id}` : store.route.page === "setup" ? "#/setup" : "#/",
);
const position = computed(() => pages.findIndex((p) => p.value === current.value));

function go(offset) {
  const next = pages[position.value + offset];
  if (next) navigate(next.value);
}

async function toggleModel() {
  const next = store.llmMode === "scripted" ? "openai" : "scripted";
  try {
    await setLlmMode(next);
    toast(next === "scripted" ? "Scripted model on: restarting the worker" : "Gemini on: restarting the worker");
    if (exercise.value) runInTerminal("worker", [exercise.value.worker]);
  } catch (err) {
    toast(err.message);
  }
  menuOpen.value = false;
}

function confirmReset() {
  menuOpen.value = false;
  // Deleted and a new one started, in one go: starting over isn't done until there's a sandbox.
  if (window.confirm("Start over with a new sandbox? The current one is deleted, with your edits, sessions and bookings in it, and a new one starts right away (about a minute).")) {
    resetSandbox({ restart: true });
  }
}

const tourSteps = [
  {
    title: "Welcome",
    body: "You'll build one travel agent on Temporal, make it durable, put a human in the loop, then let a policy decide what it may do on its own. Here's the page in a minute.",
  },
  { selector: "[data-tour='exercise-picker']", title: "Pick an exercise", body: "Four exercises, each building on the last; the fourth is a bonus. Jump between them here, or use Previous / Next." },
  { selector: "[data-tour='editor']", title: "Edit the code", body: "This is your editor, with the exercise's files as tabs. The file with the TODO is editable and saves to your sandbox as you type. Stuck? Switch to the solution." },
  { selector: "[data-tour='terminals']", title: "Two real terminals", body: "Side by side: the worker terminal runs the process the exercises make you stop and restart, and the commands terminal is for everything else. The ▶ buttons type into the right one, so you always see what they did." },
  { selector: "[data-tour='terminal-actions']", title: "Run it, check it", body: "Stop or start the worker (the toggle shows whether it's running), and run the exercise's check." },
  { selector: "[data-tour='workspace-tabs']", title: "Code, Temporal UI, Agent UI", body: "The workspace shows one at a time, at full width, with the terminals underneath: your code, your sandbox's Temporal UI, and from exercise 2, the Agent UI where you talk to the agent. The guide brings the right one forward for each step." },
  { selector: "[data-tour='instructions']", title: "Your guide", body: "The guide takes you through the exercise one step at a time: say Done to move on, or ← Back to look again. Ask it about the step you're on at the bottom; Ask Temporal answers right there. ▶ on a command types it into a terminal; a file name opens the file; localhost links open the pane." },
  { selector: ".snippet-insert", title: "Code from right to left", body: "← Insert puts a snippet into the editor where it belongs (in place of the TODO, or at the end of the policy), and flashes the lines it added." },
  { selector: ".guide-restart", title: "Start over", body: "Start this exercise again in a new sandbox, with its code as it starts, back at its first step. The old sandbox and your edits in it are deleted, so it asks first." },
  { selector: "[data-tour='sandbox-menu']", title: "Your sandbox", body: "It stops when you're idle and wakes when you come back. Here you can switch to the scripted model, or start over with a fresh sandbox." },
  { selector: "[data-tour='ask']", title: "Ask Temporal", body: `Stuck, or curious? Ask anything about Temporal: answers come from Temporal's docs, with links, and know which exercise you're on. Select text anywhere (an error in a terminal, say) and click ✦ Ask to ask about it. Shortcut: ${isMac ? "⌘K" : "Ctrl+K"}.` },
];

// ⌘K / Ctrl+K opens and closes Ask Temporal, with whatever is selected in the editor or the
// page. Not in a terminal off a Mac, where Ctrl+K belongs to the shell.
function onShortcut(event) {
  // Esc closes the panel, unless the editor or a terminal (which use Esc themselves) has focus.
  if (event.key === "Escape" && helper.open && !(event.target instanceof Element && event.target.closest(".code-mirror-host, .xterm"))) {
    closeHelper();
    return;
  }
  if (event.key.toLowerCase() !== "k" || event.shiftKey || event.altKey || !(isMac ? event.metaKey : event.ctrlKey)) return;
  if (store.route.page === "home") return; // no Ask Temporal on the home page
  if (!isMac && event.target instanceof Element && event.target.closest(".xterm")) return;
  event.preventDefault();
  // A read-only editor never has focus, so where the selection is decides, not focus.
  const dom = window.getSelection();
  const anchor = dom?.anchorNode instanceof Element ? dom.anchorNode : dom?.anchorNode?.parentElement;
  const inEditor = [event.target, anchor].some((el) => el instanceof Element && el.closest(".code-mirror-host"));
  const editor = inEditor ? editorContext() : null;
  const page = dom?.toString() ?? "";
  const selection = editor?.selection?.trim()
    ? { text: editor.selection, source: "editor", path: editor.path }
    : page.trim() && anchor?.closest(".instruction-content, .reading")
      ? { text: page, source: "instructions" }
      : null;
  toggleHelper(selection ? { selection } : undefined);
}

function startTour() {
  // The tour is about an exercise page: take one there first.
  if (store.route.page !== "exercise") {
    navigate(`#/exercise/${course.exercises[0].id}`);
    setTimeout(() => (tourVisible.value = true), 400);
    return;
  }
  tourVisible.value = true;
}

function finishTour() {
  tourVisible.value = false;
}

// The guide's getting-started step asks for the tour (ExerciseInstructions).
watch(() => store.pageTourRequest, startTour);

onMounted(async () => {
  window.addEventListener("keydown", onShortcut);
  await refreshSession();
  if (store.authenticated && store.runtime.enabled) resumeSandbox();
  watchSandbox();
  refreshHelper().then(resumeAfterConnect);
});

onBeforeUnmount(() => window.removeEventListener("keydown", onShortcut));

// Signing in or out (from the sandbox menu too) changes what the helper can do.
watch(() => store.authenticated, () => refreshHelper());


</script>

<template>
  <div class="app-frame" :class="{ 'with-helper': helper.open }" :style="{ '--ask-width': `${helper.width}px` }">
    <header class="topbar">
      <a class="brand" href="#/">
        <img class="brand-image" src="/course-visual.png" alt="">
        <span class="brand-copy">
          <span class="eyebrow">Temporal Workshop</span>
          <span class="brand-title">Reliable AI Agents</span>
        </span>
      </a>
      <nav class="topbar-controls" aria-label="Course">
        <!-- Not on the home page: there, Start is the only way in, and the only thing to do. -->
        <template v-if="store.route.page !== 'home'">
          <button class="button button-secondary" type="button" :disabled="position <= 0" @click="go(-1)">Previous</button>
          <label class="exercise-picker" data-tour="exercise-picker">
            <span class="visually-hidden">Go to</span>
            <select :value="current" @change="navigate($event.target.value)">
              <option v-if="position < 0" :value="current" disabled>Set up on your machine</option>
              <option v-for="page in pages" :key="page.value" :value="page.value">
                {{ page.label }}{{ page.id && store.passed.includes(page.id) ? "  ✓" : "" }}
              </option>
            </select>
          </label>
          <button class="button button-secondary" type="button" :disabled="position >= pages.length - 1" @click="go(1)">Next</button>
          <div v-if="store.runtime.enabled" class="sandbox-menu" data-tour="sandbox-menu">
            <button class="button sandbox-pill" :class="`state-${sandboxPillState}`" type="button" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
              <span class="sandbox-dot" aria-hidden="true" />{{ sandboxLabel }}
            </button>
            <div v-if="menuOpen" class="menu" role="menu" @keydown.escape="menuOpen = false">
              <template v-if="!store.authenticated">
                <AccessForm @done="menuOpen = false" />
              </template>
              <template v-else>
                <p class="menu-note">{{ store.sandboxLost ? sandboxLostView().title + "." : store.sandbox.message || "Your own cloud sandbox for the workshop." }}</p>
                <button v-if="store.sandboxLost || store.sandbox.state === 'none' || store.sandbox.state === 'error'" class="menu-item" type="button" role="menuitem" @click="startSandbox(); menuOpen = false">Start my sandbox</button>
                <button class="menu-item" type="button" role="menuitem" :disabled="store.sandbox.state !== 'ready'" @click="toggleModel">
                  Model: <strong>{{ store.llmMode === "scripted" ? "scripted" : "Gemini" }}</strong> · switch to {{ store.llmMode === "scripted" ? "Gemini" : "the scripted agent" }}
                </button>
                <button class="menu-item" type="button" role="menuitem" :disabled="store.sandbox.state === 'none'" @click="confirmReset">Start over with a new sandbox</button>
                <button class="menu-item" type="button" role="menuitem" @click="signOut(); menuOpen = false">Sign out</button>
              </template>
            </div>
          </div>
          <button
            class="button ask-button"
            :class="{ active: helper.open }"
            type="button"
            data-tour="ask"
            :aria-expanded="helper.open"
            :title="`Ask Temporal (${isMac ? '⌘K' : 'Ctrl+K'})`"
            @click="toggleHelper()"
          >
            <span class="ask-button-mark" aria-hidden="true">✦</span><span class="ask-button-label">Ask Temporal</span><kbd>{{ isMac ? "⌘K" : "Ctrl K" }}</kbd>
          </button>
          <button class="button button-secondary" type="button" title="Take the tour" @click="startTour">Tour</button>
        </template>
        <button class="button button-secondary theme-toggle" type="button" :aria-pressed="store.theme === 'dark'" :title="store.theme === 'dark' ? 'Light mode' : 'Dark mode'" @click="store.theme = store.theme === 'dark' ? 'light' : 'dark'">
          {{ store.theme === "dark" ? "☀" : "☾" }}
        </button>
      </nav>
    </header>

    <HomePage v-if="store.route.page === 'home'" />
    <SetupPage v-else-if="store.route.page === 'setup'" />
    <ExercisePage v-else-if="exercise" :id="exercise.id" :key="browserMode ? 'b' : 'l'" />
  </div>

  <div v-if="store.gateOpen" class="modal-backdrop" @click.self="store.gateOpen = false">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Access code">
      <h3>Run the workshop in your browser</h3>
      <p>Enter the access code your instructor gave you.</p>
      <AccessForm @done="store.gateOpen = false" />
    </div>
  </div>

  <div v-if="lostPromptOpen" class="modal-backdrop" @click.self="lostDismissed = true" @keydown.escape="lostDismissed = true">
    <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="sandbox-lost-title" aria-describedby="sandbox-lost-body">
      <h3 id="sandbox-lost-title">{{ sandboxLostView().title }}</h3>
      <p id="sandbox-lost-body">{{ sandboxLostView().body }}</p>
      <div class="status-actions">
        <button ref="lostStartButton" class="button button-primary" type="button" @click="startLostSandbox">Start my sandbox</button>
        <button class="button" type="button" @click="lostDismissed = true">Not now</button>
      </div>
    </div>
  </div>

  <AskTemporal v-if="helperUsed" />
  <AskSelection />
  <div class="toast" :class="{ visible: store.toast }" role="status" aria-live="polite">{{ store.toast }}</div>
  <Tour v-if="tourVisible" :steps="tourSteps" @finish="finishTour" />
</template>
