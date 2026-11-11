<script setup>
// A question with plain answers: an Essentials question challenge (EC1…), or a module's quiz.
// Nothing runs. Pick one: a wrong pick is struck out, with why, and you pick again; two misses
// bring the hint (when there is one); the right pick shows every answer with its explanation.
// The parent keeps the picks (`attempts`) and records a new one (`pick`).
import { computed } from "vue";

import { misses, showsHint, solvedAt } from "../challenge.js";

const props = defineProps({
  // The question's text (HTML), when the beat doesn't already say it.
  question: { type: String, default: "" },
  choices: { type: Array, required: true }, // [{ id, label, explanation, right }], label and explanation as HTML
  hint: { type: String, default: "" },
  attempts: { type: Array, default: () => [] },
  // Solved some other way (the module or the challenge already done, on another device, say).
  done: { type: Boolean, default: false },
  // What the heading says: "Challenge · 3 answers · up to 20 XP", say.
  meta: { type: String, default: "" },
  label: { type: String, default: "Question" },
});
const emit = defineEmits(["pick"]);

const right = computed(() => props.choices.find((c) => c.right));
const solved = computed(() => props.done || solvedAt(props.attempts, right.value.id) !== null);
const struck = computed(() => new Set(misses(props.attempts, right.value.id)));
const hint = computed(() => props.hint && showsHint(props.attempts, right.value.id));
// The explanation shown under a choice: every one, once solved; until then, the wrong picks'.
const explained = (c) => solved.value || struck.value.has(c.id);
const last = computed(() => props.attempts.at(-1) ?? null);

function choose(c) {
  if (solved.value || struck.value.has(c.id)) return;
  emit("pick", c.id);
}
</script>

<template>
  <section class="question-card" :class="{ 'is-solved': solved }" :aria-label="label">
    <p v-if="meta" class="challenge-meta"><span class="challenge-bolt" aria-hidden="true">⚡</span>{{ meta }}</p>
    <p v-if="question" class="qc-question" v-html="question" />
    <ol class="challenge-choices">
      <li v-for="c in choices" :key="c.id">
        <button
          type="button"
          class="challenge-choice"
          :class="{ 'is-struck': struck.has(c.id) && !(solved && c.right), 'is-right': solved && c.right }"
          :disabled="solved || struck.has(c.id)"
          :aria-describedby="explained(c) ? `qc-why-${label}-${c.id}` : undefined"
          @click="choose(c)"
        >
          <span class="challenge-letter">{{ c.id }}</span>
          <span class="challenge-label" v-html="c.label" />
          <span v-if="solved && c.right" class="challenge-mark" aria-label="right">✓</span>
          <span v-else-if="struck.has(c.id)" class="challenge-mark" aria-label="wrong">✗</span>
        </button>
        <p v-if="explained(c)" :id="`qc-why-${label}-${c.id}`" class="qc-why" :class="c.right ? 'is-right' : 'is-wrong'" v-html="c.explanation" />
      </li>
    </ol>
    <p v-if="!solved && last && struck.has(last)" class="challenge-again" role="status">Not that one. Pick another.</p>
    <p v-else-if="!solved && !attempts.length" class="challenge-prompt">Pick the answer you think is right.</p>
    <p v-if="hint" class="challenge-hint"><strong>Hint:</strong> <span v-html="props.hint" /></p>
  </section>
</template>
