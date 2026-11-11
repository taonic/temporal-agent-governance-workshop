<script setup>
// The Trip board: what an Essentials module shows in place of the editor and terminals. The
// booking trip's logbook as steps that tick off, the coordinator on or off shift, the plain twin's
// trip beside it in the modules that have one, and the outside world, where every booking lands.
// What to do to the trip is in the guide's text, as buttons (store.js boardAction), one place for
// each: the board only offers Start over.
//
// It reads the state essentials/board.py reports, through the sandbox poll (ExercisePage), and
// sets the module's board up on arrival (anew for another module; as it is for the same one).
//
// Without a sandbox (not started, or not ready yet), it plays the module's recorded walkthrough instead (scripts/
// record_walkthroughs.py): the board's states as the guide's steps left them, second by second,
// with a note at each action. A recording is only watched: it never passes a module's check.
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { boardView } from "../board.js";
import { boardAction, openPane, sandboxStartView, startSandbox, store } from "../store.js";

const props = defineProps({
  exercise: { type: Object, required: true },
  // The module on show: its board (twin, mistake) and the actions its text uses.
  module: { type: String, default: null },
  live: { type: Boolean, default: false },
});

// The board's clock, ticking between polls, so the hold's countdown counts down smoothly.
const tick = ref(Date.now());
const ticker = setInterval(() => (tick.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(ticker));

// --- The recorded walkthrough (no sandbox) ---------------------------------------------------
const recording = ref(null); // { module, frames: [{ t, note?, state }] }
const at = ref(0); // the frame on show
const playing = ref(false);
const speed = ref(1);
let timer = 0;
const watching = computed(() => !props.live && recording.value?.module === props.module);
const frame = computed(() => (watching.value ? recording.value.frames[at.value] : null));
// What happened last, up to the frame on show: the caption.
const caption = computed(() => (watching.value ? recording.value.frames.slice(0, at.value + 1).findLast((f) => f.note)?.note ?? "" : ""));
const duration = computed(() => recording.value?.frames.at(-1)?.t ?? 0);

watch(
  () => [props.live, props.module],
  async ([live, module]) => {
    pause();
    if (live || !module || recording.value?.module === module) return;
    const url = props.exercise.walkthroughs?.[module];
    if (!url) return (recording.value = null);
    try {
      const data = await (await fetch(url)).json();
      if (module === props.module) {
        recording.value = { module, frames: data.frames ?? [] };
        at.value = 0;
      }
    } catch {
      recording.value = null;
    }
  },
  { immediate: true },
);
function play() {
  if (!watching.value) return;
  if (at.value >= recording.value.frames.length - 1) at.value = 0;
  playing.value = true;
  step();
}
function step() {
  clearTimeout(timer);
  const frames = recording.value?.frames ?? [];
  if (!playing.value || at.value >= frames.length - 1) return (playing.value = false);
  const wait = Math.max(0.15, frames[at.value + 1].t - frames[at.value].t) / speed.value;
  timer = setTimeout(() => {
    at.value++;
    step();
  }, wait * 1000);
}
function pause() {
  playing.value = false;
  clearTimeout(timer);
}
function seek(event) {
  at.value = Number(event.target.value);
  if (playing.value) step();
}
function faster() {
  speed.value = speed.value === 1 ? 2 : 1;
  if (playing.value) step();
}
onBeforeUnmount(pause);

// Live: the sandbox's board, its countdown ticking between polls. Watching: the recording's.
const shown = computed(() => (watching.value ? frame.value?.state ?? null : props.live ? store.board.state : null));
const now = computed(() =>
  watching.value ? (frame.value?.state.at ?? 0) : (store.board.state?.at ?? tick.value / 1000) + Math.max(0, tick.value - (store.board.at ?? tick.value)) / 1000,
);
const view = computed(() => boardView(shown.value, now.value));
// The state is this module's: one left from another module isn't shown while setup runs.
const ready = computed(() => view.value && view.value.module === props.module);
const pending = computed(() => (watching.value ? "recording" : store.board.pending));
const latest = computed(() => view.value?.trips[0] ?? null);
const older = computed(() => view.value?.trips.slice(1) ?? []);

watch(
  () => [props.live, props.module],
  ([live, module]) => {
    if (live && module) boardAction("setup", module, { quiet: true });
  },
  { immediate: true },
);

function act(action) {
  boardAction(action, props.module);
}
function startOver() {
  if (window.confirm("Start this board over? Its trips are stopped and the outside world is cleared, as the module starts.")) act("reset");
}
function openTrip(trip) {
  openPane("temporal", `/namespaces/default/workflows/${encodeURIComponent(trip.workflowId)}`);
}
const WHO = { temporal: "Temporal", plain: "Plain" };
const MARK = { done: "✓", active: "", retrying: "↻", todo: "", lost: "✕", failed: "✕", rejected: "✕", asking: "?" };
</script>

<template>
  <section class="trip-board" :class="{ 'is-recording': watching }" aria-label="Trip board">
    <div v-if="!live && !watching" class="tb-offline">
      <p class="tb-offline-title">The Trip board runs in your sandbox</p>
      <p>Your own small cloud machine, with Temporal on it. It takes a minute or two the first time.</p>
      <button class="button button-primary" type="button" :disabled="sandboxStartView().disabled" @click="startSandbox()">{{ sandboxStartView().label }}</button>
    </div>

    <template v-else>
      <div v-if="watching" class="tb-recording" role="group" aria-label="A recording of this module">
        <div class="tb-recording-top">
          <p class="tb-recording-title"><span class="tb-rec-dot" aria-hidden="true" /> A recording of this step, as it goes</p>
          <button class="button button-primary tb-recording-start" type="button" :disabled="sandboxStartView().disabled" @click="startSandbox()">
            {{ sandboxStartView().label }} to run it yourself
          </button>
        </div>
        <div class="tb-player">
          <button class="tb-act" type="button" :aria-label="playing ? 'Pause' : 'Play'" @click="playing ? pause() : play()">{{ playing ? "❚❚ Pause" : at > 0 && at >= recording.frames.length - 1 ? "↺ Again" : "▶ Watch it" }}</button>
          <input class="tb-scrub" type="range" min="0" :max="recording.frames.length - 1" :value="at" aria-label="Where in the recording" @input="seek" />
          <span class="tb-time">{{ Math.round(frame?.t ?? 0) }}s / {{ Math.round(duration) }}s</span>
          <button class="tb-act is-quiet tb-speed" type="button" :aria-pressed="speed === 2" title="Play it twice as fast" @click="faster">{{ speed }}×</button>
        </div>
        <p class="tb-caption" aria-live="polite">{{ caption || "Press Watch it, and follow the guide's steps as they happen." }}</p>
      </div>
      <header class="tb-head">
        <div class="tb-heading">
          <h2>Trip board</h2>
          <p>One trip, step by step, and everything it books.</p>
        </div>
        <div class="tb-flags">
          <span :class="['tb-flag', ready && view.coordinator ? 'is-on' : 'is-off']" role="status">
            <span class="tb-dot" aria-hidden="true" />{{ !ready ? "Getting the board ready…" : view.coordinator ? "Coordinator on shift" : "No coordinator on shift" }}
          </span>
          <span v-if="ready && view.flaky" class="tb-flag is-warn" role="status">✈️ The airline isn't answering · {{ view.flakyFor }}s</span>
          <span v-if="ready && view.mistake" class="tb-flag is-warn" role="status">🐞 A mistake in the hotel step</span>
          <span v-if="ready && view.declined" class="tb-flag is-warn" role="status">💳 This traveler's card will be declined</span>
        </div>
      </header>

      <div v-if="!watching" class="tb-actions" role="group" aria-label="The board">
        <button class="tb-act is-quiet" type="button" :disabled="!ready || !!pending" title="Stop its trips and clear the outside world, as the module starts" @click="startOver">↺ Start over</button>
      </div>

      <p v-if="ready && !latest" class="tb-empty">{{ watching ? "No trip yet." : "No trip yet. Start one, and watch it go." }}</p>

      <article v-if="ready && latest" class="tb-trip">
        <header class="tb-trip-head">
          <h3>{{ latest.title }} <span class="tb-route">{{ latest.route }}</span></h3>
          <button v-if="!watching" class="link-button" type="button" @click="openTrip(latest)">Its logbook in the Temporal UI ↗</button>
        </header>
        <div :class="['tb-runs', { 'has-twin': latest.plain }]">
          <section class="tb-run is-temporal" aria-label="The trip on Temporal">
            <h4>On Temporal <small>the coordinator and the logbook</small></h4>
            <ol class="tb-steps">
              <li v-for="step in latest.temporal.steps" :key="step.id" :class="['tb-step', `is-${step.state}`]">
                <span class="tb-mark" aria-hidden="true">{{ MARK[step.state] }}</span>
                <span class="tb-step-text">{{ step.text }}<small v-if="step.detail">{{ step.detail }}</small></span>
              </li>
            </ol>
            <template v-if="latest.temporal.undo.length">
              <p class="tb-undo-title">Undoing, newest first</p>
              <ol class="tb-steps is-undo">
                <li v-for="step in latest.temporal.undo" :key="step.id" :class="['tb-step', `is-${step.state}`]">
                  <span class="tb-mark" aria-hidden="true">{{ MARK[step.state] }}</span>
                  <span class="tb-step-text">{{ step.text }}<small v-if="step.detail">{{ step.detail }}</small></span>
                </li>
              </ol>
            </template>
            <p :class="['tb-status', `is-${latest.temporal.status.tone}`]">{{ latest.temporal.status.text }}</p>
          </section>
          <section v-if="latest.plain" class="tb-run is-plain" aria-label="The trip as a plain program">
            <h4>Plain program <small>the same steps, no Temporal</small></h4>
            <ol class="tb-steps">
              <li v-for="step in latest.plain.steps" :key="step.id" :class="['tb-step', `is-${step.state}`]">
                <span class="tb-mark" aria-hidden="true">{{ MARK[step.state] }}</span>
                <span class="tb-step-text">{{ step.text }}</span>
              </li>
            </ol>
            <p :class="['tb-status', `is-${latest.plain.status.tone}`]">{{ latest.plain.status.text }}</p>
          </section>
        </div>
      </article>

      <details v-if="ready && older.length" class="tb-older">
        <summary>Earlier trips ({{ older.length }})</summary>
        <ul>
          <li v-for="trip in older" :key="trip.id">
            <strong>{{ trip.title }}</strong> {{ trip.route }} · On Temporal: {{ trip.temporal.status.text }}
            <template v-if="trip.plain"> · Plain: {{ trip.plain.status.text }}</template>
          </li>
        </ul>
      </details>

      <section v-if="ready" class="tb-world" aria-label="The outside world">
        <h3>The outside world <small>every booking, as the airline, the hotel, the card network and the email service see it</small></h3>
        <p v-for="d in view.world.doubles" :key="d.text" class="tb-double" role="status">⚠️ {{ d.text }}, by the plain program.</p>
        <div class="tb-systems">
          <div v-for="system in view.world.systems" :key="system.id" class="tb-system">
            <p class="tb-system-name"><span aria-hidden="true">{{ system.icon }}</span> {{ system.name }}</p>
            <ul>
              <li v-for="e in system.entries" :key="e.key" :class="['tb-booking', `is-${e.who}`, { 'is-repeat': e.repeat, 'is-cancel': e.cancel, 'is-cancelled': e.cancelled }]">
                <span :class="['tb-who', `is-${e.who}`]">{{ WHO[e.who] }}</span>
                <span class="tb-what">{{ e.traveler }}: {{ e.what }}</span>
                <strong v-if="e.repeat" class="tb-again">again</strong>
                <span v-if="e.cancelled" class="tb-cancelled">cancelled</span>
              </li>
              <li v-if="!system.entries.length" class="tb-none">Nothing yet</li>
            </ul>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>
