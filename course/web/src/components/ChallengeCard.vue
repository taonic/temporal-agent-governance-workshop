<script setup>
// A challenge in the guide: pick one of its choices (a version of the code you just wrote), and
// it goes into your file, the way a snippet does. Lock it in, and it runs in the commands
// terminal, while the Temporal UI shows its workflow's Event History as it's written, and its
// timeline shows here. Without a sandbox, its code shows here and its recorded run plays.
// A wrong pick is struck out with what happened and why, and you pick again; two misses bring a
// hint. The right one earns its XP (20, 10, then 2) and puts every choice side by side.
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";

import { misses, pickCounts, showsHint, solvedAt } from "../challenge.js";
import { ask } from "../helper.js";
import { isDone, pick, progress, xpOf } from "../progress.js";
import { api, openPane, runInTerminal, swapInEditor, toast } from "../store.js";

const props = defineProps({
  challenge: { type: Object, required: true },
  // Live: a sandbox to run it in. Otherwise every run is its recording.
  live: { type: Boolean, default: false },
  exercise: { type: String, required: true },
  beat: { type: String, required: true },
});

const right = computed(() => props.challenge.choices.find((c) => c.right));
const attempts = computed(() => progress.attempts[props.challenge.id] ?? []);
const solved = computed(() => solvedAt(attempts.value, right.value.id) !== null || isDone(props.challenge.id));
// A wrong pick is struck out once its run has shown why (one from an earlier visit, at once).
const struck = computed(() => new Set(misses(attempts.value, right.value.id).filter((id) => !runs[id]?.running)));
const hint = computed(() => showsHint(attempts.value, right.value.id));
const maxXp = computed(() => props.challenge.xp[0]);

const selected = ref(null);
const choiceOf = (id) => props.challenge.choices.find((c) => c.id === id);
const code = computed(() => (selected.value ? choiceOf(selected.value).code.replace(/\n$/, "") : ""));

// Each choice's run: { source: "live" | "recording", lines, done, error, running }.
const runs = reactive({});
const running = computed(() => Object.values(runs).some((r) => r.running));
// The run on show under the choices: the last one started.
const shown = ref(null);
let timers = [];
let stopped = false;
onBeforeUnmount(() => {
  stopped = true;
  timers.forEach(clearTimeout);
});

// Live, a pick goes into the file (in place of the block, or of the choice picked before it):
// the block as the learner has it, and every choice's version of it, are what it looks for.
const blocks = computed(() => [props.challenge.replace, ...props.challenge.choices.map((c) => c.code)]);
const swapping = ref(false);
const busy = computed(() => running.value || swapping.value);
// Whether the selected choice is in the file now, and what the file had there before any
// choice went in: what a wrong pick gives way to again.
const inFile = ref(false);
let original = null;

async function swap(code, { quiet = false } = {}) {
  swapping.value = true;
  try {
    const { ok, message, replaced } = await swapInEditor(props.challenge.file, code, [...(original ? [original] : []), ...blocks.value], { quiet });
    if (!ok) toast(message, 4200);
    if (ok && original === null && !props.challenge.choices.some((c) => c.code.trim() === replaced?.trim())) original = replaced;
    return ok;
  } finally {
    swapping.value = false;
  }
}

async function select(id) {
  if (busy.value || selected.value === id) return;
  selected.value = id;
  inFile.value = false;
  if (props.live && !solved.value) inFile.value = await swap(choiceOf(id).code);
}

// Predict, then run: a recording's pick is recorded as it starts, whatever it shows; a live
// one's once the run shows something (pickCounts), so a run that breaks first costs nothing.
async function runChoice(id, { compare = false } = {}) {
  const choice = choiceOf(id);
  shown.value = compare ? shown.value : id;
  if (props.live) await runLive(choice, { compare });
  else {
    if (!compare) pick(props.challenge.id, id);
    playRecording(choice);
  }
}

function playRecording(choice, { instant = false } = {}) {
  const { lines, done } = choice.recording;
  const total = lines.at(-1)?.t ?? 0;
  // A long run plays faster: a recording takes at most about 5 seconds to watch.
  const scale = instant || !total ? 0 : Math.min(1, 5 / total);
  runs[choice.id] = { source: "recording", lines: [], done: null, error: null, running: !instant };
  if (instant) {
    runs[choice.id] = { source: "recording", lines, done, error: null, running: false };
    return;
  }
  lines.forEach((line) => timers.push(setTimeout(() => runs[choice.id]?.lines.push(line), line.t * scale * 1000)));
  timers.push(setTimeout(() => Object.assign(runs[choice.id], { done, running: false }), total * scale * 1000 + 300));
}

// Live: typed into the commands terminal; the card follows the same run's JSON lines (tagged with
// this run's id, so an earlier run's don't count). As soon as its workflow starts, the Temporal UI
// shows that workflow's Event History, filling in as it runs; at the end, the workflow the run
// says to look at (FC3's stuck one, say), if that's another.
async function runLive(choice, { compare = false } = {}) {
  const run = Math.random().toString(36).slice(2, 8);
  let opened = null;
  const show = (id) => {
    if (!id || id === opened || stopped) return;
    opened = id;
    openPane("temporal", { workflow: id, tab: "history" });
  };
  runs[choice.id] = { source: "live", lines: [], done: null, error: null, running: true };
  runInTerminal("commands", [`./quest challenge ${props.challenge.id} ${choice.id} --run ${run}`], { interrupt: true });
  const started = Date.now();
  while (!stopped && Date.now() - started < 60_000) {
    await new Promise((resolve) => timers.push(setTimeout(resolve, 900)));
    try {
      const state = await api(`/api/sandbox/challenge?id=${props.challenge.id}&choice=${choice.id}`);
      if (state.run !== run) continue; // not started yet: the file is an earlier run's
      Object.assign(runs[choice.id], { lines: state.lines, done: state.done, error: state.error });
      // Its id comes just before it starts: once a line follows it, Temporal has it.
      const first = state.lines.findIndex((l) => l.type === "workflow");
      if (!opened && first >= 0 && (first < state.lines.length - 1 || state.done)) show(state.lines[first].id);
      if (state.done) show(state.done.focus);
      if (state.done || state.error) break;
    } catch {
      /* a missed poll: try again */
    }
  }
  runs[choice.id].running = false;
  if (!runs[choice.id].done && !runs[choice.id].error) runs[choice.id].error = "No answer from your sandbox: see the commands terminal.";
  const ran = runs[choice.id].lines.some((l) => l.type === "workflow");
  if (!compare && pickCounts({ done: runs[choice.id].done, left: stopped, started: ran })) pick(props.challenge.id, choice.id);
  // A wrong pick comes back out of the file, the block as the learner had it again: quietly, so
  // the Temporal UI keeps showing what it did.
  if (!compare && runs[choice.id].done && !choice.right && inFile.value) {
    if (await swap(original ?? props.challenge.replace, { quiet: true })) toast(`Took choice ${choice.id} back out of ${props.challenge.file.split("/").pop()}.`, 3200);
    inFile.value = false;
    selected.value = null;
  }
}

// Solved: every choice side by side, those not run yet from their recordings.
watch(
  solved,
  (now) => {
    if (!now) return;
    for (const choice of props.challenge.choices) if (!runs[choice.id]) playRecording(choice, { instant: true });
  },
  { immediate: true },
);

const verdict = (run) => (run?.done ? (run.done.right ? "right" : "wrong") : null);

function openWorkflow(run) {
  const id = run.done?.focus ?? run.done?.workflows?.[0] ?? run.lines.find((l) => l.type === "workflow")?.id;
  if (id) openPane("temporal", { workflow: id, tab: "history" });
}

function askAbout(choice) {
  const run = runs[choice.id];
  ask(
    `In the challenge "${props.challenge.title}", I picked "${choice.label}". ${run?.done?.summary ?? ""} Why does this code do that, and what should it do instead?`,
    { step: { exercise: props.exercise, beat: props.beat, title: `Challenge: ${props.challenge.title}` } },
  );
}

const lineKind = (line) => `is-${line.kind ?? "info"}`;
</script>

<template>
  <section class="challenge" :aria-label="`Challenge: ${challenge.title}`">
    <p class="challenge-meta">
      <span class="challenge-bolt" aria-hidden="true">⚡</span>
      Challenge · {{ challenge.choices.length }} choices ·
      <template v-if="solved">solved, +{{ xpOf(challenge.id) }} XP</template>
      <template v-else>up to {{ maxXp }} XP</template>
      <span class="challenge-where">{{ live ? "Runs live in your sandbox" : "Shows each choice's recorded run" }}</span>
    </p>

    <ol class="challenge-choices">
      <li v-for="c in challenge.choices" :key="c.id">
        <button
          type="button"
          class="challenge-choice"
          :class="{ 'is-selected': selected === c.id, 'is-struck': struck.has(c.id), 'is-right': solved && c.right }"
          :disabled="(struck.has(c.id) && !solved) || busy"
          :aria-pressed="selected === c.id"
          @click="select(c.id)"
        >
          <span class="challenge-letter">{{ c.id }}</span>
          <span class="challenge-label">{{ c.label }}</span>
          <span v-if="struck.has(c.id)" class="challenge-mark" aria-label="wrong">✗</span>
          <span v-else-if="solved && c.right" class="challenge-mark" aria-label="right">✓</span>
        </button>
      </li>
    </ol>

    <div v-if="selected" class="challenge-diff" :aria-label="`Choice ${selected}, in ${challenge.file}`">
      <!-- Live, the choice is in the editor, in its file; otherwise it shows here. -->
      <p class="challenge-diff-file">
        {{
          swapping
            ? `Putting choice ${selected} into ${challenge.file}…`
            : inFile
              ? `Choice ${selected} is in ${challenge.file}, in the editor`
              : `${challenge.file} · choice ${selected}`
        }}
      </p>
      <pre v-if="!inFile && !swapping"><code>{{ code }}</code></pre>
      <button
        v-if="!solved && !struck.has(selected)"
        class="button button-primary challenge-run"
        type="button"
        :disabled="busy"
        @click="runChoice(selected)"
      >
        ▶ Lock in {{ selected }} and run it
      </button>
      <button
        v-else-if="solved && live && runs[selected]?.source !== 'live'"
        class="button challenge-run"
        type="button"
        :disabled="busy"
        @click="runChoice(selected, { compare: true })"
      >
        ▶ Run {{ selected }} live
      </button>
    </div>
    <p v-else-if="!solved" class="challenge-prompt">Pick the one you think is right, then run it.</p>

    <p v-if="hint" class="challenge-hint"><strong>Hint:</strong> <span v-html="challenge.hint" /></p>

    <!-- The run of the last pick, as it happens. Once solved, every choice's. -->
    <div class="challenge-outcomes" :class="{ 'is-compare': solved }">
      <template v-for="c in challenge.choices" :key="c.id">
        <article
          v-if="runs[c.id] && (solved || shown === c.id)"
          class="challenge-outcome"
          :class="[`is-${verdict(runs[c.id]) ?? 'running'}`]"
          :aria-label="`Choice ${c.id}: ${c.label}`"
        >
          <header class="outcome-head">
            <span class="challenge-letter">{{ c.id }}</span>
            <span class="outcome-label">{{ c.label }}</span>
            <span class="outcome-source">{{ runs[c.id].source === "live" ? "Live" : "Recorded" }}</span>
          </header>
          <ol class="outcome-timeline">
            <li v-for="(line, i) in runs[c.id].lines.filter((l) => l.type !== 'workflow')" :key="i" :class="lineKind(line)">
              <span class="outcome-t">{{ line.t.toFixed(1) }}s</span>{{ line.text }}
            </li>
            <li v-if="runs[c.id].running" class="is-waiting"><span class="outcome-t">…</span>running</li>
          </ol>
          <template v-if="runs[c.id].done">
            <p class="outcome-summary">
              <span aria-hidden="true">{{ runs[c.id].done.right ? "✓" : "✗" }}</span> {{ runs[c.id].done.summary }}
            </p>
            <ul v-if="runs[c.id].done.events?.length" class="outcome-events">
              <li v-for="e in runs[c.id].done.events" :key="e"><code>{{ e }}</code></li>
            </ul>
            <p class="outcome-why" v-html="c.explanation" />
            <div class="outcome-actions">
              <button v-if="runs[c.id].source === 'live'" class="button" type="button" @click="openWorkflow(runs[c.id])">Open its Event History</button>
              <button v-if="!c.right" class="button" type="button" @click="askAbout(c)">✦ Ask Temporal about this</button>
            </div>
          </template>
          <p v-else-if="runs[c.id].error" class="outcome-summary">✗ {{ runs[c.id].error }}</p>
        </article>
      </template>
    </div>
    <p v-if="shown && verdict(runs[shown]) === 'wrong' && !solved" class="challenge-again">
      Not that one{{ live ? ": it's back out of your file" : "" }}. Pick another.
    </p>
  </section>
</template>
