<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import Tour from "./Tour.vue";
import AccessForm from "./components/AccessForm.vue";
import AskSelection from "./components/AskSelection.vue";
import EarnMoment from "./components/EarnMoment.vue";
import FeedbackForm from "./components/FeedbackForm.vue";
import ModuleNav from "./components/ModuleNav.vue";
import WelcomeIntro from "./components/WelcomeIntro.vue";
import XpPill from "./components/XpPill.vue";
import { closeFeedback, feedback, openFeedback } from "./feedback.js";
import { closeHelper, helper, refreshHelper, resumeAfterConnect, toggleHelper } from "./helper.js";
import { shouldShowIntro } from "./intro.js";
import BadgesPage from "./pages/BadgesPage.vue";
import ExercisePage from "./pages/ExercisePage.vue";
import MapPage from "./pages/MapPage.vue";
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
// The admin panel, for ADMIN_EMAILS: loaded only for them.
const AdminPage = defineAsyncComponent(() => import("./pages/AdminPage.vue"));
const helperUsed = ref(false);
watch(() => helper.open, (open) => open && (helperUsed.value = true), { immediate: true });

// The welcome intro, over the map, for a visitor landing on the home page. As it fades, the
// map's panels arrive under it (is-arriving): started then, not after, or the page would show
// through the fade and then blink out to arrive.
const introOpen = ref(shouldShowIntro(store.route));
const arriving = ref(false);
function revealPage() {
  arriving.value = true;
  setTimeout(() => (arriving.value = false), 1400);
}

const menuOpen = ref(false);
const accountOpen = ref(false);
// Module pages need a sign-in (the map and the setup page don't): until the session is known,
// nothing; then the page, or the sign-in in its place.
const gated = computed(() => store.route.page === "exercise" && store.runtime.checked && !store.authenticated);
// Ten minutes or less of sandbox time left, with the sandbox running: say so, and when it stops.
const allowanceNote = computed(() => {
  const a = store.allowance;
  if (!store.authenticated || !a || a.remainingMinutes > 10 || store.sandbox.state !== "ready") return "";
  const left = a.remainingMinutes <= 1 ? "less than a minute" : `${a.remainingMinutes} minutes`;
  return `${left} of sandbox time left today (${Math.round(a.limitMinutes / 60)} hours a day). Your sandbox stops then, and keeps your work.`;
});

// Signed in, but not let in (yet): a request pending or turned down, or a cohort that ended.
const waitingNote = computed(() => {
  const user = store.user;
  if (!user || user.allowed) return "";
  if (user.ended) return "Your cohort has ended, so the modules are closed. Explore the map, or ask the course team to carry on.";
  if (user.request?.status === "pending") return "Request pending: we'll email you when you're in. Meanwhile, explore the map.";
  if (user.request?.status === "rejected") return "Your request for the course wasn't approved.";
  return "";
});
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
  allowance: "Out of sandbox time",
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
    accountOpen.value = false;
    closeFeedback(); // it's about the page it was opened on (its draft is kept)
    if (["home", "admin", "badges"].includes(store.route.page)) closeHelper();
    window.scrollTo({ top: 0 });
  },
);

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
  { selector: "[data-tour='breadcrumb']", title: "Where you are", body: "The branch and the module you're on, its branch's modules as dots (each one a link), and Next. Map takes you back to the skill tree, where every module is a node." },
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
  if (["home", "admin", "badges"].includes(store.route.page)) return; // no Ask Temporal there
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
// Feedback is for signed-in users: signing out closes the form.
watch(() => store.user, (user) => !user && closeFeedback());


</script>

<template>
  <div class="app-frame" :class="{ 'with-helper': helper.open, 'is-arriving': arriving }" :style="{ '--ask-width': `${helper.width}px` }" :inert="introOpen">
    <header class="topbar">
      <a class="brand" href="#/">
        <img class="brand-image" src="/course-visual.png" alt="">
        <span class="brand-copy">
          <span class="eyebrow">Learn Temporal</span>
          <span class="brand-title">Temporal Quest</span>
        </span>
      </a>
      <nav class="topbar-controls" aria-label="Course">
        <ModuleNav v-if="exercise && store.authenticated" :exercise="exercise" />
        <a v-else-if="store.route.page !== 'home'" class="button button-secondary" href="#/">Map</a>
        <XpPill />
        <!-- Not on the map or in the admin panel: there, the tree (or the panel) is the only thing to do. -->
        <template v-if="!['home', 'admin', 'badges'].includes(store.route.page) && !gated">
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
        <!-- On a module page the bar is full: just the icon there. -->
        <button v-if="store.user" class="button button-secondary feedback-button" :class="{ 'is-compact': exercise }" type="button" title="Send feedback to the course team" aria-label="Feedback" @click="openFeedback()">
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M4 4h12v9H9l-4 3v-3H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
          <span class="feedback-button-label">Feedback</span>
        </button>
        <button v-if="store.runtime.checked && !store.user" class="button button-primary" type="button" @click="store.gateOpen = true">Sign in</button>
        <div v-else-if="store.user" class="sandbox-menu account-menu">
          <button class="button button-secondary account-button" type="button" :aria-expanded="accountOpen" :title="store.user.email" @click="accountOpen = !accountOpen">
            <span class="account-initial" aria-hidden="true">{{ (store.user.name || store.user.email)[0].toUpperCase() }}</span><span class="account-name">{{ store.user.name || store.user.email }}</span>
          </button>
          <div v-if="accountOpen" class="menu" role="menu" @keydown.escape="accountOpen = false">
            <p class="menu-note">Signed in as <strong>{{ store.user.email }}</strong>{{ store.user.cohort ? ` · ${store.user.cohort.name}` : "" }}</p>
            <button class="menu-item" type="button" role="menuitem" @click="openFeedback(); accountOpen = false">Send feedback</button>
            <a v-if="store.user.admin" class="menu-item" role="menuitem" href="#/admin" @click="accountOpen = false">Admin panel</a>
            <button class="menu-item" type="button" role="menuitem" @click="signOut(); accountOpen = false">Sign out</button>
          </div>
        </div>
        <button class="button button-secondary theme-toggle" type="button" :aria-pressed="store.theme === 'dark'" :title="store.theme === 'dark' ? 'Light mode' : 'Dark mode'" @click="store.theme = store.theme === 'dark' ? 'light' : 'dark'">
          {{ store.theme === "dark" ? "☀" : "☾" }}
        </button>
      </nav>
    </header>

    <p v-if="waitingNote" class="waiting-banner" role="status">{{ waitingNote }}</p>
    <p v-else-if="allowanceNote" class="waiting-banner" role="status">{{ allowanceNote }}</p>
    <MapPage v-if="store.route.page === 'home'" />
    <SetupPage v-else-if="store.route.page === 'setup'" />
    <BadgesPage v-else-if="store.route.page === 'badges'" />
    <AdminPage v-else-if="store.route.page === 'admin' && store.user?.admin" />
    <section v-else-if="store.route.page === 'admin'" class="sign-in-page">
      <div class="sign-in-card">
        <p class="panel-kicker">Admin panel</p>
        <h2>{{ store.user ? "This is for the course's admins" : "Sign in" }}</h2>
        <p v-if="store.user">{{ store.user.email }} isn't one of them. <a href="#/">Back to the map</a></p>
        <AccessForm v-else label="Sign in" :start="false" />
      </div>
    </section>
    <section v-else-if="gated" class="sign-in-page">
      <div class="sign-in-card">
        <p class="panel-kicker">{{ exercise?.title ?? "Temporal Quest" }}</p>
        <h2>{{ store.user ? "This module opens once you're in" : "Sign in to start this module" }}</h2>
        <p v-if="!store.user">The map is open to everyone. The modules, your own cloud sandbox and Ask Temporal are for signed-in learners. Use your work email: we'll send you a code.</p>
        <AccessForm label="Sign in" :start="false" />
      </div>
    </section>
    <ExercisePage v-else-if="exercise && store.authenticated" :id="exercise.id" :key="browserMode ? 'b' : 'l'" />
  </div>

  <EarnMoment />

  <div v-if="store.gateOpen" class="modal-backdrop" @click.self="store.gateOpen = false">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Sign in">
      <h3>Sign in to Temporal Quest</h3>
      <p>Use your work email: we'll send you a code.</p>
      <AccessForm label="Sign in" :start="store.route.page === 'exercise'" @done="store.gateOpen = false" />
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

  <FeedbackForm v-if="feedback.open && store.user" />

  <AskTemporal v-if="helperUsed" />
  <AskSelection />
  <div class="toast" :class="{ visible: store.toast }" role="status" aria-live="polite">{{ store.toast }}</div>
  <Tour v-if="tourVisible" :steps="tourSteps" @finish="finishTour" />
  <WelcomeIntro v-if="introOpen" @reveal="revealPage" @done="introOpen = false" />
</template>
