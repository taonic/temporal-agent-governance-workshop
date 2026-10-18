<script setup>
// The code tour's card, over the bottom of the editor: where the chunk is, what it does, and
// Back / Next / Skip. The editor spotlights the chunk (CodeEditor.vue). Keys: → and ← step
// (unless you're typing), Esc skips.
import { computed, onBeforeUnmount, onMounted } from "vue";

import { codeTour, currentStop, endCodeTour, stepCodeTour } from "../codeTour.js";
import { openHelper } from "../helper.js";
import { editorContext } from "../store.js";

const props = defineProps({ exerciseId: { type: String, required: true } });

const stop = computed(() => currentStop(props.exerciseId));
const total = computed(() => codeTour.stops.length);
const last = computed(() => codeTour.index === total.value - 1);
const where = computed(() => {
  const name = stop.value?.file.split("/").pop();
  const lines = codeTour.lines;
  if (!lines) return name;
  return lines.start === lines.end ? `${name} · line ${lines.start}` : `${name} · lines ${lines.start}–${lines.end}`;
});

// The chunk, for Ask Temporal: it opens with the lines attached and asks about them.
function ask() {
  const lines = codeTour.lines;
  const text = editorContext()?.text ?? "";
  if (!lines || !text) return;
  const chunk = text.split("\n").slice(lines.start - 1, lines.end).join("\n");
  openHelper({ selection: { text: chunk, source: "editor", path: stop.value.file }, question: `Explain this code (${stop.value.title})` });
}

function onKey(event) {
  if (!stop.value) return;
  if (event.key === "Escape") return endCodeTour();
  const typing = event.target instanceof Element && event.target.closest("input, textarea, select, .cm-editor, .xterm, [contenteditable]");
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    stepCodeTour(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepCodeTour(-1);
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Transition name="code-tour">
    <aside v-if="stop" class="code-tour" role="dialog" aria-label="Code tour" aria-live="polite">
      <header class="ct-head">
        <span class="ct-kicker"><span class="ct-mark" aria-hidden="true">✦</span> Code tour · {{ codeTour.index + 1 }} of {{ total }}</span>
        <button class="ct-skip" type="button" title="Skip the tour (Esc)" @click="endCodeTour">Skip tour</button>
      </header>
      <Transition name="ct-step" mode="out-in">
        <div :key="codeTour.index" class="ct-body">
          <p class="ct-where">{{ where }}</p>
          <h3 class="ct-title">{{ stop.title }}</h3>
          <p class="ct-text" v-html="stop.html" />
        </div>
      </Transition>
      <footer class="ct-foot">
        <span class="ct-dots" aria-hidden="true">
          <i v-for="(_, i) in codeTour.stops" :key="i" :class="{ on: i === codeTour.index, past: i < codeTour.index }" />
        </span>
        <button v-if="codeTour.lines" class="ct-ask" type="button" title="Ask Temporal about these lines" @click="ask">✦ Ask</button>
        <button class="button ct-back" type="button" :disabled="codeTour.index === 0" title="Back (←)" @click="stepCodeTour(-1)">Back</button>
        <button class="button button-primary ct-next" type="button" :title="last ? 'Finish the tour' : 'Next (→)'" @click="stepCodeTour(1)">{{ last ? "Done" : "Next →" }}</button>
      </footer>
    </aside>
  </Transition>
</template>
