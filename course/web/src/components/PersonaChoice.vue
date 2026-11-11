<script setup>
// The first question the site asks, after the welcome intro and before the map: how do you want
// to learn Temporal? One card per persona (quests/personas.yaml). Picking one keeps it (and, for
// another persona's course, loads the page again on its map). It can be changed later from the
// account menu, or the map.
import { nextTick, onMounted, ref } from "vue";

import { choosePersona } from "../progress.js";
import { course, store } from "../store.js";

const props = defineProps({
  // Opened to switch (not the first time): it can be closed without choosing.
  switching: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);
const first = ref(null);

function pick(id) {
  choosePersona(id);
  emit("close");
}

function onKey(event) {
  if (event.key === "Escape" && props.switching) emit("close");
}

onMounted(() => nextTick(() => first.value?.focus({ preventScroll: true })));
</script>

<template>
  <div class="persona-backdrop" @keydown="onKey" @click.self="switching && emit('close')">
    <section class="persona-choice" role="dialog" aria-modal="true" aria-labelledby="persona-title">
      <p class="eyebrow">Temporal Quest</p>
      <h2 id="persona-title">{{ switching ? "Switch how you learn" : "How do you want to learn Temporal?" }}</h2>
      <p class="persona-sub">Pick the one that fits. You can switch any time, and your progress stays with you.</p>
      <div class="persona-cards">
        <button
          v-for="(p, i) in course.personas"
          :key="p.id"
          :ref="(el) => i === 0 && (first = el)"
          type="button"
          :class="['persona-card', { 'is-current': store.persona.chosen && store.persona.id === p.id }]"
          :aria-current="store.persona.chosen && store.persona.id === p.id ? 'true' : undefined"
          @click="pick(p.id)"
        >
          <span class="persona-icon" aria-hidden="true">{{ p.icon }}</span>
          <span class="persona-label">{{ p.label }}</span>
          <span class="persona-blurb">{{ p.blurb }}</span>
          <span class="persona-go">{{ store.persona.chosen && store.persona.id === p.id ? "Your current choice" : "Choose →" }}</span>
        </button>
      </div>
      <button v-if="switching" class="button persona-cancel" type="button" @click="emit('close')">Keep it as it is</button>
    </section>
  </div>
</template>
