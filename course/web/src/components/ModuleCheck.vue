<script setup>
// A Trip board module's check, on its last beat: what the board is waiting to see (or has seen),
// and one question. Both done, the module passes (progress.js passIfChecked), with its XP.
import { computed } from "vue";

import { isDone, moduleName, modulesById, quizAnswered, quizPick, quizPicks, worldSeen, xpOf } from "../progress.js";
import QuestionCard from "./QuestionCard.vue";

const props = defineProps({
  module: { type: String, required: true },
  check: { type: Object, required: true }, // the exercise's checks[module]: { waiting, seen, quiz }
  live: { type: Boolean, default: false },
});

const seen = computed(() => worldSeen(props.module));
const answered = computed(() => quizAnswered(props.module));
const done = computed(() => isDone(props.module));
const title = computed(() => modulesById.get(props.module)?.title ?? props.module);
// "M3 · Title", or the title alone where ids aren't shown (Essentials).
const name = computed(() => (modulesById.has(props.module) ? moduleName(modulesById.get(props.module)) : props.module));
</script>

<template>
  <section class="module-check" :class="{ 'is-done': done }" :aria-label="`${name}: its check`">
    <header class="mc-head">
      <p class="mc-kicker">Check · {{ name }}</p>
      <p v-if="done" class="mc-done" role="status">✓ {{ title }}: done, +{{ xpOf(module) }} XP</p>
      <p v-else class="mc-todo">Two things pass this module: something to see happen on the board, and one question.</p>
    </header>
    <ol class="mc-parts">
      <li :class="['mc-part', seen ? 'is-done' : 'is-waiting']">
        <span class="mc-mark" aria-hidden="true">{{ seen ? "✓" : "1" }}</span>
        <div>
          <p class="mc-part-title">{{ seen ? "Seen on the board" : "On the board" }}</p>
          <p class="mc-part-text">{{ seen ? check.seen : check.waiting }}</p>
          <p v-if="!seen && !live" class="mc-part-note">Start your sandbox to run it.</p>
        </div>
      </li>
      <li :class="['mc-part', answered ? 'is-done' : 'is-waiting']">
        <span class="mc-mark" aria-hidden="true">{{ answered ? "✓" : "2" }}</span>
        <div class="mc-quiz">
          <p class="mc-part-title">One question</p>
          <QuestionCard
            :label="`${module} question`"
            :question="check.quiz.question"
            :choices="check.quiz.choices"
            :attempts="quizPicks(module)"
            :done="done"
            @pick="(choice) => quizPick(module, choice)"
          />
        </div>
      </li>
    </ol>
  </section>
</template>
