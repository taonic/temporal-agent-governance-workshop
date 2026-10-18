<script setup>
// The sandbox's two web UIs, each in one long-lived iframe, as views of the workspace beside
// Code (ExercisePage's tabs choose one): the Agent UI (the harness's console, proxied under
// /sbx/console/ on this origin) and the Temporal UI (on the UI proxy's port). A view that isn't
// showing is only hidden, so neither reloads or loses its place.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { registerHook, store, toast, uiProxyOrigin } from "../store.js";

const props = defineProps({
  live: { type: Boolean, default: false },
});

// "console" or "temporal" while one of them shows; "code" hides both.
const active = computed(() => store.workspaceView);
const consoleFrame = ref(null);
const temporalFrame = ref(null);
const loaded = ref({ console: false, temporal: false });
const consoleSrc = ref("");
const temporalSrc = ref("");
let temporalReady = false;
let pending = null; // where the Temporal UI should go once it's ready: { path } or { workflow, tab }
let navFallback = 0;

const origin = computed(() => uiProxyOrigin());

function mountFrames() {
  if (!props.live) {
    consoleSrc.value = "";
    temporalSrc.value = "";
    temporalReady = false;
    return;
  }
  if (!consoleSrc.value) consoleSrc.value = "/sbx/console/";
  if (!temporalSrc.value && origin.value) temporalSrc.value = `${origin.value}/`;
}

// The Temporal UI navigates client-side on request (see the loader the runner injects), so a
// link opens a workflow without reloading the whole UI. A path, or a workflow and a tab of its
// latest run (the loader finds the run).
function navigateTemporal(target) {
  const nav = typeof target === "string" ? { path: target } : target;
  if (!nav?.workflow && (!nav?.path || nav.path === "/")) return;
  pending = nav;
  if (!temporalReady) return;
  temporalFrame.value?.contentWindow?.postMessage({ __course: "nav", ...nav }, origin.value);
  clearTimeout(navFallback);
  navFallback = setTimeout(() => {
    temporalSrc.value = `${origin.value}${nav.path ?? `/namespaces/default/workflows/${encodeURIComponent(nav.workflow)}`}`;
  }, 5000);
}

function onMessage(event) {
  if (!origin.value || event.origin !== origin.value) return;
  const data = event.data;
  if (data?.__course === "ready") {
    temporalReady = true;
    if (pending) navigateTemporal(pending);
  } else if (data?.__course === "navok") {
    clearTimeout(navFallback);
    pending = null;
  } else if (data?.__course === "navfail") {
    clearTimeout(navFallback);
    temporalSrc.value = `${origin.value}${data.path}`;
    pending = null;
  }
}

// openPane(): show that view, and for the Temporal UI, go to the path.
function open(pane, path) {
  store.workspaceView = pane;
  if (pane === "temporal") navigateTemporal(path);
}

// openSession(): the Agent UI's current session in the Temporal UI, on one of its tabs
// ("query", "history?category=activity"…). The Agent UI keeps the session in its address
// (?s=), and in localStorage, which this page shares.
function openSession(tab) {
  let workflow = null;
  try {
    workflow = new URLSearchParams(consoleFrame.value?.contentWindow?.location.search ?? "").get("s");
  } catch {
    /* not loaded */
  }
  try {
    workflow ||= window.localStorage.getItem("temporal-agent-ui.active-session.v1");
  } catch {
    /* storage blocked */
  }
  if (!workflow) return toast("Start a session in the Agent UI first", 3600);
  open("temporal", { workflow, tab });
}

// sendToAgent(): the Agent UI forward, and the message typed into its open session and sent.
// The console is on this origin, so the page can reach its composer (a Svelte bind:value
// input, which takes the value from an input event). No session open, or the agent still busy
// after a while (the composer is disabled then): the message is copied instead.
async function send(text) {
  open("console");
  const input = await waitFor(() => {
    const found = consoleDocument()?.querySelector("form.composer input");
    return found && !found.disabled ? found : null;
  });
  if (input) {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form.requestSubmit();
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Start or open a session in the Agent UI first: the message is copied", 4200);
  } catch {
    toast("Start or open a session in the Agent UI first", 4200);
  }
}

// startSession(): the Agent UI forward with an agent's start form open, as a person gets there
// (Session Manager, New session, the agent), and the posture chosen. Starting it is still the
// learner's click. The console lists an agent as disabled until its worker answers.
let startRequest = 0;
async function startSession(agent, posture) {
  open("console");
  const doc = await waitFor(consoleDocument);
  if (!doc) return toast("The Agent UI didn't load: reload it (↻) and try again", 4200);
  const newSession = () => [...doc.querySelectorAll("button")].find((b) => b.textContent.trim() === "New session");
  if (!newSession()) doc.querySelector("button.session-drawer-trigger")?.click();
  (await waitFor(newSession))?.click();
  const row = () => [...doc.querySelectorAll("button.agent-row")].find((b) => b.querySelector("strong")?.textContent.trim() === agent);
  if (!(await waitFor(row))) return toast(`The Agent UI doesn't list the ${agent}`, 4200);
  const ready = await waitFor(() => (row()?.getAttribute("aria-disabled") === "true" ? null : row()), 4000);
  if (!ready) return toast(`Start the worker first: the ${agent} needs it running`, 4200);
  ready.click();
  if (posture) {
    const select = await waitFor(() => doc.querySelector("dialog.start-sheet[open] select"));
    if (select && [...select.options].some((o) => o.value === posture)) {
      select.value = posture;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  // Once the learner starts the session (the form's Start session, not Cancel), the session
  // list closes and gives the conversation its room back. Only the latest New session ▸ does
  // it: two closing the list would open it again.
  const mine = ++startRequest;
  if (!(await waitFor(() => doc.querySelector("dialog.start-sheet[open]")))) return;
  let started = false;
  const onClick = (event) => {
    const button = event.target.closest?.("dialog.start-sheet button");
    if (button && /start session/i.test(button.textContent)) started = true;
  };
  doc.addEventListener("click", onClick, true);
  await waitFor(() => !doc.querySelector("dialog.start-sheet[open]"), 10 * 60_000);
  doc.removeEventListener("click", onClick, true);
  if (!started || mine !== startRequest) return;
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (doc.querySelector(".app.has-session-drawer")) doc.querySelector("button.session-drawer-trigger")?.click();
}

// The Agent UI as the course shows it: without State flow's minimap (the console has no
// setting for it). Same origin, so a stylesheet of the page's own goes in on every load.
const CONSOLE_STYLE = ".svelte-flow__minimap{display:none!important}";
function onConsoleLoad() {
  loaded.value.console = true;
  try {
    const doc = consoleFrame.value?.contentDocument;
    if (doc && !doc.getElementById("course-style")) {
      const style = Object.assign(doc.createElement("style"), { id: "course-style", textContent: CONSOLE_STYLE });
      doc.head.append(style);
    }
  } catch {
    /* not reachable: leave it as it is */
  }
}

function consoleDocument() {
  return (loaded.value.console && consoleFrame.value?.contentDocument) || null;
}

async function waitFor(find, ms = 6000) {
  for (const until = Date.now() + ms; ; ) {
    const found = find();
    if (found || Date.now() > until) return found || null;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function reload() {
  if (active.value === "console") {
    loaded.value.console = false;
    consoleFrame.value?.contentWindow?.location.reload();
  } else if (active.value === "temporal") {
    loaded.value.temporal = false;
    temporalReady = false;
    temporalFrame.value?.contentWindow?.location.reload();
  }
}

const newTabHref = computed(() => (active.value === "console" ? "/sbx/console/" : active.value === "temporal" && origin.value ? `${origin.value}/` : ""));
defineExpose({ reload, newTabHref });

watch(() => [props.live, origin.value], mountFrames, { immediate: true });
watch(consoleSrc, () => (loaded.value.console = false));
watch(temporalSrc, () => {
  loaded.value.temporal = false;
  temporalReady = false;
});

let unregister = null;
let unregisterSend = null;
let unregisterSession = null;
let unregisterSessionTab = null;
onMounted(() => {
  window.addEventListener("message", onMessage);
  unregister = registerHook("pane", open);
  unregisterSend = registerHook("send", send);
  unregisterSession = registerHook("session", startSession);
  unregisterSessionTab = registerHook("sessionTab", openSession);
});
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  clearTimeout(navFallback);
  unregister?.();
  unregisterSend?.();
  unregisterSession?.();
  unregisterSessionTab?.();
});
</script>

<template>
  <section v-show="active !== 'code'" class="panes-view" :aria-label="active === 'console' ? 'The Agent UI' : 'The Temporal UI'" data-tour="panes">
    <div class="pane-body">
      <template v-if="live">
        <iframe
          v-show="active === 'console'"
          ref="consoleFrame"
          class="pane-frame"
          :src="consoleSrc"
          title="The Agent UI"
          @load="onConsoleLoad"
        />
        <iframe
          v-if="temporalSrc"
          v-show="active === 'temporal'"
          ref="temporalFrame"
          class="pane-frame"
          :src="temporalSrc"
          title="The Temporal UI"
          @load="loaded.temporal = true"
        />
        <div v-if="active !== 'code' && !loaded[active]" class="pane-loading" role="status">
          <span class="pane-spinner" aria-hidden="true" />
          <span>Loading the {{ active === "console" ? "Agent UI" : "Temporal UI" }}…</span>
        </div>
      </template>
      <div v-else class="pane-empty">
        <p><strong>Your sandbox's Agent UI and Temporal UI</strong> appear here once it's running.</p>
      </div>
    </div>
  </section>
</template>
