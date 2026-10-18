<script setup>
// Expand / restore, icon only: the code panel and the sandbox's pane each have one. Tinted, so
// it reads as the panel's main control among the plain icons beside it.
defineProps({
  maximized: { type: Boolean, default: false },
  what: { type: String, required: true }, // "the code" / "the pane", for the tooltip
  to: { type: String, default: "the whole workspace" }, // what it expands over
});
defineEmits(["toggle"]);
</script>

<template>
  <button
    class="maximize-btn"
    :class="{ active: maximized }"
    type="button"
    :aria-pressed="maximized"
    :aria-label="maximized ? `Restore ${what}` : `Expand ${what}`"
    :title="maximized ? `Restore ${what} (Esc)` : `Expand ${what} to ${to}`"
    @click="$emit('toggle')"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path v-if="maximized" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      <path v-else d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  </button>
</template>
