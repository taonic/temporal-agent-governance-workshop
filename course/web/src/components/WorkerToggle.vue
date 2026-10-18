<script setup>
// The worker's state, and a click to stop or start it. The same control appears in the
// instructions wherever they say to stop or start the worker (ExerciseInstructions fills
// those in with workerToggleView too), so it looks and behaves the same everywhere.
import { computed } from "vue";

import { toggleWorker, workerToggleView } from "../store.js";

const props = defineProps({
  exercise: { type: Object, required: true },
  live: { type: Boolean, default: false },
});

const view = computed(() => workerToggleView(props.live));
</script>

<template>
  <button
    class="worker-toggle"
    :class="`is-${view.state}`"
    type="button"
    :disabled="view.disabled"
    :aria-pressed="view.state === 'running'"
    :title="view.title"
    @click="toggleWorker(exercise)"
  >
    <span class="wt-dot" aria-hidden="true" /><span class="wt-label">{{ view.label }}</span><span v-if="view.action" class="wt-action">{{ view.action }}</span>
  </button>
</template>
