<script setup>
// Stands in for the sandbox's panes until it's ready: what's happening, and what you can do.
// A step that takes much longer than it should offers to check again or start over.
import { computed, onBeforeUnmount, ref, watch } from "vue";

import AccessForm from "./AccessForm.vue";
import { resetSandbox, resumeSandbox, startSandbox, store } from "../store.js";

const busy = computed(() => ["finding", "creating", "waking", "bootstrapping", "stopped", "starting", "stopping"].includes(store.sandbox.state));
const waiting = computed(() => store.runtime.enabled && store.authenticated && (busy.value || store.sandbox.state === "unknown"));

// Finding a sandbox takes a second or two; creating, waking or starting the services, up to a
// minute. Each step gets its own clock, so a start that's moving along never looks stuck.
const STALL_SECONDS = { finding: 20, unknown: 20 };
const since = ref(Date.now());
const now = ref(Date.now());
// A string, not an array: the sandbox poll replaces the state every 1.5s with an equal one.
watch(() => `${store.sandbox.state}\n${store.sandbox.message}`, () => (since.value = Date.now()));
const stalled = computed(() => waiting.value && now.value - since.value > (STALL_SECONDS[store.sandbox.state] ?? 90) * 1000);

let clock = 0;
watch(
  waiting,
  (on) => {
    clearInterval(clock);
    if (on) clock = setInterval(() => (now.value = Date.now()), 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(clock));

function checkAgain() {
  since.value = Date.now();
  if (store.sandbox.state === "unknown") resumeSandbox();
  else startSandbox();
}

function startOver() {
  if (window.confirm("Start over with a new sandbox? The current one is deleted, with your edits, sessions and bookings in it.")) {
    resetSandbox({ restart: true });
  }
}
</script>

<template>
  <section class="sandbox-status" aria-live="polite" data-tour="panes">
    <div class="sandbox-status-card">
      <p class="panel-kicker">Your sandbox</p>
      <template v-if="!store.runtime.checked">
        <p>Checking whether the browser sandbox is available…</p>
      </template>
      <template v-else-if="!store.runtime.enabled">
        <h3>The browser sandbox isn't available</h3>
        <p>{{ store.runtime.reason }}</p>
        <p>You can still do the whole workshop on your own machine: switch the instructions to <strong>Local</strong>, and see <a href="#/setup">Setup</a>.</p>
      </template>
      <template v-else-if="!store.authenticated">
        <h3>Run the workshop in your browser</h3>
        <p>You get your own cloud sandbox with everything installed: Temporal, the agent, the Dogwood verifier, two terminals, an editor and the Agent UI. It stops when you're idle and keeps your work for a day.</p>
        <AccessForm />
      </template>
      <template v-else-if="waiting">
        <div class="status-line"><span class="pane-spinner" aria-hidden="true" /> {{ store.sandbox.message || "Looking for your sandbox…" }}</div>
        <template v-if="stalled">
          <p class="status-stalled">This is taking longer than it should. Check again, or start over with a new sandbox (about a minute).</p>
          <div class="status-actions">
            <button class="button" type="button" @click="checkAgain">Check again</button>
            <button class="button button-primary" type="button" @click="startOver">Start over with a new sandbox</button>
          </div>
        </template>
      </template>
      <template v-else-if="store.sandbox.state === 'error'">
        <h3>Something went wrong</h3>
        <pre class="status-error">{{ store.sandbox.message }}</pre>
        <div class="status-actions">
          <button class="button button-primary" type="button" @click="startSandbox">Try again</button>
          <button class="button" type="button" @click="startOver">Start over with a new sandbox</button>
        </div>
      </template>
      <template v-else-if="store.sandbox.state === 'full'">
        <h3>The sandboxes are all in use</h3>
        <p>{{ store.sandbox.message }}</p>
        <button class="button button-primary" type="button" @click="startSandbox">Try again</button>
      </template>
      <template v-else>
        <h3>Start your sandbox</h3>
        <p>It takes about a minute the first time. Everything in it is yours: edit, break things, restart things.</p>
        <button class="button button-primary" type="button" @click="startSandbox">Start my sandbox</button>
      </template>
    </div>
  </section>
</template>
